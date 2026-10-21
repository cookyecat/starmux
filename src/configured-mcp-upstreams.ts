import {ownedByUser,childEnvKeys} from "./platform.js";
import { upstreamDefinitionSchema } from "./config-schemas.js";
import type { AuditSink,RouteDefinition,Tool,ToolInvocation,UpstreamStatus } from "./contracts.js";
import { toolResult } from "./mcp-results.js";
import { GatewayError,errorCode,parseJSON,record } from "./validation.js";
// Operator-owned, opt-in multi-upstream configuration. No marketplace code
// execution or public authorization is implied by discovery.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { lstat,readFile } from "node:fs/promises";
import path from "node:path";

const ROUTE=/^[a-z][a-z0-9_-]{0,39}$/;
const TOOL=/^[A-Za-z0-9_.:-]{1,128}$/;
const MAX_CONFIG_BYTES=65536;
function invalid(code: string): never{const err=new GatewayError(code);throw err;}
function validate(value: unknown){
  const def=record(value,"UPSTREAM_CONFIG_INVALID");
  if(!def||typeof def!=="object"||Array.isArray(def)||
     Object.keys(def).some(k=>!["id","transport","command","args","env","allowTools"].includes(k)))
    invalid("UPSTREAM_CONFIG_INVALID");
  if((typeof def.id!=="string"||!ROUTE.test(def.id))||def.id==="desktop"||def.id==="health_check")invalid("UPSTREAM_ROUTE_INVALID");
  if(def.transport!=="stdio")invalid("UPSTREAM_TRANSPORT_UNSUPPORTED");
  if(typeof def.command!=="string"||!path.isAbsolute(def.command)||def.command.includes("\0"))
    invalid("UPSTREAM_COMMAND_MUST_BE_ABSOLUTE");
  if(!Array.isArray(def.args)||def.args.length>40||
      def.args.some(s=>typeof s!=="string"||s.length>4096||s.includes("\0")))
    invalid("UPSTREAM_ARGUMENTS_INVALID");
  if(!Array.isArray(def.allowTools)||def.allowTools.length>200||
      new Set(def.allowTools).size!==def.allowTools.length||
      def.allowTools.some(t=>typeof t!=="string"||!TOOL.test(t)))
    invalid("UPSTREAM_ALLOWLIST_REQUIRED");
  if(def.env!==undefined&&(!def.env||typeof def.env!=="object"||Array.isArray(def.env)||
     Object.entries(def.env).length>20||
     Object.entries(def.env).some(([k,v])=>!/^[A-Z][A-Z0-9_]*$/.test(k)||
       typeof v!=="string"||v.length>4096||v.includes("\0"))))
    invalid("UPSTREAM_ENV_INVALID");
  const checked=upstreamDefinitionSchema.parse(def);
  return Object.freeze({
    id:checked.id,transport:"stdio" as const,command:checked.command,args:Object.freeze([...checked.args]),
    allowTools:Object.freeze([...checked.allowTools]),env:Object.freeze({...checked.env})
  });
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
export class ConfiguredStdioUpstream {
  #client: Client|null=null;
  #catalog: Tool[]=[];
  #connecting: Promise<void>|null=null;
  #state: UpstreamStatus["status"]="DISCONNECTED";
  #lastError: string|null=null;
  readonly definition: ReturnType<typeof validate>;
  readonly id: string;
  constructor(def: unknown){this.definition=validate(def);this.id=this.definition.id;}
  get upstreamCatalog(){return structuredClone(this.#catalog);}
  get status(){return Object.freeze({id:this.id,status:this.#state,toolCount:this.#catalog.length,
    lastError:this.#lastError});}
  async connect(){
    if(this.#client)return;
    if(this.#connecting)return this.#connecting;
    this.#connecting=(async()=>{
      const client=new Client({name:"gateway-configured-"+this.id,version:"0.1.0"},{capabilities:{}});
      try{
        const transport=new StdioClientTransport({
          command:this.definition.command,args:[...this.definition.args],
          env:cleanEnv(this.definition.env),stderr:"ignore"
        });
        // Bound discovery: an unresponsive optional child must not freeze the
        // primary Desktop Commander Gateway startup indefinitely.
        await client.connect(transport,{timeout:7000});
        const catalog=(await client.listTools(undefined,{timeout:7000})).tools;
        if(!Array.isArray(catalog)||new Set(catalog.map(x=>x.name)).size!==catalog.length||
           catalog.some(x=>!x.name||!x.inputSchema))
          invalid("UPSTREAM_TOOL_CATALOG_INVALID");
        if(this.#catalog.length&&JSON.stringify(catalog)!==JSON.stringify(this.#catalog))
          invalid("UPSTREAM_SCHEMA_CHANGED_RESTART_GATEWAY");
        if(!this.#catalog.length)this.#catalog=structuredClone(catalog);
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
        this.#state="UNAVAILABLE";this.#lastError=errorCode(error)||"UPSTREAM_CONNECT_FAILED";
        throw error;
      }
    })().finally(()=>{this.#connecting=null;});
    return this.#connecting;
  }
  async forwardWorkspaceInvocation(invocation: ToolInvocation){
    if(!invocation||!this.#catalog.some(x=>x.name===invocation.name))
      invalid("UPSTREAM_TOOL_UNKNOWN");
    if(!this.#client){
      try{await this.connect();}catch{invalid("UPSTREAM_UNAVAILABLE");}
    }
    try{
      return toolResult(await this.#client!.callTool(invocation));
    }catch{
      this.#state="UNAVAILABLE";this.#lastError="UPSTREAM_CALL_UNCERTAIN";
      const client=this.#client;this.#client=null;
      await client?.close().catch(()=>{});
      // Crucial: never retry a call with possibly completed side effects.
      invalid("UPSTREAM_CALL_UNCERTAIN");
    }
  }
  async close(){
    const client=this.#client;this.#client=null;this.#state="CLOSED";
    await client?.close().catch(()=>{});
  }
}
export async function bootstrapConfiguredUpstreams(configFile: string|undefined, audit: AuditSink=()=>{}){
  if(!configFile)return {routes:[],upstreams:[],status:()=>[]};
  const defs=await readConfiguredUpstreams(configFile);
  const upstreams: ConfiguredStdioUpstream[]=[],routes: RouteDefinition[]=[];
  for(const def of defs){
    const upstream=new ConfiguredStdioUpstream(def);
    upstreams.push(upstream);
    try{
      await upstream.connect();
      const allow=new Set(def.allowTools);
      routes.push({id:def.id,upstream,authorize:(name,args)=>{
        if(!allow.has(name))invalid("UPSTREAM_TOOL_NOT_GRANTED");
        return args;
      }});
      audit({event:"UPSTREAM_DISCOVERED",route:def.id,tools:upstream.upstreamCatalog.length});
    }catch(error){
      // One failed child does not prevent the Desktop Commander route from starting.
      audit({event:"UPSTREAM_STARTUP_UNAVAILABLE",route:def.id,
        code:errorCode(error)||"UPSTREAM_CONNECT_FAILED"});
    }
  }
  return {routes,upstreams,status:()=>upstreams.map(x=>x.status)};
}
