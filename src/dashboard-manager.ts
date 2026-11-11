import {MiddlewareManagement} from './middleware-management.js';
import {ServerManagement,applySavedGateway} from './server-management.js';
import {createServer,type IncomingMessage} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {homedir,networkInterfaces} from 'node:os';
import path from 'node:path';
import {open,readFile} from 'node:fs/promises';
import {fork,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as store from './instance-store.js';
import {instanceStatus,instanceRequest,stopInstance} from './instance-runtime.js';
import {createAccessControl} from './access-control.js';
import {discoverOAuth} from './oauth-resource.js';
import {createWorkspaceGrants} from './workspace-grants.js';
import {createDenyRules} from './explicit-deny-rules.js';
import {withPrivateLock} from './private-store-lock.js';
import {modify,applyEdits} from 'jsonc-parser';
import {dashboardHtml} from './dashboard-ui.js';
const directory=()=>path.join(homedir(),'.config/starmux/dashboard');
const recordFile=()=>path.join(directory(),'manager.json');
type RecordData={pid:number;port:number;token:string;runId:string};
const equal=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export async function managerStatus():Promise<RecordData|null>{
  if(!await store.exists(recordFile()))return null;
  const r=JSON.parse(await store.readTrusted(recordFile())) as RecordData;
  if(!Number.isInteger(r.port)||r.port<1||r.port>65535||(!Number.isInteger(r.pid)||r.pid<2)||!/^[a-f0-9]{32}$/.test(r.runId)||!/^[a-f0-9]{64}$/.test(r.token))throw Error('MANAGER_RECORD_INVALID');
  try{const res=await fetch(`http://127.0.0.1:${r.port}/api/v1/identity`,{headers:{authorization:'Bearer '+r.token},signal:AbortSignal.timeout(1500)});const body=await res.json() as {runId:string};if(res.ok&&body.runId===r.runId)return r;}catch{}
  try{process.kill(r.pid,0);}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH')return null;}
  throw Error('MANAGER_IDENTITY_UNCONFIRMED');
}
export async function ensureManager(){return withPrivateLock(path.join(directory(),'start.lock'),async()=>{
  const existing=await managerStatus();if(existing)return existing;
  const child=fork(fileURLToPath(new URL('./cli/dashboard-worker.js',import.meta.url)),[],{detached:true,stdio:['ignore','ignore','ignore','ipc']});
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('MANAGER_START_TIMEOUT'));},15000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',()=>{clearTimeout(timer);reject(Error('MANAGER_START_FAILED'));});child.once('message',()=>{clearTimeout(timer);resolve();});});
  child.disconnect();child.unref();const result=await managerStatus();if(!result)throw Error('MANAGER_START_FAILED');return result;
});}
export async function stopManager(){const r=await managerStatus();if(!r)return;const res=await fetch(`http://127.0.0.1:${r.port}/api/v1/stop`,{method:'POST',headers:{authorization:'Bearer '+r.token,origin:`http://127.0.0.1:${r.port}`,'content-type':'application/json'},body:'{}'});if(!res.ok)throw Error('MANAGER_STOP_FAILED');}
export async function startDetachedInstance(instance:store.Instance){
 const current=await instanceStatus(instance);if(current.phase==='running')return current;if(current.phase!=='stopped')throw Error('INSTANCE_NOT_READY');
 await store.ensureAccessReady(instance);const config=await store.loadInstanceConfig(instance);if(!await store.availablePort(config.config.port,config.config.allowLan?'0.0.0.0':'127.0.0.1'))throw Error('PORT_IN_USE');
 const fd=await open(path.join(store.instancePaths(instance).logs,'supervisor.log'),'a',0o600);
 const child=spawn(process.execPath,[fileURLToPath(new URL('./cli/starmux-supervisor.js',import.meta.url)),instance.id],{detached:true,stdio:['ignore',fd.fd,fd.fd],windowsHide:true});await fd.close();child.unref();let failure:Error|undefined;child.once('error',e=>{failure=e;});
 for(let n=0;n<150;n++){if(failure)throw failure;const s=await instanceStatus(instance);if(s.phase==='running'&&s.health==='ok')return s;if(child.exitCode!==null||child.signalCode!==null)throw Error('INSTANCE_START_FAILED');await new Promise(r=>setTimeout(r,200));}child.kill();throw Error('INSTANCE_START_TIMEOUT');
}
async function body(req:IncomingMessage){let text='';for await(const c of req){text+=String(c);if(Buffer.byteLength(text)>262144)throw Error('REQUEST_TOO_LARGE');}const value:unknown=JSON.parse(text||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_REQUEST');return value as {[key:string]:any};}
export async function runManager(){
 const token=randomBytes(32).toString('hex'),runId=randomBytes(16).toString('hex');let port=0;
 const services=new ServerManagement(),middlewares=new MiddlewareManagement();
 const cancellations=new Map<string,AbortController>();
 const operations=new Map<string,{id:string;instanceId:string;state:string;error?:string;result?:unknown}>();const busy=new Set<string>();
 const startOperation=(instance:store.Instance,run:()=>Promise<unknown>)=>{
  const id=randomBytes(12).toString('hex');const operation:{id:string;instanceId:string;state:string;result?:unknown;error?:string}={id,instanceId:instance.id,state:'running'};
  operations.set(id,operation);busy.add(instance.id);
  void run().then(result=>{operation.result=result;operation.state='complete';},error=>{operation.error=error instanceof Error?error.message:'OPERATION_FAILED';operation.state='error';}).finally(()=>{busy.delete(instance.id);if(operations.size>200){const old=[...operations.values()].find(o=>o.state!=='running');if(old)operations.delete(old.id);}});
  return {...operation,operationId:id};
 };
 const server=createServer(async(req,res)=>{
  const headers={'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
  const send=(status:number,data:unknown)=>{res.writeHead(status,{...headers,'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  try{
   if(!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'')||![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host??'')){send(403,{error:'LOCAL_ONLY'});return;}
   if(req.headers.origin&&req.headers.origin!=='http://'+req.headers.host){send(403,{error:'ORIGIN_REJECTED'});return;}
   const url=new URL(req.url??'/',`http://${req.headers.host}`),route=url.pathname;
   if(req.method==='GET'&&route==='/'){res.writeHead(200,{...headers,'content-type':'text/html; charset=utf-8'});res.end(dashboardHtml);return;}
   if(req.method==='GET'&&(route==='/app.js'||route==='/user-feedback.js')){res.writeHead(200,{...headers,'content-type':'text/javascript'});res.end(await readFile(new URL(route==='/app.js'?'./dashboard-browser.js':'./user-feedback.js',import.meta.url)));return;}
   if(!equal(req.headers.authorization??'','Bearer '+token)){send(401,{error:'MANAGER_LOGIN_REQUIRED'});return;}
   if(req.method==='GET'&&route==='/api/v1/identity'){send(200,{runId});return;}
   if(req.method!=='GET'&&(req.method!=='POST'||req.headers.origin!=='http://'+req.headers.host||req.headers['content-type']!=='application/json')){send(403,{error:'INVALID_ORIGIN_OR_CONTENT_TYPE'});return;}
   const b=req.method==='POST'?await body(req):{};
   if(route==='/api/v1/stop'&&req.method==='POST'){send(200,{ok:true});server.close();server.closeIdleConnections();return;}
   if(route==='/api/v1/instances'){
    if(req.method==='POST'){if(Object.keys(b).some(k=>!['name','config','approved'].includes(k)))throw Error('INVALID_FIELDS');const config=await store.validateConfig(store.parseConfig(JSON.stringify(b.config)));await approve(config,b.approved);const i=await store.createInstance(String(b.name),{config});await consent(i,config);await createAccessControl(store.instancePaths(i).access);send(200,i);return;}
    const registry=await store.readRegistry();send(200,{defaultInstanceId:registry.defaultInstanceId,instances:await Promise.all(registry.instances.map(i=>instanceStatus(i))),operations:[...operations.values()]});return;
   }
   const opId=route.match(/^\/api\/v1\/operations\/([a-f0-9]+)$/)?.[1];if(opId){if(req.method==='POST'){if(b.op!=='cancel'||!cancellations.has(opId))throw Error('OPERATION_NOT_CANCELLABLE');cancellations.get(opId)!.abort();}send(operations.has(opId)?200:404,operations.get(opId)??{error:'OPERATION_NOT_FOUND'});return;}
   const match=route.match(/^\/api\/v1\/instances\/([^/]+)\/(status|config|actions|access|activity|calls|logs|permissions|filters|secrets|servers|middlewares)$/);if(!match){send(404,{error:'NOT_FOUND'});return;}
   const allowed:Record<string,string[]>={middlewares:['op','revision','input'],servers:['op','input','id','file','previewId','revision','prepare','authAction'],calls:['op','enabled'],config:['text','patch','validate','revision','approved'],actions:['action','name','revision'],access:['op','name','expiresAt','id','mode','config'],permissions:['op','target','mode'],filters:['op','value'],secrets:['op','name','value']};if(req.method==='POST'&&(!allowed[match[2]!]||Object.keys(b).some(k=>!allowed[match[2]!]!.includes(k))))throw Error('INVALID_FIELDS');
   const i=await store.resolveInstance(match[1],homedir(),true),action=match[2],p=store.instancePaths(i);
   if(req.method==='POST'&&['config','permissions','filters'].includes(action!)){const status=await instanceStatus(i);if(!['stopped','running'].includes(status.phase)&&!b.validate){send(409,{error:'INSTANCE_NOT_READY'});return;}}
   if(req.method==='POST'&&busy.has(i.id)){send(409,{error:'INSTANCE_BUSY'});return;}
   if(action==='middlewares'){
    if(req.method==='GET'){send(200,{...await middlewares.list(i),runtime:await gatewayState(i)});return;}
    if(b.op==='test'){send(202,startOperation(i,()=>middlewares.test(i,b.input)));return;}
    if(b.op==='reload'){send(202,startOperation(i,()=>applySavedGateway(i,String(b.revision),'__middleware__')));return;}
    const saved=await middlewares.update(i,String(b.op),String(b.revision),b.input);send(202,startOperation(i,async()=>({...saved,...await applySavedGateway(i,saved.revision)})));return;
   }
   if(action==='servers'){
    if(req.method==='GET'){send(200,{...await services.list(i),runtime:await gatewayState(i)});return;}
    if(b.op==='auth'){send(200,await services.auth(i,String(b.id),String(b.authAction),b.previewId));return;}
    if(b.op==='preview'){send(200,await services.preview(i,String(b.input??''),b.id,b.file));return;}
    if(b.op==='save'||b.op==='replace'){const saved=await services.savePreview(i,String(b.previewId),String(b.revision),b.op==='replace');send(202,startOperation(i,async()=>({...saved,...await applySavedGateway(i,saved.revision)})));return;}
    if(['enable','disable','remove'].includes(b.op)){const saved=await services.action(i,String(b.id),b.op,String(b.revision));send(202,startOperation(i,async()=>({...saved,...await applySavedGateway(i,saved.revision)})));return;}
    if(['retry','refresh'].includes(b.op)){send(202,startOperation(i,()=>applySavedGateway(i,String(b.revision),String(b.id))));return;}
    if(b.op==='test'){
     const id=randomBytes(12).toString('hex');const operation:{id:string;instanceId:string;state:string;error?:string;result?:unknown}={id,instanceId:i.id,state:'running'};
     operations.set(id,operation);busy.add(i.id);const controller=new AbortController();cancellations.set(id,controller);
     void services.test(i,{...(b.previewId?{previewId:String(b.previewId)}:{id:String(b.id)}),prepare:b.prepare===true,signal:controller.signal}).then(result=>{operation.result=result;operation.state='complete';},()=>{operation.state='error';operation.error='SERVER_TEST_FAILED';}).finally(()=>{busy.delete(i.id);cancellations.delete(id);if(operations.size>200){const old=[...operations.values()].find(o=>o.state!=='running');if(old)operations.delete(old.id);}});
     send(202,operation);return;
    }
    throw Error('INVALID_ACTION');
   }
   if(action==='status'){send(200,await instanceStatus(i));return;}
   if(action==='actions'&&req.method==='POST'){
    if(!['start','stop','restart','apply','archive','restore','rename','default','copy'].includes(b.action))throw Error('INVALID_ACTION');
    const id=randomBytes(12).toString('hex');const operation={id,instanceId:i.id,state:'running'};operations.set(id,operation);busy.add(i.id);
    void (async()=>{try{
     if(b.action==='start')await startDetachedInstance(i);
     if(['stop','restart','archive'].includes(b.action)){const result=await stopInstance(i);if(result.restarted)throw Error('INSTANCE_RESTARTED');}
     if(b.action==='restart')await startDetachedInstance(i);
     if(b.action==='apply'){const s=await instanceStatus(i);if(!['running','stopped'].includes(s.phase))throw Error('INSTANCE_NOT_READY');await instanceRequest(i,'apply',String(b.revision));}
     if(b.action==='copy'){const cfg=(await store.loadInstanceConfig(i)).config;await store.createInstance(String(b.name),{config:{...cfg,port:await store.suggestPort(homedir(),cfg.allowLan?'0.0.0.0':'127.0.0.1')},requiredAccess:i.requiredAccess});}
     if(['archive','restore','rename','default'].includes(b.action))await store.changeRegistry(async r=>{const item=r.instances.find(x=>x.id===i.id)!;if(b.action==='archive'){item.archived=true;if(r.defaultInstanceId===i.id)r.defaultInstanceId=null;}if(b.action==='restore')item.archived=false;if(b.action==='default')r.defaultInstanceId=i.id;if(b.action==='rename'){if(r.instances.some(x=>x.name===b.name))throw Error('INSTANCE_NAME_EXISTS');item.name=String(b.name);}});
     operation.state='complete';
    }catch(e){Object.assign(operation,{state:'error',error:e instanceof Error?e.message:'FAILED'});}finally{busy.delete(i.id);if(operations.size>200){const old=[...operations.values()].find(x=>x.state!=='running');if(old)operations.delete(old.id);}}})();send(202,operation);return;
   }
   if(action==='config'){
    if(req.method==='POST'){const current=await store.loadInstanceConfig(i);let text=b.text!==undefined?String(b.text):current.text;if(b.patch){for(const [key,value] of Object.entries(b.patch))text=applyEdits(text,modify(text,[key],value,{formattingOptions:{insertSpaces:true,tabSize:2}}));}const config=await store.validateConfig(store.parseConfig(text));if(b.validate){send(200,{config,text,warnings:store.configWarnings(config,text)});return;}await approve(config,b.approved,i);const saved=await store.saveInstanceConfig(i,text,String(b.revision));await consent(i,config);send(200,saved);return;}send(200,await store.loadInstanceConfig(i));return;
   }
   if(action==='access'){
    const access=await createAccessControl(p.access);let created;
    if(req.method==='POST'){
     if(b.op==='create')created=await access.create(String(b.name),b.expiresAt||null);
     else if(b.op==='revoke')await access.revoke(String(b.id));else if(b.op==='oauth-revoke')await access.revokeOAuth(String(b.id));
     else if(b.op==='mode'){if(!['ingress','api-key','oauth'].includes(b.mode))throw Error('INVALID_MODE');await access.setMode(b.mode);await store.changeRegistry(async r=>{r.instances.find(x=>x.id===i.id)!.requiredAccess=b.mode;});}
     else if(b.op==='oauth')await access.configureOAuth(await discoverOAuth(b.config));else throw Error('INVALID_ACTION');
    }const s=await instanceStatus(i);const c=s.active?.config;const urls=s.phase==='running'&&s.port?[`http://127.0.0.1:${s.port}/mcp`,...(c?.allowLan?Object.values(networkInterfaces()).flatMap(v=>v??[]).filter(v=>!v.internal&&v.family==='IPv4').map(v=>`http://${v.address}:${s.port}/mcp`):[])]:[];send(200,{...await access.snapshot(),created,urls});return;
   }
   if(action==='activity'){const s=await instanceStatus(i);if(s.phase!=='running'||!s.port){send(200,{available:false});return;}const result=await fetch(`http://127.0.0.1:${s.port}/dashboard.json`,{signal:AbortSignal.timeout(2000)});const snapshot=await result.json() as {instance?:{id:string}};if(snapshot.instance?.id!==i.id)throw Error('INSTANCE_IDENTITY_CHANGED');const activity=await fetch(`http://127.0.0.1:${s.port}/activity.json`,{signal:AbortSignal.timeout(2000)}).then(r=>r.ok?r.json():null);send(200,{available:!!activity,activity,snapshot,lan:Object.values(networkInterfaces()).flatMap(x=>x??[]).filter(x=>!x.internal&&x.family==='IPv4').map(x=>x.address)});return;}
   if(action==='calls'){
    const status=await instanceStatus(i);
    if(status.phase!=='running'||!status.port){send(200,{available:false,entries:[]});return;}
    const owner=await createAccessControl(p.access);
    const response=await fetch(`http://127.0.0.1:${status.port}/tool-calls.json?instanceId=${encodeURIComponent(i.id)}`,{
      headers:{authorization:'Bearer '+await owner.ownerToken()},signal:AbortSignal.timeout(3000),
      ...(req.method==='POST'?{method:'POST',body:JSON.stringify(b)}:{})});
    if(!response.ok)throw Error('CALL_LOG_UNAVAILABLE');
    const snapshot=await response.json() as {instanceId?:string};
    if(snapshot.instanceId!==i.id)throw Error('INSTANCE_IDENTITY_CHANGED');
    send(200,{...snapshot,available:true});return;
   }
   if(action==='logs'){
    const kind=url.searchParams.get('kind')??'core';if(!['core','supervisor'].includes(kind))throw Error('INVALID_LOG');const file=path.join(p.logs,kind+'.log');if(!await store.exists(file)){send(200,{text:'',cursor:null});return;}
    // Verify identity before opening, and read only a bounded tail rather than the whole log.
    const {lstat}=await import('node:fs/promises');const st=await lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||(process.getuid&&st.uid!==process.getuid()))throw Error('UNSAFE_LOG');const fd=await open(file,'r');try{const actual=await fd.stat();if(actual.ino!==st.ino||actual.dev!==st.dev)throw Error('LOG_CHANGED');const identity=`${actual.dev}:${actual.ino}`;const previous=url.searchParams.get('cursor');const parts=previous?.split(':');const offset=parts?Number(parts[2]):0;const reset=!!previous&&(parts?.slice(0,2).join(':')!==identity||!Number.isSafeInteger(offset)||offset>actual.size);const start=previous&&!reset?Math.max(offset,actual.size-262144):Math.max(0,actual.size-262144);const buffer=Buffer.alloc(actual.size-start);await fd.read(buffer,0,buffer.length,start);send(200,{text:previous&&!reset?buffer.toString('utf8'):buffer.toString('utf8').split('\n').slice(-201).join('\n'),cursor:`${identity}:${actual.size}`,reset,truncated:start>(previous&&!reset?offset:0)});}finally{await fd.close();}return;
   }
   if(action==='permissions'||action==='filters'){
    const cfg=(await store.loadInstanceConfig(i)).config;if(store.usesGlobalPermissions(cfg)){send(410,{error:'GLOBAL_MODE'});return;}const grants=await createWorkspaceGrants({file:p.grants});const deny=await createDenyRules({file:p.deny});if(req.method==='POST'){if(action==='permissions')await grants.update(String(b.op),{target:b.target,mode:b.mode});else await deny.update(String(b.op),b.value);}if(action==='permissions'){send(200,await grants.snapshot());return;}let tools:unknown[]=[];const state=await instanceStatus(i);if(state.phase==='running'&&state.port)try{const response=await fetch(`http://127.0.0.1:${state.port}/catalog.json`,{signal:AbortSignal.timeout(2000)});const catalog=await response.json() as {instanceId:string;tools:unknown[]};if(catalog.instanceId===i.id)tools=catalog.tools;}catch{}send(200,{...await deny.snapshot(),tools});return;
   }
   if(action==='secrets'){const file=path.join(p.state,'secrets.json');const read=async()=>await store.exists(file)?JSON.parse(await store.readTrusted(file)) as Record<string,string>:{};
    if(req.method==='POST')await withPrivateLock(file+'.lock',async()=>{if(!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(b.name)||!['set','remove'].includes(b.op))throw Error('INVALID_SECRET');const secrets=await read();if(b.op==='set')secrets[b.name]=String(b.value);else delete secrets[b.name];await store.atomicPrivate(file,JSON.stringify(secrets));});send(200,{names:Object.keys(await read())});return;}
   send(405,{error:'METHOD_NOT_ALLOWED'});
  }catch(e){const error=e instanceof Error?e.message:'REQUEST_FAILED';send(error.includes('CONFLICT')?409:400,{error});}
 });
 let previous=0;try{previous=(JSON.parse(await store.readTrusted(recordFile())) as RecordData).port;}catch{}
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(previous||0,'127.0.0.1',resolve);}).catch(async e=>{if((e as NodeJS.ErrnoException).code!=='EADDRINUSE')throw e;await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));});
 const address=server.address();if(!address||typeof address==='string')throw Error('LISTEN_FAILED');port=address.port;await store.atomicPrivate(recordFile(),JSON.stringify({pid:process.pid,port,token,runId}));process.send?.({ready:true});
}
async function approve(config:store.InstanceConfig,approved:unknown,i?:store.Instance){if(config.accessRole==='trusted'&&config.writeScope==='unrestricted'&&!approved&&!(i&&await store.exists(path.join(store.instancePaths(i).state,'coding-consent.json'))))throw Error('CODING_APPROVAL_REQUIRED');}
async function consent(i:store.Instance,c:store.InstanceConfig){if(c.accessRole==='trusted'&&c.writeScope==='unrestricted')await store.atomicPrivate(path.join(store.instancePaths(i).state,'coding-consent.json'),JSON.stringify({version:1,scope:'os-account',approvedAt:new Date().toISOString()}));}

async function gatewayState(instance:store.Instance){
 const status=await instanceStatus(instance);if(status.phase!=='running'||!status.port)return null;
 try{const owner=await createAccessControl(store.instancePaths(instance).access);const response=await fetch(`http://127.0.0.1:${status.port}/gateway-state.json?instanceId=${encodeURIComponent(instance.id)}`,{headers:{authorization:'Bearer '+await owner.ownerToken()},signal:AbortSignal.timeout(2000)});if(!response.ok)return null;const result=await response.json() as {instanceId:string};return result.instanceId===instance.id?result:null;}catch{return null;}
}
