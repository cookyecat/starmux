import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
// SDK 1.32.1 transport callback optionality predates exactOptionalPropertyTypes.
// The transport satisfies the runtime interface; keep the compatibility cast local.
import type { AuditSink } from "./contracts.js";
import { isSafeInteger } from "./validation.js";
// Explicit project-root Desktop Commander MCP endpoint. Never exposed to public Caddy.
// Start only with owner-approved MAC_MCP_PROJECT_ROOT; no default HOME traversal.
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
import { collectOperationsSnapshot,dashboardHeaders,renderOperationsHtml } from "./ops-dashboard.js";
import { applyPermissionPost,permissionHeaders,renderPermissionDashboard } from "./permissions-dashboard.js";
import { createPrivateMCPActivity } from "./private-mcp-activity.js";
import { createGitWorkflow } from "./project-git-workflow.js";
import { createProjectPolicy } from "./project-workspace-policy.js";
import { createWorkspaceGrants } from "./workspace-grants.js";

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
const root=env.MAC_MCP_PROJECT_ROOT;
if(!root)throw new Error("OWNER_APPROVED_PROJECT_ROOT_REQUIRED");
const mode=env.MAC_MCP_WORKSPACE_MODE||"read-only";
const developerCommands=env.MAC_MCP_DEV_COMMANDS||"presets";
const nativeAccessMode=env.MAC_MCP_DC_ACCESS_MODE||"workspace";
const writeScope=env.MAC_MCP_DC_WRITE_SCOPE||"unrestricted";
if(!["unrestricted","home-only"].includes(writeScope)||
   (writeScope==="home-only"&&nativeAccessMode!=="native"))
  throw Error("HOME_WRITE_SCOPE_REQUIRES_NATIVE_ROLE");
if(writeScope==="home-only"&&env.MAC_MCP_UPSTREAMS_FILE)
  throw Error("HOME_WRITE_SCOPE_UNSANDBOXED_EXTRA_UPSTREAMS");
if(!["workspace","native"].includes(nativeAccessMode)||
   (nativeAccessMode==="native"&&
    (developerCommands!=="trusted-project"||mode!=="read-write")))
  throw new Error("NATIVE_ACCESS_REQUIRES_OWNER_TRUSTED_DEVELOPER_PROFILE");
const policy=await createProjectPolicy({root,mode,developerCommands,
  allowTrustedHomeRoot:nativeAccessMode==="native"&&developerCommands==="trusted-project"});
const desiredPort=Number(env.MAC_MCP_PROJECT_PORT||8793);
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
configured=await bootstrapConfiguredUpstreams(env.MAC_MCP_UPSTREAMS_FILE,audit);
const router=createMCPUpstreamRouter({routes:[
  {id:"desktop",upstream,exposeNativeNames:true},...configured.routes
]});
// Owner explicitly opts in on isolated development runs only.
// Not enabled in the currently deployed 8793 process.
if(env.MAC_MCP_PRIVATE_ACTIVITY_OBSERVER==="1")
  activity=createPrivateMCPActivity({routeFor:name=>router.routeFor(name)});
const worktreeMode=env.MAC_MCP_WORKTREE_MODE||"off";
if(!["off","linked"].includes(worktreeMode))throw Error("INVALID_WORKTREE_MODE");
const worktreePolicy=createAuthorizedWorkspacePolicy({
  basePolicy:policy,linkedGitWorktrees:worktreeMode
});
// Explicit opt-in: existing/private deployments remain unchanged without this file.
const grants=env.MAC_MCP_GRANTS_FILE?
  await createWorkspaceGrants({file:env.MAC_MCP_GRANTS_FILE,audit}):null;
const workspacePolicy=grants?
  createManagedWorkspacePolicy({basePolicy:worktreePolicy,grants}):worktreePolicy;
// Optional explicit deny preferences: default empty, independent from DC tools.
// Owner-managed only via the same local token as Workspace Permissions.
if(env.MAC_MCP_DENY_FILE&&!grants)
  throw Error("DENY_CONSOLE_REQUIRES_OWNER_GRANTS");
const denyRules=env.MAC_MCP_DENY_FILE?
  await createDenyRules({file:env.MAC_MCP_DENY_FILE,audit}):null;
const gitMode=env.MAC_MCP_GIT_MODE||"off";
if(!["off","review","write","push"].includes(gitMode))throw new Error("INVALID_GIT_MODE");
if(writeScope==="home-only"&&gitMode!=="off")
  throw Error("HOME_WRITE_SCOPE_GATEWAY_GIT_MUST_BE_OFF");
const gitWorkflow=gitMode==="off"?null:createGitWorkflow({
  policy,upstream,writesEnabled:gitMode==="write"||gitMode==="push",
  pushEnabled:gitMode==="push"
});
http=createServer(async(req,res)=>{
  const local=req.socket.remoteAddress==="127.0.0.1";
  const address=http?.address();
  const port=address&&typeof address!=="string"?address.port:null;
  const hostOk=[`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host??"");
  if(!local||!hostOk){res.writeHead(403).end("Denied");return;}
  const route=new URL(req.url||"/","http://localhost").pathname;
  // Only the owner authorization form accepts an Origin; MCP remains no-CORS.
  if(req.headers.origin&&!(
    (route==="/permissions"||route==="/filters")&&req.method==="POST")){
    res.writeHead(403).end("Denied");return;
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
        res.end(renderPermissionDashboard({
          project:{path:policy.root,mode:policy.mode},home:grants.home,config:data,
          nativeAccessEnabled:nativeAccessMode==="native"
        }));
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
        permissionManagementEnabled:Boolean(grants),
        nativeAccessEnabled:nativeAccessMode==="native",
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
    res.end(JSON.stringify({status:"ok",service:"dc-project-workspace",mode,
      writeScope}));
    return;
  }
  if(route!=="/mcp"||req.method!=="POST"){
    res.writeHead(404).end("Not found");return;
  }
  if(Number(req.headers["content-length"]||0)>65536){
    res.writeHead(413).end("Too large");return;
  }
  const transport=new StreamableHTTPServerTransport({
    enableJsonResponse:true
  });
  const gateway=createDesktopCommanderBridge(router,audit,{
    workspacePolicy,upstreamRouter:router,
    nativePassthrough:nativeAccessMode==="native",denyRules,
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
    });
  };
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  return runtime;
}
