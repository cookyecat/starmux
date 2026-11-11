import {serverTemplates} from './server-templates.js';
import {beginUpstreamOAuth,logoutUpstreamOAuth,upstreamOAuthStatus,upstreamOAuthFile} from './upstream-oauth.js';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {homedir} from 'node:os';
import {ConfiguredUpstream} from './configured-mcp-upstreams.js';
import {previewServerImport,findExecutable,type ServerImport,type ServerConfig} from './server-import.js';
import * as store from './instance-store.js';
import {withPrivateLock} from './private-store-lock.js';
import {errorCode} from './validation.js';

/** Shared by the CLI and the owner-only Web API; previews never launch programs. */
export class ServerManagement {
 readonly #previews=new Map<string,{instanceId:string;at:number;value:ServerImport;tested:boolean}>();
 constructor(private readonly home=homedir()){}
 async list(instance:store.Instance){const c=await store.loadInstanceConfig(instance);return {servers:c.config.upstreams,revision:c.revision,templates:serverTemplates};}
 async preview(instance:store.Instance,input:string,id?:string,file?:string){
  const c=await store.loadInstanceConfig(instance);
  const value=await previewServerImport(input,{base:c.config.projectRoot,...(id?{id}:{}),...(file?{file}:{})});
  const conflicts=value.servers.filter(s=>c.config.upstreams.some(old=>old.id===s.id)).map(s=>s.id);
  this.expire();if(this.#previews.size>=20)throw Error('SERVER_PREVIEW_LIMIT');
  const previewId=randomUUID();this.#previews.set(previewId,{instanceId:instance.id,at:Date.now(),value,tested:false});
  return {previewId,servers:value.servers,secretNames:Object.keys(value.secrets),conflicts,warnings:value.warnings,revision:c.revision};
 }
 private expire(){for(const [id,p] of this.#previews)if(Date.now()-p.at>1800000)this.#previews.delete(id);}
 private previewFor(instance:store.Instance,id:string){this.expire();const p=this.#previews.get(id);if(!p||p.instanceId!==instance.id)throw Error('SERVER_PREVIEW_EXPIRED');return p;}
 private async secrets(instance:store.Instance){const f=path.join(store.instancePaths(instance,this.home).state,'secrets.json');return await store.exists(f)?JSON.parse(await store.readTrusted(f)) as Record<string,string>:{};}
 async test(instance:store.Instance,{previewId,id,prepare=false,signal}:{previewId?:string;id?:string;prepare?:boolean;signal?:AbortSignal}){
  const preview=previewId?this.previewFor(instance,previewId):undefined;
  const saved=await this.list(instance);const servers=preview?.value.servers??saved.servers.filter(s=>s.id===id);
  if(!servers.length)throw Error('SERVER_NOT_FOUND');
  const secrets={...await this.secrets(instance),...preview?.value.secrets};
  const results=await Promise.all(servers.map(async server=>{
   let connection:ConfiguredUpstream|undefined;
   const cancel=()=>{void connection?.close();};
   try{
    if(signal?.aborted)throw Error('SERVER_TEST_CANCELLED');
    let definition;
    if(server.transport==='stdio'){
     const {envRefs,...rest}=server;const command=await findExecutable(server.command,server.cwd??(await store.loadInstanceConfig(instance)).config.projectRoot);
     definition={...rest,command,env:resolveRefs(envRefs,secrets)};
     // Absolute executable is recorded only after successful runtime lookup.
     server.command=command;
    }else {const {headerRefs,auth,...rest}=server;definition={...rest,...(auth?{auth:{type:'oauth',...(auth.clientId?{clientId:auth.clientId}:{}),...(auth.issuer?{issuer:auth.issuer}:{}),stateFile:upstreamOAuthFile(store.instancePaths(instance,this.home).state,server.id,server.url),...(auth.clientSecretRef?{clientSecret:secrets[auth.clientSecretRef]}:{})}}:{}),headers:{...server.headers,...resolveRefs(headerRefs,secrets)}};}
    connection=new ConfiguredUpstream({...definition,enabled:true,...(prepare?{startupTimeoutMs:300000}:{})});
    signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    await connection.connect();
    const tools=connection.discoveredCatalog.map(t=>({name:t.name,description:t.description}));
    if(preview&&preview.value.discoverGrants.includes(server.id))server.allowTools=tools.map(t=>t.name);
    return {id:server.id,status:'READY',discovered:tools.length,allowed:server.allowTools.filter(n=>tools.some(t=>t.name===n)).length,tools};
   }catch(error){return {id:server.id,status:'UNAVAILABLE',error:signal?.aborted?'SERVER_TEST_CANCELLED':errorCode(error)||(error instanceof Error&&error.constructor.name==='UnauthorizedError'?'UPSTREAM_AUTH_REQUIRED':error instanceof Error&&error.message.startsWith('SERVER_RUNTIME_MISSING')?error.message:'SERVER_TEST_FAILED')};}
   finally{signal?.removeEventListener('abort',cancel);await connection?.close();}
  }));
  if(preview)preview.tested=results.every(r=>r.status==='READY');return {results};
 }
 async auth(instance:store.Instance,id:string,op:string,previewId?:string){
  const servers=previewId?this.previewFor(instance,previewId).value.servers:(await this.list(instance)).servers;
  const server=servers.find(s=>s.id===id);if(!server||server.transport==='stdio')throw Error('UPSTREAM_OAUTH_NOT_CONFIGURED');
  if(!server.auth){if(!previewId)throw Error('UPSTREAM_OAUTH_NOT_CONFIGURED');server.auth={type:'oauth'};}
  const file=upstreamOAuthFile(store.instancePaths(instance,this.home).state,id,server.url);
  const secrets=await this.secrets(instance);if(server.auth.clientSecretRef&&!(server.auth.clientSecretRef in secrets))throw Error('UPSTREAM_SECRET_MISSING');const settings={...(server.auth.clientId?{clientId:server.auth.clientId}:{}),...(server.auth.issuer?{issuer:server.auth.issuer}:{}),...(server.auth.clientSecretRef?{clientSecret:secrets[server.auth.clientSecretRef]!}:{})};
  if(op==='login')return beginUpstreamOAuth(file,server.url,settings);
  if(op==='logout'){await logoutUpstreamOAuth(file,server.url);return {authenticated:false};}
  if(op==='status')return upstreamOAuthStatus(file,server.url);throw Error('UPSTREAM_AUTH_ACTION_INVALID');
 }
 async savePreview(instance:store.Instance,previewId:string,revision:string,replace=false){
  const p=this.previewFor(instance,previewId);if(!p.tested)throw Error('SERVER_TEST_REQUIRED');
  const saved=await this.list(instance);if(saved.revision!==revision)throw Error('CONFIG_REVISION_CONFLICT');
  if(!replace&&saved.servers.some(s=>p.value.servers.some(n=>n.id===s.id)))throw Error('SERVER_ID_CONFLICT');
  if(new Set([...saved.servers,...p.value.servers].map(s=>s.id)).size>12)throw Error('SERVER_LIMIT');
  // Secrets stay in the instance private store and never enter exported JSONC.
  const file=path.join(store.instancePaths(instance,this.home).state,'secrets.json');
  await withPrivateLock(file+'.lock',async()=>{const secrets=await this.secrets(instance);for(const key of Object.keys(p.value.secrets))if(key in secrets&&secrets[key]!==p.value.secrets[key])throw Error('SERVER_SECRET_REFERENCE_CONFLICT');await store.atomicPrivate(file,JSON.stringify({...secrets,...p.value.secrets}));});
  const edits:{path:(string|number)[];value:unknown}[]=[];
  for(const server of p.value.servers){const index=saved.servers.findIndex(s=>s.id===server.id);const old=saved.servers[index];if(old){if(p.value.discoverGrants.includes(server.id))server.allowTools=old.allowTools;for(const field of new Set([...Object.keys(old),...Object.keys(server)]))edits.push({path:['upstreams',index,field],value:(server as unknown as Record<string,unknown>)[field]});}else edits.push({path:['upstreams',-1],value:server});}
  const result=await store.editInstanceConfigPaths(instance,edits,revision,this.home);
  this.#previews.delete(previewId);return result;
 }
 async action(instance:store.Instance,id:string,action:'enable'|'disable'|'remove',revision:string){
  const saved=await this.list(instance);if(!saved.servers.some(s=>s.id===id))throw Error('SERVER_NOT_FOUND');
  const index=saved.servers.findIndex(s=>s.id===id);
  return store.editInstanceConfigPaths(instance,[action==='remove'?{path:['upstreams',index],value:undefined}:{path:['upstreams',index,'enabled'],value:action==='enable'}],revision,this.home);
 }
}
function resolveRefs(refs:Record<string,string>,secrets:Record<string,string>){return Object.fromEntries(Object.entries(refs).map(([key,ref])=>{if(!(ref in secrets))throw Error('UPSTREAM_SECRET_MISSING');return [key,secrets[ref]];}));}

export async function applySavedGateway(instance:store.Instance,revision:string,forceId?:string){
 const {instanceRequest}=await import('./instance-runtime.js');
 try{const state=await instanceRequest(instance,'apply',revision,forceId);return {application:state?'applied':'on-next-start'};}
 catch(error){return {application:'pending',error:error instanceof Error?error.message:'GATEWAY_APPLY_FAILED'};}
}
