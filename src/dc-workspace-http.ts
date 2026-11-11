import {GatewaySnapshot} from './gateway-snapshot.js';
import {readConfiguredUpstreams} from './configured-mcp-upstreams.js';
import {MiddlewareEngine} from './middleware-engine.js';
import {middlewareConfigSchema} from './middleware-config.js';
import {readTrusted} from './instance-store.js';
import {styleLegacyDashboard} from './dashboard-ui.js';
import {resourceMetadata,metadataUrl,oauthChallenge,OAuthError} from './oauth-resource.js';
import {randomUUID} from 'node:crypto';
import {createAccessControl} from './access-control.js';
import {accessPage,accessPost,accessHeaders} from './access-dashboard.js';
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
// SDK 1.32.1 transport callback optionality predates exactOptionalPropertyTypes.
// The transport satisfies the runtime interface; keep the compatibility cast local.
import type { AuditSink } from "./contracts.js";
import { isSafeInteger } from "./validation.js";
// Explicit project-root Desktop Commander MCP endpoint. Client routes may be
// exposed via LAN/proxy; owner routes always retain loopback and local Host checks.
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { createAuthorizedWorkspacePolicy } from "./authorized-workspace-roots.js";
import { bootstrapConfiguredUpstreams } from "./configured-mcp-upstreams.js";
import { probeCurrentDirectoryAccess } from "./current-permission-probe.js";
import { applyDenyPost,denyPageHeaders,renderDenyDashboard } from "./deny-dashboard.js";
import { createDesktopCommanderBridge } from "./desktop-commander-facade.js";
import { createDenyRules } from "./explicit-deny-rules.js";
import { LocalDesktopReadProbe } from "./local-desktop-read-probe.js";
import { createManagedWorkspacePolicy } from "./managed-workspace-policy.js";
import { createMCPUpstreamRouter,validateGatewayCatalogs } from "./mcp-upstream-router.js";
import { collectOperationsSnapshot,dashboardHeaders,renderOperationsHtml,instancePage } from "./ops-dashboard.js";
import { applyPermissionPost,permissionHeaders,renderPermissionDashboard } from "./permissions-dashboard.js";
import {createToolCallLog} from './tool-call-log.js';
import { createPrivateMCPActivity } from "./private-mcp-activity.js";
import { createGitWorkflow } from "./project-git-workflow.js";
import { createProjectPolicy } from "./project-workspace-policy.js";
import { createWorkspaceGrants } from "./workspace-grants.js";
import { createAccountAccessPolicy } from './account-access-policy.js';
import { isAllowedGatewayHost,isClientFacingGatewayRoute,isLoopbackSocketAddress } from './http-host-policy.js';

