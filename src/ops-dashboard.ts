import {gitBinary} from "./platform.js";
import type { UpstreamStatus } from "./contracts.js";
import { packageRoot } from "./runtime-paths.js";
import { errorCode } from "./validation.js";
interface Listener {port:number;address:string;process:string;pid:number|null}
// Read-only, loopback-only Mac MCP Gateway operations dashboard.
// No service control, arbitrary command, file content, credentials or extra port.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
const execute=promisify(execFile);
const root=packageRoot;
const home=process.env.HOME;

export const MODULES=Object.freeze([
  {id:"workspace",label:"Project Workspace Gateway",service:"ai.home.mac-mcp-project-workspace",ports:[8793],phase:"active",role:"当前 ChatGPT 文件读写编辑服务",transport:"loopback"},
  {id:"tunnel",label:"OpenAI Secure MCP Tunnel",service:"ai.home.mac-mcp-tunnel",ports:[18891],phase:"active",role:"云端出站接入；18891 为本地管理端口",transport:"outbound"},
  {id:"dc-standby",label:"Desktop Commander P1 Bridge",service:"ai.home.mac-mcp-dc-bridge",ports:[8792],phase:"standby",role:"已验收旧版本、可回滚",transport:"loopback"},
  {id:"p0",label:"Gateway P0 / health_check",service:"ai.home.mac-mcp-gateway-p0",ports:[8787],phase:"legacy",role:"历史 P0，仅健康检查",transport:"loopback"},
  {id:"canary",label:"Synthetic Canary",service:"ai.home.mac-mcp-private-pilot",ports:[8790],phase:"paused",role:"历史合成读写测试；冷备份",transport:"loopback"},
  {id:"caddy",label:"Caddy / Direct URL HTTPS",service:"ai.home.mac-mcp-caddy",ports:[80,443],phase:"paused",role:"未来公网 URL 直连；保留证书与配置",transport:"inbound"},
  {id:"uid450",label:"UID450 Isolated Worker v2",service:"ai.home.mac-mcp-worker-v2",ports:[],phase:"research",role:"系统级 Unix Socket Worker；不在当前 DC 主链",transport:"unix"}
]);
const env=process.env;
async function cmd(exe: string,args: string[]): Promise<{ok:true;stdout:string}|{ok:false;error:string;stdout?:undefined}>{
  try{
    const v=await execute(exe,args,{timeout:3000,maxBuffer:130000,env});
    return {ok:true,stdout:v.stdout};
  }catch(e){return {ok:false,error:errorCode(e)==="ETIMEDOUT"?"timeout":"unavailable"};}
}
function launched(stdout: string){
  return new Map(stdout.split("\n").map(line=>line.trim().split(/\s+/))
    .filter(p=>p.length>=3&&p[2]?.startsWith("ai.home.mac-mcp"))
    .map(p=>[p[2],{pid:/^\d+$/.test(p[0]??"")?Number(p[0]):null,lastExit:p[1]}]));
}
function disabledLabels(stdout: string){
  const names=new Set();
  for(const m of stdout.matchAll(/"(ai\.home\.mac-mcp-[^"]+)"\s*=>\s*disabled/g))
    names.add(m[1]);
  return names;
}
function listening(stdout: string){
  const known=new Set(MODULES.flatMap(x=>x.ports));
  const ports=new Map<number,Listener>();
  for(const line of stdout.split("\n")){
    const cols=line.trim().split(/\s+/);
    const match=line.match(/TCP\s+(\S+):(\d+)\s+\(LISTEN\)/);
    if(!match)continue;
    const port=Number(match[2]);
    if(known.has(port)) ports.set(port,{port,address:match[1]!,process:cols[0]!,
      pid:/^\d+$/.test(cols[1]??"")?Number(cols[1]):null});
  }
  return ports;
}
function tunnelTarget(xml: string){
  // Only classify known filenames; never return full plist, identity or tokens.
  for(const [file,target] of [
    ["run_tunnel_workspace.py","8793 · Project Workspace"],
    ["run_tunnel_dc_bridge.py","8792 · DC Standby"],
    ["run_tunnel_pilot.py","8790 · Synthetic Canary"],
    ["run_tunnel.py","8787 · P0"]])
    if(xml.includes(file+"</string>"))return target;
  return "unknown (inspect LaunchAgent)";
}
async function projectGit(at: string){
  const r=await cmd(gitBinary,["-C",at,"status","--porcelain=v1"]);
  const br=await cmd(gitBinary,["-C",at,"branch","--show-current"]);
  const h=await cmd(gitBinary,["-C",at,"rev-parse","--short","HEAD"]);
  return {branch:br.ok?br.stdout.trim():"unavailable",
    commit:h.ok?h.stdout.trim():"unavailable",
    dirtyCount:r.ok?r.stdout.split("\n").filter(Boolean).length:null};
}
export async function collectOperationsSnapshot(){
  if(process.platform!=="darwin"||process.env.MAC_MCP_INSTANCE_ID)return {capturedAt:new Date().toISOString(),host:process.platform+" local (loopback only)",mode:"read-only",tunnelBackend:"not verified",modules:[],git:await projectGit(root),workspaceGit:await projectGit(process.env.MAC_MCP_PROJECT_ROOT||root),errors:[],milestones:[]};
  const uid=process.getuid?.();
  const [jobs,disables,listeners,worker,git,plist]=await Promise.all([
    cmd("/bin/launchctl",["list"]),
    cmd("/bin/launchctl",["print-disabled","gui/"+uid]),
    cmd("/usr/sbin/lsof",["-nP","-iTCP","-sTCP:LISTEN"]),
    cmd("/bin/launchctl",["print","system/ai.home.mac-mcp-worker-v2"]),
    projectGit(root),
    readFile(path.join(home||"/", "Library/LaunchAgents/ai.home.mac-mcp-tunnel.plist"),"utf8")
      .then(x=>({ok:true,text:x})).catch(()=>({ok:false,text:""}))
  ]);
  const active=jobs.ok?launched(jobs.stdout):new Map<string,{pid:number|null;lastExit:string|undefined}>();
  const disabled=disables.ok?disabledLabels(disables.stdout):new Set();
  const ports=listeners.ok?listening(listeners.stdout):new Map<number,Listener>();
  const modules=MODULES.map(m=>{
    const status=m.id==="uid450" ?
      (worker.ok?/state = running/.test(worker.stdout)?"running":"stopped":"unknown") :
      (!jobs.ok?"unknown":active.has(m.service)?"running":
       disabled.has(m.service)?"disabled":"stopped");
    const occupied=m.ports.map(p=>ports.get(p)).filter((x): x is Listener=>x!==undefined);
    const ready=status==="running" && (m.ports.length===0 ||
      occupied.length>0);
    return {...m,status,ready,pid:m.id==="uid450"?
      Number(worker.stdout?.match(/pid = (\d+)/)?.[1])||null:
      active.get(m.service)?.pid||null,listeners:occupied};
  });
  const workspaceGit=await projectGit(process.env.MAC_MCP_PROJECT_ROOT||root);
  const errors=([["launchctl",jobs],["disabled",disables],
    ["lsof",listeners],["system-worker",worker],["Tunnel plist",plist]] satisfies [string,{ok:boolean}][])
    .filter(([,value])=>!value.ok).map(([name])=>name+" unavailable");
  return {capturedAt:new Date().toISOString(),host:"Mac local (loopback only)",
    mode:"read-only",tunnelBackend:plist.ok?tunnelTarget(plist.text):"unknown",
    modules,git,workspaceGit,errors,
    milestones:[
      {name:"P2 ChatGPT Workspace",status:"accepted",detail:"7/7 real DC calls; read/write/edit and .git denial"},
      {name:"P3 Operations Dashboard",status:"active",detail:"Current service/port monitor on existing 8793"},
      {name:"P3 Development Workflow",status:"limited-live",detail:"Git status / diff / npm smoke via real DC; Git commit approval pending"},
      {name:"Direct URL deployment",status:"paused",detail:"Caddy disabled; HTTP ingress not public"}
    ]};
}
const esc=(x: unknown)=>String(x??"").replace(/[&<>"']/g,c=>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
function stateLabel(x: string){
  return ({running:"运行中",disabled:"已禁用",stopped:"已停止",unknown:"未能确定"} as Record<string,string>)[x]||x;
}
function phaseLabel(x: string){
  return ({active:"主线",standby:"回退",legacy:"历史",paused:"暂停",research:"研究"} as Record<string,string>)[x]||x;
}
export function renderOperationsHtml(data: Awaited<ReturnType<typeof collectOperationsSnapshot>> & {instance?:{id:string;name:string;port:number};accessControl?:{mode:string};configuredUpstreams?:UpstreamStatus[];denyRuleManagementEnabled?:boolean;permissionManagementEnabled?:boolean;nativeAccessEnabled?:boolean}){
  if(data.instance){
    const i=data.instance;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(i.name)} · Gateway</title><style>
      body{font:16px system-ui;background:#f4f6fa;color:#182230;margin:0}main{max-width:850px;margin:50px auto;padding:24px}section{background:white;border:1px solid #dde3eb;border-radius:14px;padding:24px;margin:18px 0}h1{font-size:32px}h2{font-size:18px}small{color:#667085}code{overflow-wrap:anywhere}nav{display:flex;gap:24px;flex-wrap:wrap}a{color:#2459c3}dt{color:#667085;margin-top:16px}dd{margin:5px 0}
      </style></head><body><main><small>Mac MCP Gateway · Instance</small><h1>${esc(i.name)}</h1><small>${esc(i.id)}</small>
      <section><h2>Local Core is running</h2><dl><dt>MCP endpoint</dt><dd><code>http://127.0.0.1:${i.port}/mcp</code></dd><dt>Authentication</dt><dd>${esc(data.accessControl?.mode??'unavailable')}</dd><dt>Capability</dt><dd>${data.nativeAccessEnabled?'Trusted native tools':'Restricted workspace'}</dd></dl><p>Local health does not verify a remote connection. Configure HTTPS or a protected Tunnel separately.</p></section>
      <section><h2>Manage this instance</h2><nav><a href="/access">Credentials and OAuth sessions</a>${data.permissionManagementEnabled?'<a href="/permissions">Workspace permissions</a>':''}${data.denyRuleManagementEnabled?'<a href="/filters">Tool and directory filters</a>':''}</nav><p>Use the App or CLI to edit configuration, apply changes, inspect logs or stop this instance.</p></section>
      <section><h2>Additional upstreams</h2>${(data.configuredUpstreams??[]).map(u=>`<p>${esc(u.id)} · ${esc(u.status)} · ${u.toolCount} tools</p>`).join('')||'<p>No additional upstreams configured.</p>'}</section><small>Owner-local management · <a href="/dashboard.json">JSON status</a></small></main></body></html>`;
  }
  const active=data.modules.filter(x=>x.status==="running").length;
  const livePorts=data.modules.flatMap(x=>x.listeners).map(x=>x.port);
  const expected=data.modules.filter(x=>x.phase==="active"&&x.status!=="running");
  const tr=data.modules.map(m=>`<tr><td><strong>${esc(m.label)}</strong><small>${esc(m.role)}</small></td><td><span class="pill ${esc(m.status)}">${esc(stateLabel(m.status))}</span></td><td><span class="phase">${esc(phaseLabel(m.phase))}</span></td><td class="mono">${esc(m.ports.length?m.ports.join(" / "):"Unix Socket")}</td><td class="mono">${esc(m.listeners.length?m.listeners.map(x=>x.port+" · PID "+x.pid).join(", "):m.status==="running"?"-":"未监听")}</td></tr>`).join("");
  const additional=data.configuredUpstreams||[];
  const upstreamRows=additional.map(u=>"<tr><td><strong>"+esc(u.id)+"</strong></td><td>"+
    esc(u.status)+"</td><td>"+esc(u.toolCount)+"</td><td>"+
    esc(u.lastError||"—")+"</td></tr>").join("");
  const upstreamPanel=additional.length?
    '<section class="panel"><h2>Configured MCP Upstreams</h2><table><thead><tr><th>上游</th><th>当前状态</th><th>已发现工具</th><th>错误代码</th></tr></thead><tbody>'+upstreamRows+'</tbody></table></section>':'';
  const milestones=data.milestones.map(x=>`<li><span class="step">${esc(x.status)}</span><div><b>${esc(x.name)}</b><p>${esc(x.detail)}</p></div></li>`).join("");
  const messages=data.errors.length?[...data.errors]:[];
  if(expected.length)messages.push(expected.length+" 个主线服务不在运行");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="25"><title>Mac MCP Gateway · Operations</title><style>
  :root{color-scheme:light;font-family:system-ui,-apple-system,"PingFang SC","Microsoft Yahei",sans-serif}
  *{box-sizing:border-box}body{margin:0;background:#f4f7fb;color:#142138}
  main{max-width:1220px;margin:0 auto;padding:34px 25px 64px}
  header{display:flex;align-items:flex-end;justify-content:space-between;gap:22px;margin-bottom:27px;flex-wrap:wrap}
  h1{font-size:26px;margin:0 0 8px}h2{font-size:16px;margin:0 0 17px}p{line-height:1.55}
  .subtitle{color:#67748b;margin:0}.time{color:#697890;font-size:12px}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin:0 0 24px}
  .stat,.panel{background:white;border:1px solid #e0e7f0;border-radius:13px;padding:18px}
  .stat small{color:#6b7b93;display:block;margin-bottom:9px}.stat strong{font-size:23px}
  .stat strong.short{font-size:16px}.status-good{color:#137a53}
  .grid{display:grid;grid-template-columns:2fr 1fr;gap:18px}.panel{margin-bottom:18px;overflow:auto}
  table{border-collapse:collapse;width:100%;font-size:13px}th{text-align:left;background:#f7f9fc;color:#687991;font-weight:600}
  td,th{padding:13px 11px;border-bottom:1px solid #e9eef6;vertical-align:middle}tr:last-child td{border:0}
  td small{display:block;color:#718096;margin-top:5px}.pill{padding:5px 9px;border-radius:8px;background:#f2f4f7;font-size:12px;white-space:nowrap}
  .pill.running{color:#0c7451;background:#ddf6e9}.pill.disabled{color:#9a5409;background:#fff1d9}
  .pill.unknown{color:#aa251b;background:#ffefee}.phase{font-size:12px;color:#62728a}
  .mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;white-space:nowrap}
  ul{list-style:none;margin:0;padding:0}li{display:flex;gap:12px;padding:0 0 20px}li:last-child{padding-bottom:0}
  li p{margin:5px 0 0;color:#718096;font-size:12px}
  .step{background:#e9f0ff;color:#2755ad;border-radius:6px;padding:6px;align-self:flex-start;text-transform:uppercase;font-size:10px}
  .notice{border-left:3px solid #7598d6;background:#f0f5ff;padding:11px;color:#425b88;font-size:12px;margin-top:20px}
  footer{color:#8291a3;font-size:12px;padding:10px}
  @media(max-width:950px){.stats{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}}
  @media(max-width:560px){main{padding:19px 10px}.stats{grid-template-columns:1fr 1fr}th,td{padding:10px 7px}}
  </style></head><body><main><header><div><h1>Mac MCP Gateway <span style="color:#4777c6">/ Operations</span></h1><p class="subtitle">运行资产 · 端口占用 · 开发里程碑 · 双入口状态</p></div><div class="time">采样 ${esc(data.capturedAt)}<br>本机只读 · 每 25 秒刷新</div></header>
  <section class="stats"><div class="stat"><small>当前在线服务</small><strong class="status-good">${active} / ${data.modules.length}</strong></div>
  <div class="stat"><small>正在监听的项目端口</small><strong>${new Set(livePorts).size}</strong></div>
  <div class="stat"><small>Private Tunnel 目标</small><strong class="short">${esc(data.tunnelBackend)}</strong></div>
  <div class="stat"><small>正在运行的代码</small><strong class="short">${esc(data.git.branch)} · ${esc(data.git.commit)}</strong><small>${data.git.dirtyCount===null?"状态未知":data.git.dirtyCount+" 个未提交变更"}</small></div>
  <div class="stat"><small>实际授权项目 Git</small><strong class="short">${esc(data.workspaceGit.branch)} · ${esc(data.workspaceGit.commit)}</strong><small>${data.workspaceGit.dirtyCount===null?"状态未知":data.workspaceGit.dirtyCount+" 个未提交变更"}</small></div></section>
  <div class="grid"><section class="panel"><h2>服务运行清单</h2><table><thead><tr><th>模块</th><th>系统状态</th><th>研发定位</th><th>登记端口</th><th>实际监听</th></tr></thead><tbody>${tr}</tbody></table></section>
  <section class="panel"><h2>里程碑与开发进度</h2><ul>${milestones}</ul><div class="notice">该面板只观察，不执行任何启动、停用、Git、Shell 命令。全量 DC 工具可发现 ≠ 全部已授权。</div></section></div>
  ${upstreamPanel}
  ${data.denyRuleManagementEnabled?'<section class="panel"><h2>Tool Filters · Explicit Deny</h2><p>所有上游 MCP 工具默认允许。所有者可以禁用指定工具或添加非沙箱型目录过滤。<a href="/filters">管理黑名单</a></p></section>':''}
  ${data.permissionManagementEnabled?'<section class="panel"><h2>Workspace Permissions</h2><p>'+
  (data.nativeAccessEnabled?'当前为可信开发原生透传：Home/自定义目录授权开关不限制原生文件及 Shell 工具；由本地 Desktop Commander 与 macOS 用户权限控制。':'当前支持 Home 与 Home 外只读扫描、自定义目录读写授权。')+
  ' <a href="/permissions">查看目录授权与说明</a></p></section>':''}
  ${messages.length?`<section class="panel"><h2>采集警告</h2><p>${esc(messages.join("; "))}</p></section>`:""}
  <section><h2>Access control</h2><p><a href="/access">Manage authentication and client credentials</a></p><p>Credentials use the owner permission configuration. Network access and tool permissions are managed separately.</p></section>
  <footer>JSON 数据接口：/dashboard.json · 不另占用端口 · 127.0.0.1 本机访问</footer></main></body></html>`;
}
export const dashboardHeaders=Object.freeze({
  "cache-control":"no-store","x-content-type-options":"nosniff",
  "content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; connect-src 'none'"
});

export function instancePage(html:string,name:string|undefined,id:string|undefined){
  return id?html.replace(/<body([^>]*)>/,`<body$1><aside style="padding:12px 24px;border-bottom:1px solid #ddd">Gateway instance: <strong>${esc(name??id)}</strong> · <small>${esc(id)}</small> · <a href="/dashboard">Overview</a></aside>`):html;
}
