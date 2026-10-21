import {createAccessControl} from '../access-control.js';
export async function accessCommand(args:string[]){
  const json=args.includes('--json');args=args.filter(a=>a!=='--json');
  const [op,...rest]=args;
  const access=await createAccessControl();
  let result:unknown;
  if((op==='status'||op==='list'||!op)&&!rest.length)result=await access.snapshot();
  else if(op==='create'&&rest[0]&&(rest.length===1||(rest.length===3&&rest[1]==='--expires')))result=await access.create(rest[0],rest[2]||null);
  else if(op==='mode'&&rest.length===1&&(rest[0]==='ingress'||rest[0]==='api-key')){await access.setMode(rest[0]);result=await access.snapshot();}
  else if(op==='revoke'&&rest.length===1){await access.revoke(rest[0]!);result=await access.snapshot();}
  else if(op==='owner-token'&&!rest.length){process.stdout.write(await access.ownerToken()+'\n');return;}
  else throw Error('Usage: access status|list|create "Name" [--expires ISO8601]|mode ingress|mode api-key|revoke ID|owner-token [--json]');
  if(json){process.stdout.write(JSON.stringify(result)+'\n');return;}
  if(result&&typeof result==='object'&&'key' in result){
    const c=result as {id:string;name:string;key:string};
    process.stdout.write(`\n  Credential created: ${c.name}\n  ID: ${c.id}\n  Permission: Owner default\n\n  ${c.key}\n\n  Copy this key now; it cannot be retrieved later.\n  Creating a key does not enable authentication.\n  Enable: mac-mcp-gateway access mode api-key\n\n`);return;
  }
  const state=await access.snapshot();
  process.stdout.write(`\n  Gateway access control\n  ────────────────────────────────────────────────\n  Mode          ${state.mode==='ingress'?'Managed by ingress':'Gateway API key required'}\n  Permission    Owner default\n  Config        ${access.file}\n\n`);
  for(const c of state.credentials)process.stdout.write(`  ${c.name} · ${c.status}\n    ID: ${c.id}\n    Created: ${c.createdAt}\n    Last used: ${c.lastUsedAt||'Never'} · Expires: ${c.expiresAt||'Never'}\n`);
  if(!state.credentials.length)process.stdout.write('  No client credentials.\n');
  process.stdout.write(state.mode==='ingress'?'\n  Caller identity is not verified by Gateway. Restrict access at ingress.\n\n':'\n  Missing, invalid, expired and revoked keys are rejected.\n\n');
}
