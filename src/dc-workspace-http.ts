import {resourceMetadata,metadataUrl,oauthChallenge,OAuthError} from './oauth-resource.js';
import {randomUUID} from 'node:crypto';
import {createAccessControl} from './access-control.js';
import {accessPage,accessPost,accessHeaders} from './access-dashboard.js';
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
// SDK 1.32.1 transport callback optionality predates exactOptionalPropertyTypes.
// The transport satisfies the runtime interface; keep the compatibility cast local.
import type { AuditSink } from "./contracts.js";
import { isSafeInteger } from "./validation.js";
// Explicit project-root Desktop Commander MCP endpoint. Never exposed to public Caddy.
// Start only with owner-approved STARMUX_PROJECT_ROOT; no default HOME traversal.
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
import { createMCPUpstreamRouter } from "./mcp-upstream-router.js";
import { collectOperationsSnapshot,dashboardHeaders,renderOperationsHtml,instancePage } from "./ops-dashboard.js";
import { applyPermissionPost,permissionHeaders,renderPermissionDashboard } from "./permissions-dashboard.js";
import { createPrivateMCPActivity } from "./private-mcp-activity.js";
import { createGitWorkflow } from "./project-git-workflow.js";
import { createProjectPolicy } from "./project-workspace-policy.js";
import { createWorkspaceGrants } from "./workspace-grants.js";
import { createAccountAccessPolicy } from './account-access-policy.js';
import { isAllowedGatewayHost } from './http-host-policy.js';

export interface RuntimeOptions {env?: NodeJS.ProcessEnv; audit?: AuditSink}
export interface GatewayRuntime {start(): Promise<void>; close(): Promise<void>; readonly port: number|null}
/** Construction and imports are inert; only start acquires resources. */
export function createGatewayRuntime(options: RuntimeOptions={}): GatewayRuntime {
  let running: Awaited<ReturnType<typeof initializeGateway>>|null=null;
  let starting: Promise<void>|null=null;
  let closing: Promise<void>|null=null;
  return {
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
const page=(html:string)=>instancePage(html,env.STARMUX_INSTANCE_NAME,env.STARMUX_INSTANCE_ID);
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
let configured: Awaited<ReturnType<typeof bootstrapConfiguredUpstreams>>|undefined;
let http: import('node:http').Server|undefined;
const bridges=new Set<import('@modelcontextprotocol/sdk/server/index.js').Server>();
async function close(){
  const server=http;
  const stopped=server?.listening ? new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())) : Promise.resolve();
  server?.closeAllConnections();
  await Promise.allSettled([...bridges].map(bridge=>bridge.close()));
  await Promise.allSettled([upstream.close(),...(configured?.upstreams??[]).map(child=>child.close())]);
  await stopped;
}
try {
await upstream.connect();
// Default configuration remains the original Desktop Commander-only profile.
// Additional trusted operator-owned routes require an explicit private config.
configured=await bootstrapConfiguredUpstreams(env.STARMUX_UPSTREAMS_FILE,audit);
const router=createMCPUpstreamRouter({routes:[
  {id:"desktop",upstream,exposeNativeNames:true},...configured.routes
]});
// The instance supervisor enables this bounded, owner-local activity observer.
if(env.STARMUX_PRIVATE_ACTIVITY_OBSERVER==="1")
  activity=createPrivateMCPActivity({routeFor:name=>router.routeFor(name)});
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
  if(req.socket.remoteAddress!=="127.0.0.1"){denyRequest('LOOPBACK_REQUIRED');return;}
  let route: string;
  try{route=new URL(req.url||"/","http://localhost").pathname;}
  catch{res.writeHead(400).end('Invalid request target');return;}
  const address=http?.address();
  const port=address&&typeof address!=="string"?address.port:null;
  if(!isAllowedGatewayHost(req,port,route)){denyRequest('HOST_NOT_ALLOWED');return;}
  if(globalPermissions&&(route==='/permissions'||route==='/filters')){
    res.writeHead(410,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});
    res.end('Starmux uses global Read-only or Coding mode. Directory grants and tool filters do not apply. Use starmux up --read or starmux up --code.');
    return;
  }
  if(route.startsWith('/.well-known/oauth-protected-resource')&&(req.method==='GET'||req.method==='OPTIONS')){
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
  if((route==="/dashboard"||route==="/dashboard.json")&&req.method==="GET"){
    try{
      const snapshot={...await collectOperationsSnapshot(),configuredUpstreams:configured!.status(),
        ...(env.STARMUX_INSTANCE_ID?{instance:{id:env.STARMUX_INSTANCE_ID,name:env.STARMUX_INSTANCE_NAME??env.STARMUX_INSTANCE_ID,port:desiredPort}}:{}),
        accessControl:await access.snapshot(),
        permissionManagementEnabled:Boolean(grants),
        nativeAccessEnabled:nativeAccessMode==="native",
        permissionMode:globalPermissions?'global':'workspace',
        denyRuleManagementEnabled:Boolean(denyRules)};
      const json=route.endsWith(".json");
      res.writeHead(200,{...dashboardHeaders,
        "content-type":json?"application/json; charset=utf-8":"text/html; charset=utf-8"});
      res.end(json?JSON.stringify(snapshot):renderOperationsHtml(snapshot));
    }catch{
      res.writeHead(503,{...dashboardHeaders,"content-type":"text/plain"});
      res.end("Dashboard temporarily unavailable");
    }
    return;
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
      writeScope,accessMode,...(env.STARMUX_INSTANCE_ID?{instanceId:env.STARMUX_INSTANCE_ID,instanceName:env.STARMUX_INSTANCE_NAME}:{})}));
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
  if(req.method!=='POST'){res.writeHead(405,{allow:'POST'}).end('Method not allowed');return;}
  const oauth=identity.kind==='verified-oauth'?await access.oauthSettings().catch(()=>null):null;
  if(identity.kind==='verified-oauth'&&!oauth){res.writeHead(503).end('Access configuration unavailable');return;}
  const request={requestId:randomUUID(),identity};
  audit({event:'MCP_REQUEST_ACCEPTED',requestId:request.requestId,identityKind:identity.kind,
    ...(identity.kind==='verified-api-key'?{credentialId:identity.credentialId}:identity.kind==='verified-oauth'?{connectionId:identity.connectionId}:{})});
  const transport=new StreamableHTTPServerTransport({
    enableJsonResponse:true
  });
  const gateway=createDesktopCommanderBridge(router,audit,{
    request,...(oauth?{oauthScope:oauth.scope}:{}),workspacePolicy,upstreamRouter:router,
    nativePassthrough:nativeAccessMode==="native",denyRules,
    globalReadOnly,permissionMode:globalPermissions?'global':'workspace',
    ...(gitWorkflow?{gitWorkflow}:{})
  });
  bridges.add(gateway);
  res.on("close",()=>{bridges.delete(gateway);void transport.close();void gateway.close();});
  try{await gateway.connect(transport as Transport);await transport.handleRequest(req,res);}
  catch{if(!res.headersSent)res.writeHead(500).end("MCP failure");}
});
http.requestTimeout=12000;
http.headersTimeout=10000;
await new Promise<void>((resolve,reject)=>{
  http!.once('error',reject);
  http!.listen(desiredPort,'127.0.0.1',()=>{http!.off('error',reject);resolve();});
});
const address=http.address();
if(!address||typeof address==='string')throw Error('INVALID_LISTENER_ADDRESS');
audit({event:'PROJECT_WORKSPACE_LISTENING',port:address.port,mode});
return {port:address.port,close};
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
