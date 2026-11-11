import {orderedClientTransport} from './ordered-client-transport.js';
import {createHash} from 'node:crypto';
import {mcpCallContext,type McpCallContext} from './mcp-call-context.js';
import {CreateMessageRequestSchema,ElicitRequestSchema,ListRootsRequestSchema,ToolListChangedNotificationSchema,ResourceListChangedNotificationSchema,PromptListChangedNotificationSchema} from '@modelcontextprotocol/sdk/types.js';
import {collectPages,type UpstreamAdapter,type UpstreamCallOptions} from './upstream-adapter.js';
import {upstreamOAuthProvider} from './upstream-oauth.js';
import {ownedByUser,childEnvKeys} from "./platform.js";
import { upstreamDefinitionSchema } from "./config-schemas.js";
import type { AuditSink,RouteDefinition,Tool,ToolInvocation,UpstreamStatus } from "./contracts.js";
import { toolResult } from "./mcp-results.js";
import { GatewayError,errorCode,parseJSON,record } from "./validation.js";
// Operator-owned, opt-in multi-upstream configuration. No marketplace code
// execution or public authorization is implied by discovery.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {SSEClientTransport} from '@modelcontextprotocol/sdk/client/sse.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import { ManagedStdioTransport } from './managed-stdio-transport.js';
import { lstat,readFile } from "node:fs/promises";
import path from "node:path";