export interface RuntimeOptions {env?: NodeJS.ProcessEnv; audit?: AuditSink}
export interface GatewayRuntime {apply(upstreamFile?:string,middlewareFile?:string,forceId?:string,deadline?:number):Promise<void>;start(): Promise<void>; close(): Promise<void>; readonly port: number|null}
/** Construction and imports are inert; only start acquires resources. */
export function createGatewayRuntime(options: RuntimeOptions={}): GatewayRuntime {
  let running: Awaited<ReturnType<typeof initializeGateway>>|null=null;
  let starting: Promise<void>|null=null;
  let closing: Promise<void>|null=null;
  return {
    async apply(upstreamFile,middlewareFile,forceId,deadline){if(!running)throw Error("INSTANCE_NOT_RUNNING");await running.apply(upstreamFile,middlewareFile,forceId,deadline);},
    get port(){return running?.port??null;},
    async start(){
      if(closing)await closing;
      if(running)return;
      if(!starting)starting=initializeGateway(options).then(value=>{running=value;}).finally(()=>{starting=null;});
      await starting;
    },
    async close(){
      if(closing)return closing;
      closing=(async()=>{
        if(starting)await starting.catch(()=>{});
        const current=running;running=null;
        await current?.close();
      })().finally(()=>{closing=null;});
      await closing;
    }
  };
}
async function initializeGateway({env=process.env,audit:externalAudit}: RuntimeOptions){
const access=await createAccessControl(env.STARMUX_ACCESS_FILE);
const page=(html:string)=>styleLegacyDashboard(instancePage(html,env.STARMUX_INSTANCE_NAME,env.STARMUX_INSTANCE_ID));
const root=env.STARMUX_PROJECT_ROOT;
if(!root)throw new Error("OWNER_APPROVED_PROJECT_ROOT_REQUIRED");
const mode=env.STARMUX_WORKSPACE_MODE||"read-only";
const developerCommands=env.STARMUX_DEV_COMMANDS||"presets";
const nativeAccessMode=env.STARMUX_DC_ACCESS_MODE||"workspace";
const writeScope=env.STARMUX_DC_WRITE_SCOPE||"unrestricted";
const globalPermissions=env.STARMUX_PERMISSION_MODE==='global';
const globalReadOnly=globalPermissions&&mode==='read-only';
if(!["unrestricted","home-only"].includes(writeScope)||
   (writeScope==="home-only"&&nativeAccessMode!=="native"))
  throw Error("HOME_WRITE_SCOPE_REQUIRES_NATIVE_ROLE");
if(writeScope==="home-only"&&env.STARMUX_UPSTREAMS_FILE)
  throw Error("HOME_WRITE_SCOPE_UNSANDBOXED_EXTRA_UPSTREAMS");
if(!["workspace","native"].includes(nativeAccessMode)||
   (nativeAccessMode==="native"&&
    (developerCommands!=="trusted-project"||mode!=="read-write")))
  throw new Error("NATIVE_ACCESS_REQUIRES_OWNER_TRUSTED_DEVELOPER_PROFILE");
if(globalPermissions&&(writeScope!=='unrestricted'||(!globalReadOnly&&nativeAccessMode!=='native')))
  throw Error('GLOBAL_ACCESS_MODE_INVALID');
const policy=globalPermissions?await createAccountAccessPolicy(root,mode):await createProjectPolicy({root,mode,developerCommands,
  allowTrustedHomeRoot:nativeAccessMode==="native"&&developerCommands==="trusted-project"});
const desiredPort=Number(env.STARMUX_PROJECT_PORT||18893);
const allowLan=env.STARMUX_ALLOW_LAN==='1';
const listenHost=allowLan?'0.0.0.0':'127.0.0.1';
if(!isSafeInteger(desiredPort)||desiredPort<0||desiredPort>65535)
  throw new Error("INVALID_PORT");
let activity: ReturnType<typeof createPrivateMCPActivity>|null=null;
const audit: AuditSink=e=>{
  activity?.observeAudit(e);
  if(externalAudit){externalAudit(e);return;}
  process.stdout.write(JSON.stringify({
  at:new Date().toISOString(),profile:"project-workspace",...e
})+"\n");
};
const upstream=new LocalDesktopReadProbe({writeScope});
let programmableMiddleware:MiddlewareEngine|undefined;
let callLog:ReturnType<typeof createToolCallLog>|undefined;
let snapshot:GatewaySnapshot|undefined;let closingGateway=false;let applying=false;
let configured: Awaited<ReturnType<typeof bootstrapConfiguredUpstreams>>|undefined;
let http: import('node:http').Server|undefined;
const bridges=new Set<import('@modelcontextprotocol/sdk/server/index.js').Server>();
const sessions=new Map<string,{transport:StreamableHTTPServerTransport;gateway:import('@modelcontextprotocol/sdk/server/index.js').Server;identity:string;lastSeen:number;active:number}>();

async function close(){
  closingGateway=true;snapshot?.retire();
  const server=http;
  const stopped=server?.listening ? new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())) : Promise.resolve();
  server?.closeAllConnections();
  await Promise.allSettled([...bridges].map(bridge=>bridge.close()));
  await Promise.allSettled([upstream.close(),...(configured?.upstreams??[]).map(child=>child.close())]);
  await programmableMiddleware?.close();
  await stopped;
}
try {
// Default configuration remains the original Desktop Commander-only profile.
// Additional trusted operator-owned routes require an explicit private config.
// Settle both branches before cleanup, including when the required engine fails.
// Optional discovery must not consume its budget after the engine's startup.
const startup=await Promise.allSettled([
  upstream.connect(),
  bootstrapConfiguredUpstreams(env.STARMUX_UPSTREAMS_FILE,audit).then(value=>{configured=value;})
]);
for(const result of startup)if(result.status==='rejected')throw result.reason;
let router=createMCPUpstreamRouter({routes:[
  {id:"desktop",upstream,exposeNativeNames:true},...configured!.routes
]});
await validateGatewayCatalogs(router);
if(env.STARMUX_MIDDLEWARES_FILE){
 const configs=JSON.parse(await readTrusted(env.STARMUX_MIDDLEWARES_FILE)) as unknown;
 const parsed=middlewareConfigSchema.array().max(32).parse(configs);
 programmableMiddleware=await MiddlewareEngine.create(parsed,router.upstreamCatalog.map(tool=>({tool,target:router.targetFor!(tool.name)!})),process.cwd(),event=>{callLog?.middlewareTrace(event);audit({event:'MIDDLEWARE_STAGE',...event});});
}
let currentUpstreamFile=env.STARMUX_UPSTREAMS_FILE,currentMiddlewareFile=env.STARMUX_MIDDLEWARES_FILE;
const catalogChanges=new Set<string>();let refreshTimer:NodeJS.Timeout|undefined;
const refreshCatalog=()=>{if(closingGateway)return;const id=catalogChanges.values().next().value;if(!id)return;if(applying){refreshTimer=setTimeout(refreshCatalog,100);refreshTimer.unref();return;}catalogChanges.delete(id);void apply(currentUpstreamFile,currentMiddlewareFile,id).catch(()=>audit({event:'UPSTREAM_CATALOG_REFRESH_FAILED',route:id})).finally(()=>{if(catalogChanges.size)refreshCatalog();});};
configured!.registry.onCatalogChanged=id=>{catalogChanges.add(id);if(refreshTimer)clearTimeout(refreshTimer);refreshTimer=setTimeout(refreshCatalog,100);refreshTimer.unref();};
snapshot=new GatewaySnapshot(router,programmableMiddleware,[...configured!.upstreams,...(programmableMiddleware?[programmableMiddleware]:[])]);
async function apply(upstreamFile?:string,middlewareFile?:string,forceId?:string,deadline=Date.now()+55000){
 const signal=AbortSignal.timeout(Math.max(1,deadline-Date.now()));
 if(closingGateway)throw Error('INSTANCE_STOPPING');if(applying)throw Error('INSTANCE_BUSY');applying=true;
 let candidate:Awaited<ReturnType<import('./server-registry.js').ServerRegistry['prepare']>>|undefined;let pipeline:MiddlewareEngine|undefined;
 try{
  const definitions=upstreamFile?await readConfiguredUpstreams(upstreamFile):[];
  candidate=await configured!.registry.prepare({version:1,upstreams:definitions},forceId,signal);
  const nextRouter=createMCPUpstreamRouter({routes:[{id:'desktop',upstream,exposeNativeNames:true},...configured!.registry.routes(candidate.services)]});
  await validateGatewayCatalogs(nextRouter);
  const configs=middlewareFile?middlewareConfigSchema.array().max(32).parse(JSON.parse(await readTrusted(middlewareFile))):[];
  if(configs.some(c=>c.enabled!==false))pipeline=await MiddlewareEngine.create(configs,nextRouter.upstreamCatalog.map(tool=>({tool,target:nextRouter.targetFor!(tool.name)!})),process.cwd(),event=>{callLog?.middlewareTrace(event);audit({event:'MIDDLEWARE_STAGE',...event});},signal,forceId==='__middleware__'?undefined:snapshot?.middleware);
  if(closingGateway||signal.aborted)throw Error('GATEWAY_APPLY_TIMEOUT');
  const old=snapshot!;const disabled=configured!.upstreams.filter(s=>!candidate!.services.some(n=>n.id===s.id&&n.definition.enabled!==false));
  const next=new GatewaySnapshot(nextRouter,pipeline,[...candidate.services,...(pipeline?[pipeline]:[])]);
  candidate.commit();currentUpstreamFile=upstreamFile;currentMiddlewareFile=middlewareFile;router=nextRouter;programmableMiddleware=pipeline;snapshot=next;old.retire();
  for(const session of sessions.values()){void session.gateway.sendToolListChanged().catch(()=>{});void session.gateway.sendResourceListChanged().catch(()=>{});void session.gateway.sendPromptListChanged().catch(()=>{});}
  // Disabled/removed services reject new calls immediately via the new catalog;
  // old calls have a bounded drain before their transport is cancelled.
  for(const service of disabled){const timer=setTimeout(()=>{void service.close();},5000);timer.unref();}
 }catch(error){await pipeline?.close();await Promise.allSettled(candidate?.created.map(s=>s.close())??[]);throw error;}
 finally{applying=false;}
}
// The instance supervisor enables this bounded, owner-local activity observer.
if(env.STARMUX_PRIVATE_ACTIVITY_OBSERVER==="1")
  activity=createPrivateMCPActivity({routeFor:name=>router.routeFor(name)});
callLog=createToolCallLog({routeFor:name=>router.routeFor(snapshot?.middleware?.canonical(name)??name)});
const worktreeMode=env.STARMUX_WORKTREE_MODE||"off";
if(!["off","linked"].includes(worktreeMode))throw Error("INVALID_WORKTREE_MODE");
const worktreePolicy=createAuthorizedWorkspacePolicy({
  basePolicy:policy,linkedGitWorktrees:globalPermissions?'off':worktreeMode
});
// Explicit opt-in: existing/private deployments remain unchanged without this file.
const grants=!globalPermissions&&env.STARMUX_GRANTS_FILE?
  await createWorkspaceGrants({file:env.STARMUX_GRANTS_FILE,audit}):null;
const workspacePolicy=grants?
  createManagedWorkspacePolicy({basePolicy:worktreePolicy,grants}):worktreePolicy;
// Optional explicit deny preferences: default empty, independent from DC tools.
// Owner-managed only via the same local token as Workspace Permissions.
if(!globalPermissions&&env.STARMUX_DENY_FILE&&!grants)
  throw Error("DENY_CONSOLE_REQUIRES_OWNER_GRANTS");
const denyRules=!globalPermissions&&env.STARMUX_DENY_FILE?
  await createDenyRules({file:env.STARMUX_DENY_FILE,audit}):null;
const gitMode=globalPermissions?'off':env.STARMUX_GIT_MODE||"off";
if(!["off","review","write","push"].includes(gitMode))throw new Error("INVALID_GIT_MODE");
if(writeScope==="home-only"&&gitMode!=="off")
  throw Error("HOME_WRITE_SCOPE_GATEWAY_GIT_MUST_BE_OFF");
const gitWorkflow=gitMode==="off"?null:createGitWorkflow({
  policy,upstream,writesEnabled:gitMode==="write"||gitMode==="push",
  pushEnabled:gitMode==="push"
});
http=createServer(async(req,res)=>{
  const denyRequest=(reason:'LOOPBACK_REQUIRED'|'HOST_NOT_ALLOWED')=>{
    audit({event:'HTTP_REQUEST_DENIED',reason});
    res.writeHead(403,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'}).end(reason);
  };
  const isLoopback=isLoopbackSocketAddress(req.socket.remoteAddress);
  if(!isLoopback&&!allowLan){denyRequest('LOOPBACK_REQUIRED');return;}
  let route: string;
  try{route=new URL(req.url||"/","http://localhost").pathname;}
  catch{res.writeHead(400).end('Invalid request target');return;}
  if(!isLoopback&&!isClientFacingGatewayRoute(route)){denyRequest('LOOPBACK_REQUIRED');return;}
  const address=http?.address();
  const port=address&&typeof address!=="string"?address.port:null;
  if(!isAllowedGatewayHost(req,port,route)){denyRequest('HOST_NOT_ALLOWED');return;}
  if(globalPermissions&&(route==='/permissions'||route==='/filters')){
    res.writeHead(410,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});
    res.end('Starmux uses global Read-only or Coding mode. Directory grants and tool filters do not apply. Use starmux up --read or starmux up --code.');
    return;
  }
  if((route==='/.well-known/oauth-protected-resource'||route.startsWith('/.well-known/oauth-protected-resource/'))&&(req.method==='GET'||req.method==='OPTIONS')){
    try{
      const config=await access.oauthSettings();
      if(!config||![new URL(metadataUrl(config)).pathname,'/.well-known/oauth-protected-resource'].includes(route)){
        res.writeHead(404).end('Not found');return;
      }
      res.writeHead(req.method==='OPTIONS'?204:200,{'content-type':'application/json','cache-control':'no-store',
        'access-control-allow-origin':'*','access-control-allow-methods':'GET, OPTIONS'});
      res.end(req.method==='OPTIONS'?undefined:JSON.stringify(resourceMetadata(config)));
    }catch{res.writeHead(503).end('Access configuration unavailable');}
    return;
  }
  // Only the owner authorization form accepts an Origin; MCP remains no-CORS.
  if(req.headers.origin&&!(
    (route==="/permissions"||route==="/filters"||route==="/access")&&req.method==="POST")){
    res.writeHead(403).end("Denied");return;
  }
  if(route==="/access"){
    try{
      if(req.method==="GET"){
        res.writeHead(200,{...accessHeaders,"content-type":"text/html; charset=utf-8"}).end(page(accessPage(await access.snapshot())));
      }else if(req.method==="POST"){
        const result=await accessPost(req,access);
        if(result.status===200&&env.STARMUX_INSTANCE_ID){
          const {changeRegistry,instancePaths}=await import('./instance-store.js');
          await changeRegistry(async registry=>{
            const instance=registry.instances.find(i=>i.id===env.STARMUX_INSTANCE_ID);
            if(instance&&instancePaths(instance).access===access.file)instance.requiredAccess=(await access.snapshot()).mode;
          });
        }
        res.writeHead(result.status,{...accessHeaders,"content-type":"text/html; charset=utf-8"}).end(page(result.html||"Access update rejected"));
      }else res.writeHead(405).end();
    }catch{res.writeHead(503,{...accessHeaders}).end("Access configuration unavailable");}
    return;
  }
  if(route==="/filters"&&denyRules&&grants){
    if(req.method==="GET"){
      try{
        const state=await denyRules.snapshot();
        res.writeHead(200,{...denyPageHeaders,
          "content-type":"text/html; charset=utf-8"});
        res.end(renderDenyDashboard({rules:state,toolCatalog:[
          ...router.upstreamCatalog,...(gitWorkflow?gitWorkflow.names.map(name=>({name})):[]),
          ...(workspacePolicy.prepareDiskUsage?[{name:"gateway_disk_usage"}]:[]),
          {name:"health_check"}
        ]}));
      }catch{
        res.writeHead(503,{...denyPageHeaders}).end("Tool filters unavailable");
      }
      return;
    }
    if(req.method==="POST"){
      const result=await applyDenyPost(req,denyRules,
        token=>grants.authorized(token),req.headers.host);
      res.writeHead(result.status,{...denyPageHeaders,
        ...(result.location?{location:result.location}:{}),
        "content-type":"text/plain; charset=utf-8"});
      res.end(result.message||"Updated");
      return;
    }
    res.writeHead(405).end("Method not allowed");return;
  }
  if(route==="/permissions"&&grants){
    if(req.method==="GET"){
      try{
        const data=await grants.snapshot({validatePaths:false});
        res.writeHead(200,{...permissionHeaders,
          "content-type":"text/html; charset=utf-8"});
        res.end(page(renderPermissionDashboard({
          project:{path:policy.root,mode:policy.mode},home:grants.home,config:data,
          nativeAccessEnabled:nativeAccessMode==="native"
        })));
      }catch{
        res.writeHead(503,{...permissionHeaders}).end("Permissions unavailable");
      }
      return;
    }
    if(req.method==="POST"){
      const result=await applyPermissionPost(req,grants,req.headers.host);
      res.writeHead(result.status,{...permissionHeaders,
        ...(result.location?{location:result.location}:{}),
        "content-type":"text/plain; charset=utf-8"});
      res.end(result.message||"Updated");
      return;
    }
    res.writeHead(405).end("Method not allowed");return;
  }
  if(route==='/catalog.json'&&req.method==='GET'){
    res.writeHead(200,{...dashboardHeaders,'content-type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({instanceId:env.STARMUX_INSTANCE_ID,tools:router.upstreamCatalog.map(tool=>({name:tool.name}))}));return;
  }
  if((route==="/dashboard"||route==="/dashboard.json")&&req.method==="GET"){
    try{
      const snapshot={...await collectOperationsSnapshot(),configuredUpstreams:configured!.status().map(({diagnostics,...status})=>status),
        ...(env.STARMUX_INSTANCE_ID?{instance:{id:env.STARMUX_INSTANCE_ID,name:env.STARMUX_INSTANCE_NAME??env.STARMUX_INSTANCE_ID,port:desiredPort}}:{}),
        accessControl:await access.snapshot(),
        permissionManagementEnabled:Boolean(grants),
        nativeAccessEnabled:nativeAccessMode==="native",
        permissionMode:globalPermissions?'global':'workspace',
        denyRuleManagementEnabled:Boolean(denyRules)};
      const json=route.endsWith(".json");
      res.writeHead(200,{...dashboardHeaders,
        "content-type":json?"application/json; charset=utf-8":"text/html; charset=utf-8"});
      res.end(json?JSON.stringify(snapshot):styleLegacyDashboard(renderOperationsHtml(snapshot)));
    }catch{
      res.writeHead(503,{...dashboardHeaders,"content-type":"text/plain"});
      res.end("Dashboard temporarily unavailable");
    }
    return;
  }
  if(route==='/gateway-state.json'){
    if(!await access.authorized(req.headers.authorization?.replace(/^Bearer /,''))){res.writeHead(401).end('Owner authentication required');return;}
    if(new URL(req.url!,'http://localhost').searchParams.get('instanceId')!==(env.STARMUX_INSTANCE_ID??'')){res.writeHead(409).end('Instance identity changed');return;}
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({instanceId:env.STARMUX_INSTANCE_ID,version:snapshot!.version,servers:configured!.status(),middlewares:snapshot!.middleware?.diagnostics()??[]}));return;
  }
  if(route==='/tool-calls.json'){
    if(!await access.authorized(req.headers.authorization?.replace(/^Bearer /,''))){res.writeHead(401).end('Owner authentication required');return;}
    if(new URL(req.url!,'http://localhost').searchParams.get('instanceId')!==(env.STARMUX_INSTANCE_ID??'')){res.writeHead(409).end('Instance identity changed');return;}
    if(req.method==='POST'){
      let text='';for await(const chunk of req){text+=String(chunk);if(text.length>1024){res.writeHead(413).end();return;}}
      try{
        const value=JSON.parse(text);
        if(value.op==='clear'&&Object.keys(value).length===1)callLog!.clear();
        else if(value.op==='details'&&typeof value.enabled==='boolean'&&Object.keys(value).length===2)callLog!.setDetailed(value.enabled);
        else throw Error('INVALID_OPERATION');
      }catch{res.writeHead(400).end('Invalid operation');return;}
    }else if(req.method!=='GET'){res.writeHead(405).end();return;}
    res.writeHead(200,{...dashboardHeaders,'content-type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({instanceId:env.STARMUX_INSTANCE_ID,...callLog!.snapshot()}));return;
  }
  if(route==="/activity.json"&&req.method==="GET"&&activity){
    res.writeHead(200,{...dashboardHeaders,
      "content-type":"application/json; charset=utf-8"});
    res.end(JSON.stringify(activity.snapshot()));
    return;
  }
  // A lightweight, read-only capability probe in the actual Core
  // process. Never reports macOS TCC toggle state or any file names.
  if(route==="/privacy/status"&&req.method==="GET"){
    try{
      const state=await probeCurrentDirectoryAccess();
      res.writeHead(200,{"content-type":"application/json; charset=utf-8",
        "cache-control":"no-store","x-content-type-options":"nosniff"});
      res.end(JSON.stringify(state));
    }catch{
      res.writeHead(503,{"cache-control":"no-store"}).end("Permission check unavailable");
    }
    return;
  }
  if(route==="/healthz"&&req.method==="GET"){
    res.writeHead(200,{"content-type":"application/json","cache-control":"no-store"});
    const accessMode=await access.snapshot().then(s=>s.mode).catch(()=>"unavailable");
    res.end(JSON.stringify({status:"ok",service:"dc-project-workspace",mode,
      writeScope,accessMode,allowLan,...(env.STARMUX_INSTANCE_ID?{instanceId:env.STARMUX_INSTANCE_ID,instanceName:env.STARMUX_INSTANCE_NAME}:{})}));
    return;
  }
  if(route!=="/mcp"){
    res.writeHead(404).end("Not found");return;
  }
  if(Number(req.headers["content-length"]||0)>65536){
    res.writeHead(413).end("Too large");return;
  }
  let identity: import('./contracts.js').RequestContext['identity'];
  try{identity=await access.authenticate(req.headers.authorization);}
  catch(error){
    const config=await access.oauthSettings().catch(()=>null);
    const status=error instanceof OAuthError?error.status:error instanceof Error&&error.message==='ACCESS_UNAUTHORIZED'?401:503;
    const challenge=config?oauthChallenge(config,status===403?403:401):'Bearer realm="Gateway"';
    res.writeHead(status,{"cache-control":"no-store",...(status!==503?{"www-authenticate":challenge}:{})}).end(status===503?"Access configuration unavailable":"Authentication required or access denied");return;
  }
  if(!['POST','GET','DELETE'].includes(req.method??'')){res.writeHead(405,{allow:'POST, GET, DELETE'}).end('Method not allowed');return;}
  const oauth=identity.kind==='verified-oauth'?await access.oauthSettings().catch(()=>null):null;
  if(identity.kind==='verified-oauth'&&!oauth){res.writeHead(503).end('Access configuration unavailable');return;}
  const request={requestId:randomUUID(),identity};
  audit({event:'MCP_REQUEST_ACCEPTED',requestId:request.requestId,identityKind:identity.kind,
    ...(identity.kind==='verified-api-key'?{credentialId:identity.credentialId}:identity.kind==='verified-oauth'?{connectionId:identity.connectionId}:{})});
  let parsedBody:unknown;
  if(req.method==='POST'){
    let body='';for await(const chunk of req){body+=String(chunk);if(Buffer.byteLength(body)>1048576){res.writeHead(413).end('Request too large');return;}}
    try{parsedBody=JSON.parse(body);}catch{res.writeHead(400).end('Invalid JSON');return;}
  }
  const identityKey=JSON.stringify(identity),sessionId=req.headers['mcp-session-id'];
  for(const [id,session] of sessions)if(!session.active&&Date.now()-session.lastSeen>1800000){sessions.delete(id);void session.transport.close();void session.gateway.close();}
  if(sessionId){
    const session=typeof sessionId==='string'?sessions.get(sessionId):undefined;
    if(!session||session.identity!==identityKey){res.writeHead(404).end('MCP_SESSION_NOT_FOUND: reconnect and initialize.');return;}
    session.lastSeen=Date.now();session.active++;
    try{await session.transport.handleRequest(req,res,parsedBody);}finally{session.active--;}
    return;
  }
  if(req.method!=='POST'){res.writeHead(400).end('MCP_SESSION_REQUIRED');return;}
  const initialize=!!parsedBody&&typeof parsedBody==='object'&&'method' in parsedBody&&parsedBody.method==='initialize';
  if(initialize&&sessions.size>=64){res.writeHead(503).end('MCP_SESSION_LIMIT');return;}
  let registered:string|undefined;
  const transport=new StreamableHTTPServerTransport({enableJsonResponse:!initialize,...(initialize?{
    sessionIdGenerator:()=>randomUUID(),
    onsessioninitialized:(id:string)=>{registered=id;sessions.set(id,{transport,gateway,identity:identityKey,lastSeen:Date.now(),active:0});}
  }:{})});
  const pinned=snapshot!,release=pinned.retain();
  const gateway=createDesktopCommanderBridge(pinned.router,audit,{
    getSnapshot:()=>{const selected=snapshot!;return {upstream:selected.router,router:selected.router,middleware:selected.middleware,release:selected.retain()};},
    ...(pinned.middleware?{programmableMiddleware:pinned.middleware}:{}),upstreamTrace:callLog!.stage,observer:callLog!.observer,request,...(oauth?{oauthScope:oauth.scope}:{}),workspacePolicy,upstreamRouter:pinned.router,
    nativePassthrough:nativeAccessMode==='native',denyRules,globalReadOnly,permissionMode:globalPermissions?'global':'workspace',...(gitWorkflow?{gitWorkflow}:{})
  });
  bridges.add(gateway);
  transport.onclose=()=>{if(registered){sessions.delete(registered);for(const service of configured!.upstreams)void service.releaseSession(registered);}bridges.delete(gateway);release();};
  if(!initialize)res.on('close',()=>{bridges.delete(gateway);void transport.close();void gateway.close();release();});
  try{await gateway.connect(transport as Transport);await transport.handleRequest(req,res,parsedBody);}
  catch{if(!res.headersSent)res.writeHead(500).end('MCP failure');if(!registered){void transport.close();void gateway.close();}}
  finally{release();}

});
http.requestTimeout=12000;
http.headersTimeout=10000;
await new Promise<void>((resolve,reject)=>{
  http!.once('error',reject);
  http!.listen(desiredPort,listenHost,()=>{http!.off('error',reject);resolve();});
});
const address=http.address();
if(!address||typeof address==='string')throw Error('INVALID_LISTENER_ADDRESS');
audit({event:'PROJECT_WORKSPACE_LISTENING',port:address.port,host:listenHost,allowLan,mode});
return {port:address.port,close,apply};
}catch(error){await close().catch(()=>{});throw error;}
}
/** Only the process entrypoint owns signal handlers. */
export async function runGateway(options: RuntimeOptions={}) {
  const runtime=createGatewayRuntime(options);
  await runtime.start();
  const stop=()=>{
    void runtime.close().catch(()=>{process.exitCode=1;}).finally(()=>{
      process.off('SIGINT',stop);process.off('SIGTERM',stop);
      process.off('message',message);process.off('disconnect',stop);
      if(process.connected)process.disconnect();
    });
  };
  const message=(value:unknown)=>{if(value&&typeof value==='object'&&'type' in value&&value.type==='gateway-stop')stop();};
  if(process.send){process.on('message',message);process.on('disconnect',stop);}
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  return runtime;
}
