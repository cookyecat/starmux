import type { IncomingMessage } from "node:http";
import type { DenyConfig,DenyRules,PostResult } from "./contracts.js";
import { isSafeInteger } from "./validation.js";
// Owner-only, local Dashboard for optional tool/path deny rules.
// The page has no JavaScript. Existing grants owner token and same-origin
// form checks are reused; remote MCP tool calls cannot modify this profile.
import { permissionHeaders } from "./permissions-dashboard.js";
const h=(x: unknown)=>String(x??"").replace(/[&<>"']/g,c=>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
export const denyPageHeaders=permissionHeaders;
const controls=(op: string,value: string,label: string)=>'<form method="post" action="/filters">'+
  '<input type="hidden" name="op" value="'+h(op)+'">'+
  '<input type="hidden" name="value" value="'+h(value)+'">'+
  '<input type="password" name="token" autocomplete="off" placeholder="本机管理密钥" required>'+
  '<button type="submit">'+h(label)+'</button></form>';
export function renderDenyDashboard({rules,toolCatalog=[]}: {rules:DenyConfig;toolCatalog?:readonly {name:string}[]}){
  const byName=new Map(toolCatalog.map(t=>[t.name,t]));
  const rows=toolCatalog.map(tool=>{
    const blocked=rules.deniedTools.includes(tool.name);
    return '<tr><td><code>'+h(tool.name)+'</code></td><td>'+
      (blocked?"已禁用":"默认允许")+'</td><td>'+
      controls(blocked?"enable-tool":"disable-tool",tool.name,
        blocked?"重新启用":"禁用工具")+'</td></tr>';
  }).join("");
  const stale=rules.deniedTools.filter(n=>!byName.has(n)).map(n=>
    '<tr><td><code>'+h(n)+'</code></td><td>禁用（当前未发现）</td><td>'+
      controls("enable-tool",n,"撤销禁用")+'</td></tr>').join("");
  const paths=rules.deniedDirectories.map(n=>
    '<tr><td><code>'+h(n)+'</code></td><td>'+
    controls("allow-directory",n,"移除过滤")+'</td></tr>').join("");
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Starmux · Tool Filters</title>'+
    '<style>body{font:15px system-ui,-apple-system,sans-serif;max-width:1000px;'+
    'margin:28px auto;padding:0 20px;background:#f6f7fa;color:#233045}'+
    'section{background:white;border:1px solid #ddd;border-radius:12px;'+
    'padding:20px;margin:15px 0}table{width:100%;border-collapse:collapse}'+
    'td,th{padding:10px;border-bottom:1px solid #ddd;text-align:left}'+
    'input,button{padding:7px;margin:3px;font:inherit}'+
    'input[name=value]{width:80%;max-width:600px}'+
    'code{overflow-wrap:anywhere}small{display:block;color:#657083}</style></head><body>'+
    '<h1>Starmux · Tool Filters</h1>'+
    '<p><strong>Default Allow / Explicit Deny</strong>：上游工具默认全部可用。'+
    '只有设备所有者明确禁用的工具会从 AI 的 tools/list 消失；'+
    '旧客户端直接调用时也会被拒绝。新工具默认自动可用。</p>'+
    '<section><h2>工具黑名单</h2><table><thead><tr><th>工具</th><th>状态</th><th>操作</th>'+
    '</tr></thead><tbody>'+rows+stale+'</tbody></table></section>'+
    '<section><h2>目录过滤（可选）</h2>'+
    '<p>仅检查具有明确文件路径参数的直接工具调用。'+
    '<strong>不限制 Shell、Python、脚本或上游工具间接访问文件。</strong> '+
    '也不是操作系统沙箱；对目录的递归枚举或搜索亦不能提供可靠隔离。'+
    '需要真正隔离时，应由 Desktop Commander / 操作系统 / 容器负责。</p>'+
    '<table><thead><tr><th>过滤目录</th><th>操作</th></tr></thead><tbody>'+
    (paths||'<tr><td colspan="2">没有目录过滤规则</td></tr>')+
    '</tbody></table><h3>添加禁止的目录</h3>'+
    '<form method="post" action="/filters">'+
    '<input type="hidden" name="op" value="deny-directory">'+
    '<input name="value" type="text" placeholder="/absolute/folder" required>'+
    '<input type="password" name="token" autocomplete="off" placeholder="本机管理密钥" required>'+
    '<button type="submit">添加过滤</button></form>'+
    '<small>启用后，含路径参数的直接工具调用要求绝对路径；未设置过滤时不改变原生调用。</small>'+
    '</section><p><a href="/dashboard">运行 Dashboard</a> · '+
    '<a href="/permissions">目录授权</a></p>'+
    '<small>黑名单是防误操作护栏，不是抵御恶意 Shell 或提示注入的安全边界。'+
    '这里的管理密钥只由设备所有者在本机使用，不得发送给远程 AI。</small>'+
    '</body></html>';
}
export async function applyDenyPost(req: IncomingMessage,ruleStore: DenyRules,authorize:(token:unknown)=>Promise<boolean>,host:string|undefined): Promise<PostResult>{
  if(req.headers.origin!=="http://"+host||
     (req.headers["content-type"]||"").split(";")[0]!=="application/x-www-form-urlencoded")
    return {status:403,message:"Owner authorization required"};
  const length=Number(req.headers["content-length"]||0);
  if(!isSafeInteger(length)||length<1||length>4096)
    return {status:413,message:"Invalid request"};
  let body="";
  for await(const chunk of req){
    body+=chunk.toString("utf8");
    if(Buffer.byteLength(body)>4096)return {status:413,message:"Invalid request"};
  }
  const form=new URLSearchParams(body);
  for(const k of form.keys())
    if(!["op","value","token"].includes(k)||form.getAll(k).length!==1)
      return {status:400,message:"Invalid form"};
  if(!await authorize(form.get("token")))
    return {status:403,message:"Owner authorization required"};
  const op=form.get("op")??"";
  if(!["enable-tool","disable-tool","deny-directory","allow-directory"].includes(op))
    return {status:400,message:"Invalid operation"};
  try{
    await ruleStore.update(op,form.get("value"));
    return {status:303,location:"/filters"};
  }catch{
    return {status:400,message:"Rule rejected: check name or directory"};
  }
}
