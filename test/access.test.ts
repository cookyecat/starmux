import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,writeFile,rm,realpath,chmod,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAccessControl} from '../src/access-control.js';
import {createGatewayRuntime} from '../src/dc-workspace-http.js';
import {createPrivateDirectory} from '../src/platform.js';
import {createInvocationPipeline} from '../src/invocation.js';

async function fixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'gateway-access-')));
 const folder=join(root,'private');createPrivateDirectory(folder);
 return {root,file:join(folder,'access.json')};
}
test('access keys: explicit opt-in, private hashes, expiry, independent revocation and concurrent updates',async()=>{
 const {root,file}=await fixture();
 try{
  const a=await createAccessControl(file),b=await createAccessControl(file);
  assert.deepEqual(await a.authenticate(undefined),{kind:'unverified-local'});
  await assert.rejects(a.setMode('api-key'),/ACTIVE_KEY_REQUIRED/);
  const [alice,bob]=await Promise.all([a.create('Alice'),b.create('Bob')]);
  assert.equal((await a.snapshot()).credentials.length,2);
  assert.ok(!(await readFile(file,'utf8')).includes(alice.key));
  assert.ok(!JSON.stringify(await a.snapshot()).includes('digest'));
  await a.setMode('api-key');
  for(const header of [undefined,'Bearer wrong','Basic '+alice.key,'Bearer '+alice.key+'x'])await assert.rejects(a.authenticate(header),/UNAUTHORIZED/);
  const identity=await a.authenticate('Bearer '+alice.key);
  assert.deepEqual(identity,{kind:'verified-api-key',credentialId:alice.id,permission:'owner-default'});
  let observed=false;
  await createInvocationPipeline({request:{requestId:'test',identity},middleware:[{beforeCall:ctx=>{assert.deepEqual(ctx.request.identity,identity);observed=true;}}],dispatch:async()=>({content:[]})})({name:'test'});
  assert.equal(observed,true);
  assert.ok((await a.snapshot()).credentials.find(c=>c.id===alice.id)?.lastUsedAt);
  await b.revoke(alice.id);await assert.rejects(a.authenticate('Bearer '+alice.key),/UNAUTHORIZED/);
  await a.authenticate('Bearer '+bob.key);
  await b.revoke(bob.id);assert.equal((await a.snapshot()).mode,'api-key');await assert.rejects(a.authenticate(undefined),/UNAUTHORIZED/);
  await assert.rejects(a.create('Expired','2000-01-01T00:00:00.000Z'),/FUTURE/);
  const short=await a.create('Short',new Date(Date.now()+1000).toISOString());
  const raw=JSON.parse(await readFile(file,'utf8')) as {credentials:{id:string;expiresAt:string|null}[]};
  raw.credentials.find(c=>c.id===short.id)!.expiresAt='2000-01-01T00:00:00.000Z';
  await writeFile(file,JSON.stringify(raw));await assert.rejects(a.authenticate('Bearer '+short.key),/UNAUTHORIZED/);
  const token=await a.ownerToken();assert.equal(await a.authorized(token),true);assert.equal(await a.authorized(short.key),false);
  await writeFile(file,'{}');await assert.rejects(a.authenticate('Bearer '+short.key));
  await rm(file);await assert.rejects(a.authenticate(undefined));
  await assert.rejects(createAccessControl(file),/STORE_MISSING/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('unsafe access files fail closed',async()=>{
 const {root,file}=await fixture();
 try{
  const a=await createAccessControl(file);
  if(process.platform!=='win32'){
   await chmod(file,0o644);await assert.rejects(a.authenticate(undefined),/UNSAFE/);await chmod(file,0o600);
   const other=file+'.other';await writeFile(other,'{}',{mode:0o600});await rm(file);await symlink(other,file);
   await assert.rejects(a.authenticate(undefined),/UNSAFE/);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
test('HTTP enforcement precedes MCP dispatch; Dashboard owner controls and hot mode changes', {timeout:180000},async()=>{
 const {root,file}=await fixture();
 const access=await createAccessControl(file);const key=await access.create('<Client>');
 const events:Record<string,unknown>[]=[];
 const runtime=createGatewayRuntime({env:{MAC_MCP_PROJECT_ROOT:root,MAC_MCP_PROJECT_PORT:'0',MAC_MCP_ACCESS_FILE:file},audit:e=>{events.push(e);}});
 try{
  await runtime.start();const url=`http://127.0.0.1:${runtime.port}`;
  async function rpc(method:string,secret?:string,params:unknown={}){
   return fetch(url+'/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',...(secret?{authorization:'Bearer '+secret}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  }
  const originalList=await rpc('tools/list');assert.equal(originalList.status,200);
  const originalBody=await originalList.json();
  await access.setMode('api-key');
  const before=events.length;
  for(const method of ['initialize','tools/list','tools/call','resources/list','resources/read']){
   assert.equal((await rpc(method)).status,401);assert.equal((await rpc(method,'invalid')).status,401);
  }
  assert.equal(events.length,before);
  const authenticatedList=await rpc('tools/list',key.key);assert.equal(authenticatedList.status,200);
  assert.deepEqual(await authenticatedList.json(),originalBody);
  const deniedWrite=await rpc('tools/call',key.key,{name:'write_file',arguments:{path:'blocked.txt',content:'blocked'}});
  assert.equal((await deniedWrite.json() as {result:{isError:boolean}}).result.isError,true);
  await assert.rejects(readFile(join(root,'blocked.txt')),/ENOENT/);
  const call=await rpc('tools/call',key.key,{name:'list_directory',arguments:{path:'.',depth:0}});
  assert.equal(call.status,200);assert.equal((await call.json() as {result:{isError?:boolean}}).result.isError,undefined);
  assert.ok(events.some(e=>e.credentialId===key.id));assert.ok(!JSON.stringify(events).includes(key.key));
  const page=await fetch(url+'/access');assert.equal(page.status,200);assert.match(await page.text(),/&lt;Client&gt;/);
  async function post(token:string,origin=url,op='mode'){
   return fetch(url+'/access',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token,op,mode:'ingress',name:'Web client'})});
  }
  assert.equal((await post(key.key)).status,403);
  const owner=await access.ownerToken();assert.equal((await post(owner,'https://attacker.example')).status,403);
  const created=await post(owner,url,'create');assert.equal(created.status,200);assert.match(await created.text(),/mgw_[A-Za-z0-9_-]{43}/);
  assert.ok(!(await (await fetch(url+'/access')).text()).includes('mgw_'));
  await access.revoke(key.id);assert.equal((await rpc('tools/list',key.key)).status,401);
  assert.equal((await post(owner)).status,200);assert.equal((await rpc('tools/list')).status,200);
  await writeFile(file,'broken');assert.equal((await rpc('tools/list')).status,503);
 }finally{await runtime.close();await rm(root,{recursive:true,force:true});}
});

test('compiled CLI entry manages the same store without printing secrets in listings',async()=>{
 const {root,file}=await fixture();
 const {spawnSync}=await import('node:child_process');
 const {fileURLToPath}=await import('node:url');
 const entry=fileURLToPath(new URL('../src/cli/mac-mcp-gateway.js',import.meta.url));
 const run=(...args:string[])=>spawnSync(process.execPath,[entry,'access',...args],{encoding:'utf8',env:{...process.env,MAC_MCP_ACCESS_FILE:file}});
 try{
  const created=run('create','CLI client','--json');assert.equal(created.status,0,created.stderr);
  const c=JSON.parse(created.stdout) as {id:string;key:string};assert.match(c.key,/^mgw_/);
  assert.equal(run('mode','api-key').status,0);
  const listed=run('list');assert.match(listed.stdout,/Gateway API key required/);assert.ok(!listed.stdout.includes(c.key));
  assert.equal(run('revoke',c.id).status,0);
  assert.equal((await (await createAccessControl(file)).snapshot()).credentials[0]?.status,'revoked');
  assert.equal(run('mode','invalid').status,1);
  assert.equal(run('mode','ingress').status,0);
  assert.match(run('owner-token').stdout,/^[a-f0-9]{64}\n$/);
 }finally{await rm(root,{recursive:true,force:true});}
});