const MAX_CONFIG_BYTES=262144;
function invalid(code: string): never{throw new GatewayError(code);}
function validate(value:unknown){
  const parsed=upstreamDefinitionSchema.safeParse(value);
  if(!parsed.success)invalid('UPSTREAM_CONFIG_INVALID');
  const def=parsed.data;
  if(def.transport==='stdio'){
    if(!path.isAbsolute(def.command))invalid('UPSTREAM_COMMAND_MUST_BE_ABSOLUTE');
    if(def.cwd&&!path.isAbsolute(def.cwd))invalid('UPSTREAM_CWD_MUST_BE_ABSOLUTE');
  }
  return Object.freeze(def);
}
export function validateConfiguredUpstreams(value: unknown){
  const config=record(value,"UPSTREAM_CONFIG_VERSION_OR_SIZE");
  if(!config||typeof config!=="object"||Array.isArray(config)||
     config.version!==1||Object.keys(config).some(k=>!["version","upstreams"].includes(k))||
     !Array.isArray(config.upstreams)||config.upstreams.length>12)
    invalid("UPSTREAM_CONFIG_VERSION_OR_SIZE");
  const defs=config.upstreams.map(validate);
  if(new Set(defs.map(d=>d.id)).size!==defs.length)invalid("UPSTREAM_ROUTE_DUPLICATE");
  return defs;
}
export async function readConfiguredUpstreams(configFile: string){
  if(typeof configFile!=="string"||!path.isAbsolute(configFile))invalid("UPSTREAM_CONFIG_ABSOLUTE_PATH_REQUIRED");
  const stat=await lstat(configFile);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||
     !ownedByUser(configFile,stat,true)||stat.size>MAX_CONFIG_BYTES)
    invalid("UPSTREAM_CONFIG_OWNER_OR_MODE_DENIED");
  const raw=await readFile(configFile,"utf8");
  let value;
  try{value=parseJSON(raw);}catch{invalid("UPSTREAM_CONFIG_JSON_INVALID");}
  return validateConfiguredUpstreams(value);
}
function cleanEnv(additions: Readonly<Record<string,string>>){
  const env: Record<string,string>={};
  for(const key of childEnvKeys)
    if(process.env[key])env[key]=process.env[key]!;
  return {...env,...additions};
}
export class ConfiguredUpstream implements UpstreamAdapter {
  onCatalogChanged:(()=>void)|undefined;
  #client: Client|null=null;
  #sessions=new Map<string,ConfiguredUpstream>();
  #catalog: Tool[]=[];
  #resources:import('./contracts.js').Resource[]=[];
  #templates:import('./contracts.js').ResourceTemplate[]=[];
  #prompts:import('@modelcontextprotocol/sdk/types.js').Prompt[]=[];
  #initialized=false;
  #diagnostics='';
  #connecting: Promise<void>|null=null;
  #closed=false;
  #closing: Promise<void>|null=null;
  #connectAbort: AbortController|null=null;
  #state: UpstreamStatus["status"]="DISCONNECTED";
  #lastError: string|null=null;
  readonly definition: ReturnType<typeof validate>;
  readonly id: string;
  constructor(def: unknown,private readonly interaction?:McpCallContext){this.definition=validate(def);this.id=this.definition.id;}
  async cacheIdentity(){const def=this.definition;const state=def.transport!=='stdio'&&def.auth?await readFile(def.auth.stateFile,'utf8'):JSON.stringify(def);return createHash('sha256').update(state).digest('hex');}
  get discoveredCatalog(){return structuredClone(this.#catalog);}
  get upstreamCatalog(){const allowed=new Set(this.definition.allowTools);return structuredClone(this.#catalog.filter(t=>allowed.has(t.name)));}
  private diagnostic(chunk:unknown){
    this.#diagnostics=(this.#diagnostics+String(chunk)).slice(-16384);
  }
  private diagnosticPreview(){
    let text=this.#diagnostics;
    const secrets=this.definition.transport==='stdio'?this.definition.env:this.definition.headers;
    for(const value of Object.values(secrets??{}))if(value)text=text.split(value).join('[REDACTED]');
    return text;
  }
  get status(){return Object.freeze({id:this.id,status:this.#state,toolCount:this.#catalog.length,
    lastError:this.#lastError,enabled:this.definition.enabled!==false,allowedToolCount:this.upstreamCatalog.length,diagnostics:this.diagnosticPreview()});}
  async connect(){
    if(this.#closed)invalid("UPSTREAM_CLOSED");
    if(this.definition.enabled===false)invalid("UPSTREAM_DISABLED");
    if(this.definition.configurationError){this.#state='UNAVAILABLE';this.#lastError=this.definition.configurationError;invalid(this.definition.configurationError);}
    if(this.#client)return;
    if(this.#connecting)return this.#connecting;
    const controller=new AbortController();this.#connectAbort=controller;
    this.#connecting=(async()=>{
      const caps=this.interaction?.capabilities;
      const client=new Client({name:"gateway-configured-"+this.id,version:"0.1.0"},{capabilities:{...(caps?.sampling?{sampling:caps.sampling}:{}),...(caps?.elicitation?{elicitation:caps.elicitation}:{}),...(caps?.roots?{roots:{}}:{})}});
      for(const schema of [ToolListChangedNotificationSchema,ResourceListChangedNotificationSchema,PromptListChangedNotificationSchema])client.setNotificationHandler(schema,()=>{this.onCatalogChanged?.();});
      if(this.interaction){
        const interaction=this.interaction;
        if(caps?.sampling)client.setRequestHandler(CreateMessageRequestSchema,async(req,extra)=>interaction.interact('sampling/createMessage',req.params,extra.signal) as Promise<import('@modelcontextprotocol/sdk/types.js').CreateMessageResult>);
        if(caps?.elicitation)client.setRequestHandler(ElicitRequestSchema,async(req,extra)=>interaction.interact('elicitation/create',req.params,extra.signal) as Promise<import('@modelcontextprotocol/sdk/types.js').ElicitResult>);
        if(caps?.roots)client.setRequestHandler(ListRootsRequestSchema,async(req,extra)=>interaction.interact('roots/list',req.params,extra.signal) as Promise<import('@modelcontextprotocol/sdk/types.js').ListRootsResult>);
      }
      try{
        const def=this.definition;
        let transport:Transport;
        if(def.transport==='stdio'){
          const child=new ManagedStdioTransport({command:def.command,args:[...def.args],env:cleanEnv(def.env??{}),stderr:'pipe',...(def.cwd?{cwd:def.cwd}:{})});
          child.stderr?.on('data',data=>this.diagnostic(data));transport=child;
        }else{
          const requestInit={headers:def.headers??{},redirect:'error' as const};
          const authClient=def.auth?await upstreamOAuthProvider(def.auth.stateFile,def.url,def.auth):undefined;
          const authOptions=authClient?{authProvider:authClient.provider,fetch:authClient.fetch}:{};
          transport=def.transport==='streamable-http'?new StreamableHTTPClientTransport(new URL(def.url),{requestInit,...authOptions}) as Transport:
            new SSEClientTransport(new URL(def.url),{requestInit,...authOptions,eventSourceInit:{fetch:((url,init)=>fetch(url,{...init,redirect:'error'})) as typeof fetch}});
        }
        const timeout=def.startupTimeoutMs??7000;
        const signal=AbortSignal.any([AbortSignal.timeout(timeout),controller.signal]);
        await client.connect(orderedClientTransport(transport),{timeout,signal});
        const catalog:Tool[]=[],cursors=new Set<string>();let cursor:string|undefined;
        if(client.getServerCapabilities()?.tools)do{
          const page=await client.listTools(cursor!==undefined?{cursor}:undefined,{timeout,signal});
          catalog.push(...page.tools);
          if(catalog.length>2000||cursors.size>=100||Buffer.byteLength(JSON.stringify(catalog))>4194304)invalid('UPSTREAM_CATALOG_LIMIT');
          cursor=page.nextCursor;
          if(cursor!==undefined){if(cursors.has(cursor))invalid('UPSTREAM_CURSOR_REPEATED');cursors.add(cursor);}
        }while(cursor!==undefined);
        const capabilities=client.getServerCapabilities();
        const resources=capabilities?.resources?await collectPages(async cursor=>{const page=await client.listResources(cursor===undefined?undefined:{cursor},{timeout,signal});return {items:page.resources,...(page.nextCursor!==undefined?{nextCursor:page.nextCursor}:{})};}):[];
        const templates=capabilities?.resources?await collectPages(async cursor=>{try{const page=await client.listResourceTemplates(cursor===undefined?undefined:{cursor},{timeout,signal});return {items:page.resourceTemplates,...(page.nextCursor!==undefined?{nextCursor:page.nextCursor}:{})};}catch(error){if(error&&typeof error==='object'&&'code' in error&&error.code===-32601)return {items:[]};throw error;}}):[];
        const prompts=capabilities?.prompts?await collectPages(async cursor=>{const page=await client.listPrompts(cursor===undefined?undefined:{cursor},{timeout,signal});return {items:page.prompts,...(page.nextCursor!==undefined?{nextCursor:page.nextCursor}:{})};}):[];
        if(this.#initialized&&JSON.stringify([catalog,resources,templates,prompts])!==JSON.stringify([this.#catalog,this.#resources,this.#templates,this.#prompts]))invalid('UPSTREAM_SCHEMA_CHANGED_RESTART_GATEWAY');
        if(this.#closed)invalid("UPSTREAM_CLOSED");
        if(!Array.isArray(catalog)||new Set(catalog.map(x=>x.name)).size!==catalog.length||
           catalog.some(x=>!x.name||!x.inputSchema))
          invalid("UPSTREAM_TOOL_CATALOG_INVALID");
        if(this.#catalog.length&&JSON.stringify(catalog)!==JSON.stringify(this.#catalog))
          invalid("UPSTREAM_SCHEMA_CHANGED_RESTART_GATEWAY");
        if(!this.#catalog.length)this.#catalog=structuredClone(catalog);
        this.#resources=structuredClone(resources);this.#templates=structuredClone(templates);this.#prompts=structuredClone(prompts);this.#initialized=true;
        this.#client=client;
        this.#state="READY";this.#lastError=null;
        client.onclose=()=>{
          // A disconnected child is not healthy merely because nobody called it.
          if(this.#client===client){
            this.#client=null;
            this.#state="UNAVAILABLE";this.#lastError="UPSTREAM_DISCONNECTED";
          }
        };
      }catch(error){
        await client.close().catch(()=>{});
        if(this.#closed)invalid("UPSTREAM_CLOSED");
        this.#state="UNAVAILABLE";this.#lastError=errorCode(error)||(error instanceof Error&&error.constructor.name==='UnauthorizedError'?'UPSTREAM_AUTH_REQUIRED':"UPSTREAM_CONNECT_FAILED");
        throw error;
      }
    })().finally(()=>{this.#connecting=null;this.#connectAbort=null;});
    return this.#connecting;
  }
  async forwardWorkspaceInvocation(invocation: ToolInvocation,options?:UpstreamCallOptions):Promise<import('./contracts.js').CallToolResult>{
    const context=mcpCallContext.getStore();
    if(this.#closed)invalid('UPSTREAM_CLOSED');
    if(context&&!this.interaction&&(context.capabilities.sampling||context.capabilities.elicitation||context.capabilities.roots)){
      let session=this.#sessions.get(context.sessionId);
      if(!session){if(this.#sessions.size>=64)invalid('UPSTREAM_SESSION_LIMIT');session=new ConfiguredUpstream(this.definition,context);this.#sessions.set(context.sessionId,session);}
      await session.connect();return session.forwardWorkspaceInvocation(invocation,options);
    }
    let progressSent=Promise.resolve();
    if(context)options={...options,signal:context.signal,onprogress:p=>{progressSent=progressSent.then(()=>context.progress(p)).catch(()=>{});}};
    // Upstream protocol request IDs and progress tokens belong to the core SDK.
    if(invocation._meta){const {progressToken,...metadata}=invocation._meta;invocation={...invocation,_meta:metadata};}
    if(this.#closed)invalid("UPSTREAM_CLOSED");
    if(!invocation||!this.#catalog.some(x=>x.name===invocation.name))
      invalid("UPSTREAM_TOOL_UNKNOWN");
    if(!this.definition.allowTools.includes(invocation.name))invalid("UPSTREAM_TOOL_NOT_GRANTED");
    if(!this.#client){
      try{await this.connect();}catch{invalid(this.#closed?"UPSTREAM_CLOSED":"UPSTREAM_UNAVAILABLE");}
    }
    if(this.#closed)invalid("UPSTREAM_CLOSED");
    const activeClient=this.#client!;
    try{
      context?.trace?.('upstreamRequest',{serverId:this.id,request:invocation});
      const result=toolResult(await activeClient.callTool(invocation,undefined,options));await progressSent;context?.trace?.('upstreamResponse',result);return result;
    }catch{
      if(!this.#closed){this.#state="UNAVAILABLE";this.#lastError="UPSTREAM_CALL_UNCERTAIN";}
      if(this.#client===activeClient)this.#client=null;
      await activeClient.close().catch(()=>{});
      // Crucial: never retry a call with possibly completed side effects.
      invalid("UPSTREAM_CALL_UNCERTAIN");
    }
  }
  private async connectedClient(){if(this.#closed)invalid('UPSTREAM_CLOSED');if(!this.#client)await this.connect();return this.#client!;}
  async listNativeResources(){return structuredClone(this.#resources);}
  async listNativeResourceTemplates(){return structuredClone(this.#templates);}
  async readNativeResource(uri:string){return (await this.connectedClient()).readResource({uri});}
  async listNativePrompts(){return structuredClone(this.#prompts);}
  async getNativePrompt(name:string,args?:Record<string,string>){return (await this.connectedClient()).getPrompt({name,...(args?{arguments:args}:{})});}
  async releaseSession(id:string){const session=this.#sessions.get(id);this.#sessions.delete(id);await session?.close();}
  async close():Promise<void>{
    // Closing is terminal for this object; restart creates a new upstream.
    // Wait for cancelled discovery to dispose its local Client before returning.
    if(this.#closing)return this.#closing;
    this.#closed=true;this.#state="CLOSED";this.#lastError="UPSTREAM_CLOSED";
    this.#connectAbort?.abort(new GatewayError("UPSTREAM_CLOSED"));
    const client=this.#client;this.#client=null;
    this.#closing=Promise.allSettled([this.#connecting,client?.close(),...this.#sessions.values()].map(item=>item instanceof ConfiguredUpstream?item.close():item)).then(()=>{});
    return this.#closing;
  }
}
export async function bootstrapConfiguredUpstreams(configFile: string|undefined, audit: AuditSink=()=>{}){
  const defs=configFile?await readConfiguredUpstreams(configFile):[];
  const {ServerRegistry}=await import('./server-registry.js');
  const registry=new ServerRegistry({version:1,upstreams:defs},audit);
  await registry.connectAll();
  return {registry,get routes(){return registry.routes();},get upstreams(){return registry.upstreams;},status:()=>registry.status()};
}

// Preserve the existing internal import name for stdio consumers.
export {ConfiguredUpstream as ConfiguredStdioUpstream};
