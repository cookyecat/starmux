import type {IncomingMessage} from 'node:http';
import type {AccessControl} from './access-control.js';
export {permissionHeaders as accessHeaders} from './permissions-dashboard.js';
const e=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function accessPage(state:Awaited<ReturnType<AccessControl['snapshot']>>,created?:{key:string}){
  const form=(op:string,fields:string,label:string)=>`<form method="post" action="/access"><input type="hidden" name="op" value="${op}">${fields}<label>Owner management token <input type="password" name="token" required autocomplete="off"></label><button>${label}</button></form>`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Gateway · Access control</title><style>body{font:16px system-ui;max-width:960px;margin:40px auto;padding:0 24px;background:#f5f7fa;color:#243249}section{background:white;border:1px solid #dae0e8;border-radius:12px;padding:24px;margin:20px 0}input,select,button{font:inherit;padding:8px;margin:8px}label{display:block}code{overflow-wrap:anywhere}td,th{text-align:left;padding:10px;border-bottom:1px solid #ddd}table{width:100%}</style><h1>Access control</h1>
  <p><a href="/dashboard">Dashboard</a> · <a href="/permissions">Workspace permissions</a></p>
  <section><h2>${state.mode==='ingress'?'Managed by ingress':'Gateway API key'}</h2><p>Permission: Owner default. Credentials do not change workspace, tool or operating-system permissions.</p><p>${state.mode==='ingress'?'Gateway does not verify caller identity. Restrict remote access through your ingress. HTTPS encryption alone does not authenticate callers.':'Every MCP request requires an active key. Missing, invalid, expired or revoked keys are rejected.'}</p></section>
  ${created?`<section><h2>Copy this key now</h2><code>${e(created.key)}</code><p>This key is shown only in this response. Keep it private; it grants the owner-approved MCP capabilities.</p></section>`:''}
  <section><h2>Client credentials</h2><table><tr><th>Name / ID</th><th>Status / Revoked</th><th>Created / Last used / Expiry</th></tr>${state.credentials.map(c=>`<tr><td>${e(c.name)}<br><code>${e(c.id)}</code></td><td>${e(c.status)}<br>${e(c.revokedAt||'—')}</td><td>${e(c.createdAt)}<br>${e(c.lastUsedAt||'Never')}<br>${e(c.expiresAt||'No expiry')}</td></tr>`).join('')||'<tr><td colspan="3">No credentials</td></tr>'}</table></section>
  <section><h2>Create credential</h2>${form('create','<label>Name <input name="name" maxlength="80" required></label><label>Expiry (optional, UTC ISO 8601) <input name="expiresAt" placeholder="2027-01-01T00:00:00.000Z"></label>','Create')}</section>
  <section><h2>Authentication mode</h2>${form('mode','<select name="mode"><option value="api-key">Require Gateway API key</option><option value="ingress">Managed by ingress (no Gateway key required)</option></select>','Apply mode')}<p>Switching to ingress mode permits requests without a Gateway key. Existing owner permissions still apply.</p></section>
  <section><h2>Revoke credential</h2>${form('revoke','<label>Credential ID <input name="id" required></label>','Revoke')}<p>Revocation blocks subsequent requests; it does not cancel an already executing tool.</p></section>
  <p>Get the separate owner management token locally: <code>mac-mcp-gateway access owner-token</code>. Do not give this token to AI clients.</p></html>`;
}
export async function accessPost(req:IncomingMessage,access:AccessControl){
  if(req.headers.origin!=='http://'+req.headers.host||(req.headers['content-type']||'').split(';')[0]!=='application/x-www-form-urlencoded')return {status:403};
  const size=Number(req.headers['content-length']);if(!Number.isSafeInteger(size)||size<1||size>4096)return {status:413};
  let body='';for await(const chunk of req){body+=String(chunk);if(Buffer.byteLength(body)>4096)return {status:413};}
  const q=new URLSearchParams(body);
  for(const key of q.keys())if(!['op','token','name','expiresAt','mode','id'].includes(key)||q.getAll(key).length!==1)return {status:400};
  if(!await access.authorized(q.get('token')))return {status:403};
  try{
    let created:{key:string}|undefined;
    if(q.get('op')==='create')created=await access.create(q.get('name')||'',q.get('expiresAt')||null);
    else if(q.get('op')==='revoke')await access.revoke(q.get('id')||'');
    else if(q.get('op')==='mode'&&(q.get('mode')==='ingress'||q.get('mode')==='api-key'))await access.setMode(q.get('mode') as 'ingress'|'api-key');
    else return {status:400};
    return {status:200,html:accessPage(await access.snapshot(),created)};
  }catch{return {status:400};}
}
