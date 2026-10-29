import type { UpstreamStatus } from "./contracts.js";
export async function collectOperationsSnapshot(){
  return {capturedAt:new Date().toISOString(),host:process.platform,architecture:process.arch,node:process.version,pid:process.pid};
}
const esc=(x: unknown)=>String(x??"").replace(/[&<>"']/g,c=>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
export function renderOperationsHtml(data: Awaited<ReturnType<typeof collectOperationsSnapshot>> & {instance?:{id:string;name:string;port:number};accessControl?:{mode:string};configuredUpstreams?:UpstreamStatus[];denyRuleManagementEnabled?:boolean;permissionManagementEnabled?:boolean;nativeAccessEnabled?:boolean}){
  if(data.instance){
    const i=data.instance;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(i.name)} · Starmux</title><style>
      body{font:16px system-ui;background:#f4f6fa;color:#182230;margin:0}main{max-width:850px;margin:50px auto;padding:24px}section{background:white;border:1px solid #dde3eb;border-radius:14px;padding:24px;margin:18px 0}h1{font-size:32px}h2{font-size:18px}small{color:#667085}code{overflow-wrap:anywhere}nav{display:flex;gap:24px;flex-wrap:wrap}a{color:#2459c3}dt{color:#667085;margin-top:16px}dd{margin:5px 0}
      </style></head><body><main><small>Starmux · Instance</small><h1>${esc(i.name)}</h1><small>${esc(i.id)}</small>
      <section><h2>Local Core is running</h2><dl><dt>MCP endpoint</dt><dd><code>http://127.0.0.1:${i.port}/mcp</code></dd><dt>Authentication</dt><dd>${esc(data.accessControl?.mode??'unavailable')}</dd><dt>Capability</dt><dd>${data.nativeAccessEnabled?'Trusted native tools':'Restricted workspace'}</dd></dl><p>Local health does not verify a remote connection. Configure HTTPS or a protected Tunnel separately.</p></section>
      <section><h2>Manage this instance</h2><nav><a href="/access">Credentials and OAuth sessions</a>${data.permissionManagementEnabled?'<a href="/permissions">Workspace permissions</a>':''}${data.denyRuleManagementEnabled?'<a href="/filters">Tool and directory filters</a>':''}</nav><p>Use the App or CLI to edit configuration, apply changes, inspect logs or stop this instance.</p></section>
      <section><h2>Additional upstreams</h2>${(data.configuredUpstreams??[]).map(u=>`<p>${esc(u.id)} · ${esc(u.status)} · ${u.toolCount} tools</p>`).join('')||'<p>No additional upstreams configured.</p>'}</section><small>Owner-local management · <a href="/dashboard.json">JSON status</a></small></main></body></html>`;
  }
  return '<!doctype html><html lang="en"><meta charset="utf-8"><title>Starmux</title><body><h1>Starmux</h1><p>No instance context is available.</p></body></html>';
}
export const dashboardHeaders=Object.freeze({
  "cache-control":"no-store","x-content-type-options":"nosniff",
  "content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; connect-src 'none'"
});

export function instancePage(html:string,name:string|undefined,id:string|undefined){
  return id?html.replace(/<body([^>]*)>/,`<body$1><aside style="padding:12px 24px;border-bottom:1px solid #ddd">Gateway instance: <strong>${esc(name??id)}</strong> · <small>${esc(id)}</small> · <a href="/dashboard">Overview</a></aside>`):html;
}
