import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,realpath,readFile,writeFile,rm,rename,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
const cli=fileURLToPath(new URL('../src/cli/starmux.js',import.meta.url));
async function fixture(){const home=await realpath(await mkdtemp(path.join(tmpdir(),'starmux-test-')));const cwd=path.join(home,'project space');await mkdir(cwd);const env={...process.env,HOME:home,USERPROFILE:home};for(const k of Object.keys(env))if(k.startsWith('STARMUX_')||k.startsWith('MAC_MCP_'))delete (env as NodeJS.ProcessEnv)[k];return {home,cwd,env};}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function command(f:Fixture,args:string[],success=true,input?:string){
 const child=spawn(process.execPath,[cli,...args],{cwd:f.cwd,env:f.env,stdio:['pipe','pipe','pipe']});let output='',error='';child.stdout.on('data',d=>output+=String(d));child.stderr.on('data',d=>error+=String(d));child.stdin.end(input);
 const timer=setTimeout(()=>child.kill('SIGTERM'),45000);
 const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timer);
 assert.equal(code===0,success,error||(!success?'Unexpected command success':output));return output;
}
async function port(){const s=createServer();await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));const a=s.address();assert.ok(a&&typeof a!=='string');await new Promise<void>(r=>s.close(()=>r()));return a.port;}
async function status(f:Fixture){return JSON.parse(await command(f,['status','--json'])) as {instanceId:string;phase:string;port:number;runtime:{pid:number;runId:string};executionMode:string;active:{config:{projectRoot:string;mode:string;writeScope:string}}};}
async function rpc(p:number,name:string,args:unknown,token?:string){const r=await fetch(`http://127.0.0.1:${p}/mcp`,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});return {status:r.status,body:r.ok?await r.json() as {result?:{isError?:boolean;content?:unknown}}:{}};}
async function cleanup(f:Fixture){await command(f,['down']).catch(()=>{});await new Promise(r=>setTimeout(r,200));await rm(f.home,{recursive:true,force:true});}

