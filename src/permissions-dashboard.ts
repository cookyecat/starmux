import type { IncomingMessage } from "node:http";
import type { GrantsConfig,PostResult,WorkspaceGrants } from "./contracts.js";
import { isSafeInteger } from "./validation.js";
// Local owner-facing permissions console. No scripts, cookies or remote MCP
// tool capable of elevating its own grants.
const e=(s: unknown)=>String(s??"").replace(/[&<>"']/g,c=>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
export const permissionHeaders=Object.freeze({
  "cache-control":"no-store","x-content-type-options":"nosniff",
  "referrer-policy":"no-referrer",
  "content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
});
const selector=(grant: unknown,op: string,label: string,warning="")=>
  '<form method="post" action="/permissions">'+
  '<input type="hidden" name="op" value="'+e(op)+'">'+
  '<label>设备所有者管理密钥 <input name="token" type="password" required autocomplete="off"></label> '+
  '<button type="submit">'+e(label)+'</button>'+
  (warning?'<small>'+e(warning)+'</small>':"")+
  '</form>';
export function renderPermissionDashboard({project,home,config,warning="",nativeAccessEnabled=false}: {project:{path:string;mode:string};home:string;config:GrantsConfig;warning?:string;nativeAccessEnabled?:boolean}){
  const rows=config.custom.map(grant=>
    '<tr><td><code>'+e(grant.path)+'</code></td><td>'+e(grant.mode)+
    '</td><td><form method="post" action="/permissions">'+
    '<input type="hidden" name="op" value="revoke">'+
    '<input type="hidden" name="target" value="'+e(grant.path)+'">'+
    '<input type="password" name="token" autocomplete="off" required placeholder="管理密钥">'+
    '<button type="submit">撤销</button></form></td></tr>').join("");
  return '<!doctype html><html lang="zh-CN"><head>'+
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Starmux · Workspace Permissions</title>'+
    '<style>body{font:15px system-ui,-apple-system,sans-serif;max-width:940px;margin:30px auto;padding:0 20px;color:#233045;background:#f6f7fa}'+
    'section{background:white;border:1px solid #ddd;padding:20px;margin:15px 0;border-radius:12px}'+
    'table{border-collapse:collapse;width:100%}td,th{padding:10px;border-bottom:1px solid #ddd;text-align:left}'+
    'input,select,button{font:inherit;padding:6px;margin:4px}input[name=target]{width:90%;max-width:550px}'+
    'small{display:block;color:#657083}code{overflow-wrap:anywhere}button{cursor:pointer}</style></head><body>'+
    '<h1>Starmux · 目录授权</h1>'+
    '<p>本页在 Mac 本机管理 Gateway 权限。远程 AI 不可自行增加权限。'+
    '增加或撤销授权后，下一次工具调用立即使用新权限。</p>'+
    (warning?'<section role="alert">'+e(warning)+'</section>':"")+
    (nativeAccessEnabled?'<section role="alert"><h2>可信开发模式 · 完整本地执行权限</h2>'+
      '<p>此设备所有者启用了原生 Desktop Commander 工具透传。'+
      '以下 Home/外部/自定义目录开关<strong>不限制原生 DC 文件和 Shell 工具</strong>；'+
      '可访问范围由 Desktop Commander 和 macOS 用户账户决定。'+
      '开关仅在切回受限工作区模式后生效。请勿将此服务暴露给未经认证的客户端。</p>'+
      '</section>':"")+
    '<section><h2>工作目录 · 读写范围</h2><code>'+e(project.path)+'</code>'+
    '<p>工作模式：<b>'+e(project.mode)+'</b>。该项目沿用原有 Gateway 安全规则。</p></section>'+
    '<section><h2>Home · 只读</h2><code>'+e(home)+'</code>'+
    '<p>当前：<b>'+(config.homeRead?"已开启只读扫描":"未授权")+'</b></p>'+
    selector(null,config.homeRead?"home-disable":"home-enable",
      config.homeRead?"关闭 Home 读取":"允许 Home 只读",
      "默认仍保护 SSH、密钥、凭据及配置路径。")+'</section>'+
    '<section><h2>Home 外 · 只读</h2>'+
    '<p>当前：<b>'+(config.outsideRead?"已开启只读扫描":"未授权")+'</b></p>'+
    selector(null,config.outsideRead?"outside-disable":"outside-enable",
      config.outsideRead?"关闭 Home 外读取":"允许 Home 外只读",
      "不会授予删除、任意 Shell 或写操作。")+'</section>'+
    '<section><h2>自定义目录 · 单独授权</h2>'+
    '<table><thead><tr><th>目录</th><th>权限</th><th>操作</th></tr></thead><tbody>'+
    (rows||'<tr><td colspan="3">暂无自定义授权</td></tr>')+'</tbody></table>'+
    '<h3>新增或修改</h3><form method="post" action="/permissions">'+
    '<input type="hidden" name="op" value="add">'+
    '<label>绝对路径 <input type="text" name="target" required placeholder="/Volumes/Disk/Folder"></label>'+
    '<label>权限 <select name="mode"><option value="read-only">只读</option>'+
    '<option value="read-write">读写</option></select></label>'+
    '<label>管理密钥 <input type="password" name="token" required autocomplete="off"></label>'+
    '<button type="submit">确认授权</button></form></section>'+
    '<p><a href="/dashboard">返回运行 Dashboard</a> · '+
    '<a href="/filters">工具黑名单</a></p>'+
    '<small>授权管理密钥仅在 Mac 本地终端显示；不可交给远程 Agent。'+
    '本页不改变 trusted-project 的同 UID Shell 风险。</small></body></html>';
}
export async function applyPermissionPost(req: IncomingMessage,grants: WorkspaceGrants,host: string|undefined): Promise<PostResult>{
  if(req.headers.origin!=="http://"+host||
    (req.headers["content-type"]||"").split(";")[0]!=="application/x-www-form-urlencoded")
    return {status:403,message:"Owner authorization required"};
  const size=Number(req.headers["content-length"]||0);
  if(!isSafeInteger(size)||size>4096||size<1)
    return {status:413,message:"Invalid request"};
  let body="";
  for await(const chunk of req){
    body+=chunk.toString("utf8");
    if(Buffer.byteLength(body)>4096)return {status:413,message:"Invalid request"};
  }
  const q=new URLSearchParams(body);
  for(const key of q.keys())
    if(!["op","target","mode","token"].includes(key)||q.getAll(key).length!==1)
      return {status:400,message:"Invalid form"};
  if(!await grants.authorized(q.get("token")))
    return {status:403,message:"Owner authorization required"};
  const operation=q.get("op")??"";
  if(!["home-enable","home-disable","outside-enable","outside-disable","add","revoke"]
    .includes(operation))return {status:400,message:"Invalid operation"};
  if(operation==="add"&&!["read-only","read-write"].includes(q.get("mode")??""))
    return {status:400,message:"Invalid mode"};
  try{
    await grants.update(operation,{target:q.get("target"),mode:q.get("mode")});
    return {status:303,location:"/permissions"};
  }catch{
    return {status:400,message:"Grant rejected: verify directory and permissions"};
  }
}