test('Starmux first run, saved CWD, idempotent background, permissions, keys, verification and dashboard',{timeout:180000},async()=>{
 const f=await fixture();try{
  await command(f,['up','--port',String(await port()),'--json']);const a=await status(f);assert.equal(a.phase,'running');assert.equal(a.executionMode,'background');assert.equal(a.active.config.projectRoot,f.cwd);
  await command(f,['verify']);await command(f,['up']);assert.equal((await status(f)).runtime.runId,a.runtime.runId);
  const other=path.join(f.home,'other');await mkdir(other);f.cwd=other;await command(f,['up']);assert.equal((await status(f)).active.config.projectRoot,a.active.config.projectRoot);
  assert.equal((await rpc(a.port,'write_file',{path:'blocked.txt',content:'no'})).body.result?.isError,true);
  await command(f,['up','--code'],false);assert.equal((await status(f)).active.config.mode,'read-only');
  await command(f,['up','.','--write','-y']);assert.equal((await status(f)).active.config.projectRoot,other);assert.equal((await status(f)).active.config.writeScope,'unrestricted');
  const written=await rpc(a.port,'write_file',{path:path.join(other,'written.txt'),content:'yes'});assert.notEqual(written.body.result?.isError,true);assert.equal(await readFile(path.join(other,'written.txt'),'utf8'),'yes');
  const shell=await rpc(a.port,'start_process',{command:'git --version',timeout_ms:1000});assert.notEqual(shell.body.result?.isError,true);
  await command(f,['up','--code']);await command(f,['up','--read']);assert.equal((await status(f)).active.config.mode,'read-only');
  await command(f,['up','--read','--code'],false);
  const key=JSON.parse(await command(f,['auth','key','Test client','--expires','30d','--json'])) as {key:string;id:string;mode:string};assert.match(key.key,/^smx_/);assert.equal(key.mode,'api-key');
  assert.equal((await rpc(a.port,'list_directory',{path:'.'})).status,401);await command(f,['verify'],false);await command(f,['verify','--token-stdin'],true,key.key);
  const listing=await command(f,['auth']);assert.ok(!listing.includes(key.key));assert.ok(listing.includes(key.id));
  const link=JSON.parse(await command(f,['dashboard','--no-open','--json'])) as {url:string};const u=new URL(link.url);assert.equal(u.pathname,'/access');assert.match(u.hash,/^#token=/);
  const response=await fetch(u.origin+u.pathname);const html=await response.text();assert.ok(html.includes('history.replaceState'));assert.ok(!html.includes(u.hash.slice(7)));assert.match(response.headers.get('content-security-policy')??'',/script-src 'sha256-/);
  const denied=await fetch(u.origin+'/access',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({op:'mode',mode:'ingress',token:u.hash.slice(7)})});assert.equal(denied.status,403);
  await command(f,['auth','revoke',key.id]);assert.equal((await rpc(a.port,'list_directory',{path:'.'},key.key)).status,401);
  const changed=await fetch(u.origin+'/access',{method:'POST',headers:{origin:u.origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({op:'mode',mode:'ingress',token:u.hash.slice(7)})});assert.equal(changed.status,200);
  await command(f,['down']);await command(f,['up']);await command(f,['verify']);
  await command(f,['down']);await command(f,['down']);assert.equal((await status(f)).phase,'stopped');
  for(const old of ['run','setup','instance','access'])await command(f,[old],false);
 }finally{await cleanup(f);}
});

test('Starmux config stdin, global selectors and isolated named instances',{timeout:120000},async()=>{
 const f=await fixture();try{
  await command(f,['-i','alpha','init','--port',String(await port())]);
  await command(f,['init','-i','beta','--port',String(await port())]);
  const listing=JSON.parse(await command(f,['ls','--json'])) as {instances:{instanceId:string;name:string}[]};assert.equal(listing.instances.length,2);
  const shown=JSON.parse(await command(f,['config','show','-i','alpha','--json'])) as {revision:string};
  await command(f,['config','patch','-i','alpha','--revision',shown.revision,'-y'],true,JSON.stringify({accessRole:'trusted',mode:'read-write',writeScope:'unrestricted'}));
  await command(f,['up','-i','alpha']);await command(f,['up','-i','beta']);
  await command(f,['config','default','alpha']);assert.equal((await status(f)).active.config.mode,'read-write');
  await command(f,['config','rename','work','-i','alpha']);await command(f,['config','copy','copy','-i','work']);await command(f,['config','archive','-i','copy']);await command(f,['config','restore','-i','copy']);
  await command(f,['down','-i','work']);await command(f,['down','-i','beta']);
 }finally{await command(f,['down','-i','beta']).catch(()=>{});await cleanup(f);}
});

test('Starmux registry migration preserves identity, old keys and revocation; refuses overwrite',{timeout:120000},async()=>{
 const f=await fixture();try{
  await command(f,['init','--port',String(await port())]);
  const key=JSON.parse(await command(f,['auth','key','Old client','--json'])) as {key:string;id:string};
  const registryFile=path.join(f.home,'.config','starmux','registry.json');const registry=JSON.parse(await readFile(registryFile,'utf8')) as {instances:{id:string;source:{path:string}}[]};const id=registry.instances[0]!.id;
  const newRoot=path.join(f.home,'.config','starmux'),oldRoot=path.join(f.home,'.config','mac-mcp-gateway');
  await rename(newRoot,oldRoot);registry.instances[0]!.source.path=path.join(oldRoot,'instances',id,'config.jsonc');await writeFile(path.join(oldRoot,'registry.json'),JSON.stringify(registry));
  const accessFile=path.join(oldRoot,'instances',id,'state','access-v1.json');const access=JSON.parse(await readFile(accessFile,'utf8')) as {credentials:{id:string;digest:string;revokedAt:string|null}[]};
  const legacyKey=key.key.replace(/^smx_/,'mgw_');access.credentials[0]!.digest=createHash('sha256').update(legacyKey).digest('hex');await writeFile(accessFile,JSON.stringify(access));
  await command(f,['up'],false);await command(f,['migrate']);await command(f,['migrate','registry','-y']);
  assert.equal((await status(f)).instanceId,id);await command(f,['up']);await command(f,['verify','--token-stdin'],true,legacyKey);
  await command(f,['auth','revoke',key.id]);assert.equal((await rpc((await status(f)).port,'list_directory',{path:'.'},legacyKey)).status,401);
  assert.equal(JSON.parse(await readFile(accessFile,'utf8')).credentials[0].revokedAt,null);
  await command(f,['migrate','registry','-y'],false);
 }finally{await cleanup(f);}
});

test('foreground ownership, follow interruption and missing-config stop',{timeout:90000},async()=>{
 const f=await fixture();let foreground:ReturnType<typeof spawn>|undefined,follow:ReturnType<typeof spawn>|undefined;
 try{
  await command(f,['init','--port',String(await port())]);
  foreground=spawn(process.execPath,[cli,'up','--foreground','--json'],{cwd:f.cwd,env:f.env,stdio:'ignore'});
  for(let n=0;n<70;n++){if((await status(f)).phase==='running')break;await new Promise(r=>setTimeout(r,100));}
  const first=await status(f);assert.equal(first.executionMode,'foreground-owned');
  follow=spawn(process.execPath,[cli,'logs','-f'],{env:f.env,stdio:'ignore'});await new Promise(r=>setTimeout(r,400));
  await new Promise<void>(resolve=>{follow!.once('exit',()=>resolve());follow!.kill('SIGINT');});assert.equal((await status(f)).phase,'running');
  const source=JSON.parse(await command(f,['config','path','--json'])) as {config:string};await writeFile(source.config,'{broken');
  await command(f,['down']);assert.equal((await status(f)).phase,'stopped');
 }finally{follow?.kill('SIGTERM');foreground?.kill('SIGTERM');await cleanup(f);}
});

test('migration resumes only its own dead lock and staging directory',{timeout:60000},async()=>{
 const f=await fixture();try{
  await command(f,['init','--port',String(await port())]);const fresh=path.join(f.home,'.config','starmux'),old=path.join(f.home,'.config','mac-mcp-gateway');
  await rename(fresh,old);const registryFile=path.join(old,'registry.json');const registry=JSON.parse(await readFile(registryFile,'utf8')) as {instances:{id:string;source:{path:string}}[]};registry.instances[0]!.source.path=path.join(old,'instances',registry.instances[0]!.id,'config.jsonc');await writeFile(registryFile,JSON.stringify(registry));
  const lock=path.join(old,'.registry-lock');await mkdir(lock,{mode:0o700});await writeFile(path.join(lock,'starmux-migration-owner.json'),JSON.stringify({pid:2147483647,source:old}),{mode:0o600});
  const stage=fresh+'.migration';await mkdir(stage,{mode:0o700});await writeFile(path.join(stage,'migration.json'),JSON.stringify({source:old}),{mode:0o600});
  await command(f,['migrate','registry','-y']);assert.equal((await status(f)).instanceId,registry.instances[0]!.id);
 }finally{await cleanup(f);}
});
