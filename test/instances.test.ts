import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,realpath,readFile,writeFile,rm,chmod,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn,type ChildProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {instanceConfigSchema,createInstance,loadInstanceConfig,patchInstanceConfig,instancePaths,parseConfig,saveInstanceConfig,readRegistry,resolveInstance,changeRegistry} from '../src/instance-store.js';
import {createAccessControl} from '../src/access-control.js';

const cli=fileURLToPath(new URL('../src/cli/mac-mcp-gateway.js',import.meta.url));
async function fixture(){const home=await realpath(await mkdtemp(path.join(tmpdir(),'gateway-instances-')));const project=path.join(home,'project with space');await mkdir(project);return {home,project};}
async function port(){const server=createServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');await new Promise<void>(resolve=>server.close(()=>resolve()));return address.port;}
const config=(projectRoot:string,p:number)=>instanceConfigSchema.parse({schemaVersion:1,projectRoot,port:p});
function launch(home:string,args:string[]){const env={...process.env,HOME:home,...(process.platform==='win32'?{USERPROFILE:home}:{})};for(const key of Object.keys(env))if(key.startsWith('MAC_MCP_'))delete (env as NodeJS.ProcessEnv)[key];return spawn(process.execPath,[cli,...args],{env,stdio:['ignore','pipe','pipe']});}
async function command(home:string,args:string[],success=true){
  const child=launch(home,args);let out='';child.stdout.on('data',d=>out+=String(d));child.stderr.on('data',d=>out+=String(d));
  const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  assert.equal(code===0,success,out);return out;
}
async function status(home:string,name:string){return JSON.parse(await command(home,['status','--instance',name,'--json'])) as {phase:string;port:number;configState:string;runtime:{runId:string;launcher:string;appParentPid:number|null};active:{revision:string}};}
async function wait(home:string,name:string,phase:string){for(let i=0;i<80;i++){const s=await status(home,name);if(s.phase===phase)return s;await new Promise(r=>setTimeout(r,150));}throw Error('Timeout waiting '+name+' '+phase);}
function start(home:string,name:string,fixtureWorker=false){const child=fixtureWorker?spawn(process.execPath,[fileURLToPath(new URL('./fixtures/instance-supervisor.js',import.meta.url)),name],{env:{...process.env,HOME:home,...(process.platform==='win32'?{USERPROFILE:home}:{})},stdio:['ignore','pipe','pipe']}):launch(home,['run','--instance',name,'--json']);child.stdout.resume();child.stderr.resume();return child;}
async function clean(child:ChildProcess){if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await new Promise<void>(r=>{child.once('exit',()=>r());setTimeout(()=>{child.kill('SIGKILL');r();},10000).unref();});}}

test('instance store: JSONC, independent identities, conflict detection, linked sources and archive/default rules',async()=>{
  const {home,project}=await fixture();
  try{
    const a=await createInstance('开发',{config:config(project,await port())},home);
    const b=await createInstance('test',{config:config(project,await port())},home);
    assert.notEqual(a.id,b.id);assert.notEqual(instancePaths(a,home).access,instancePaths(b,home).access);
    assert.equal((await resolveInstance(undefined,home)).id,a.id);
    const loaded=await loadInstanceConfig(a);assert.match(loaded.text,/\/\/ Gateway/);
    await patchInstanceConfig(a,{connection:'tunnel'},loaded.revision,home);
    assert.match((await loadInstanceConfig(a)).text,/\/\/ Gateway/);
    await assert.rejects(patchInstanceConfig(a,{connection:'https'},loaded.revision,home),/CONFIG_CONFLICT/);
    const source=path.join(home,'external.jsonc');await writeFile(source,'// project settings\n'+JSON.stringify(config(project,await port())),{mode:0o644});
    const linked=await createInstance('linked',{file:source,link:true},home);
    await assert.rejects(createInstance('duplicate',{file:source,link:true},home),/CONFIG_ALREADY_BOUND/);
    await writeFile(source,'{ invalid');await assert.rejects(loadInstanceConfig(linked),/CONFIG_JSON_INVALID line/);
    await rm(source);await assert.rejects(loadInstanceConfig(linked),/ENOENT/);
    await changeRegistry(async r=>{r.instances.find(i=>i.id===a.id)!.archived=true;r.defaultInstanceId=null;},home);
    await assert.rejects(resolveInstance(undefined,home),/INSTANCE_REQUIRED/);
    assert.equal((await readRegistry(home)).instances.length,3);
    assert.throws(()=>parseConfig('{"schemaVersion":1,"projectRoot":"/","port":18893,"token":"secret"}'),/CONFIG_INVALID/);
  }finally{await rm(home,{recursive:true,force:true});}
});

test('external source permissions and aliases cannot bypass private state rules',async()=>{
  const {home,project}=await fixture();
  try{
    const source=path.join(home,'source.json');await writeFile(source,JSON.stringify(config(project,await port())),{mode:0o600});
    if(process.platform!=='win32'){
      await chmod(source,0o666);await assert.rejects(createInstance('unsafe',{file:source,link:true},home),/UNSAFE/);await chmod(source,0o600);
      const link=path.join(home,'alias.json');await symlink(source,link);await assert.rejects(createInstance('alias',{file:link,link:true},home),/UNSAFE/);
    }
    const a=await createInstance('a',{file:source},home);await writeFile(source,'{}');assert.equal((await loadInstanceConfig(a)).config.projectRoot,project);
  }finally{await rm(home,{recursive:true,force:true});}
});

test('two real instances: credential isolation, invalid source stop, port apply, rollback and unchanged run ownership',{timeout:150000},async()=>{
  const {home,project}=await fixture();const children:ChildProcess[]=[];
  try{
    const a=await createInstance('alpha',{config:config(project,await port())},home);
    const b=await createInstance('beta',{config:config(project,await port())},home);
    const accessA=await createAccessControl(instancePaths(a,home).access);const accessB=await createAccessControl(instancePaths(b,home).access);
    const key=await accessA.create('client A');await accessA.setMode('api-key');
    const keyB=await accessB.create('client B');await accessB.setMode('api-key');
    children.push(start(home,'alpha',true),start(home,'beta'));
    const first=await wait(home,'alpha','running');const second=await wait(home,'beta','running');
    const rpc=(p:number,key:string)=>fetch(`http://127.0.0.1:${p}/mcp`,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',authorization:'Bearer '+key},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})});
    assert.equal((await rpc(second.port,key.key)).status,401);assert.equal((await rpc(second.port,keyB.key)).status,200);
    await command(home,['run','--instance','alpha','--json'],false);
    let loaded=await loadInstanceConfig(a);const newPort=await port();await patchInstanceConfig(a,{port:newPort},loaded.revision,home);
    assert.equal((await status(home,'alpha')).port,first.port);assert.equal((await status(home,'alpha')).configState,'pending');
    await command(home,['config','apply','--instance','alpha','--json']);
    const changed=await wait(home,'alpha','running');assert.equal(changed.port,newPort);assert.equal(changed.runtime.runId,first.runtime.runId);
    assert.equal((await status(home,'beta')).runtime.runId,second.runtime.runId);
    await accessA.create('remaining active client');
    await accessA.revoke(key.id);
    // Inject a worker crash at the process boundary, after the old worker has stopped.
    loaded=await loadInstanceConfig(a);await patchInstanceConfig(a,{gitMode:'review'},loaded.revision,home);
    assert.match(await command(home,['config','apply','--instance','alpha','--json'],false),/APPLY_FAILED_RESTORED/);
    assert.equal((await status(home,'alpha')).port,newPort);
    assert.equal((await status(home,'alpha')).configState,'pending');
    assert.equal((await status(home,'alpha')).runtime.runId,first.runtime.runId);
    loaded=await loadInstanceConfig(a);await patchInstanceConfig(a,{gitMode:'off'},loaded.revision,home);
    // Port collision is rejected before stopping the active worker.
    loaded=await loadInstanceConfig(a);await patchInstanceConfig(a,{port:second.port},loaded.revision,home);
    await command(home,['config','apply','--instance','alpha','--json'],false);assert.equal((await status(home,'alpha')).port,newPort);
    assert.equal((await rpc(newPort,key.key)).status,401);
    await writeFile(a.source.path,'{ broken');assert.equal((await status(home,'alpha')).configState,'invalid');
    await command(home,['stop','--instance','alpha','--json']);await wait(home,'alpha','stopped');assert.equal((await status(home,'beta')).phase,'running');
    await command(home,['instance','copy','beta','copy','--json']);
    await command(home,['run','--instance','copy','--json'],false);
    const copy=await resolveInstance('copy',home);assert.equal(copy.requiredAccess,'api-key');assert.equal((await (await createAccessControl(instancePaths(copy,home).access)).snapshot()).credentials.length,0);
  }finally{for(const child of children)await clean(child);await rm(home,{recursive:true,force:true});}
});

test('App parent exit stops only App-owned instance, leaving CLI instance alive',{timeout:100000},async()=>{
  const {home,project}=await fixture();const children:ChildProcess[]=[];
  try{
    await createInstance('terminal',{config:config(project,await port())},home);await createInstance('app',{config:config(project,await port())},home);
    children.push(start(home,'terminal'));await wait(home,'terminal','running');
    const parentScript=`const {spawn}=require('node:child_process'); const c=spawn(process.execPath,[${JSON.stringify(cli)},'run','--instance','app','--app-parent-pid',String(process.pid),'--json'],{stdio:'ignore'});setInterval(()=>{},1000);`;
    const parent=spawn(process.execPath,['-e',parentScript],{env:{...process.env,HOME:home,...(process.platform==='win32'?{USERPROFILE:home}:{})},stdio:'ignore'});children.push(parent);
    const app=await wait(home,'app','running');assert.equal(app.runtime.launcher,'app');
    parent.kill('SIGTERM');await wait(home,'app','stopped');assert.equal((await status(home,'terminal')).phase,'running');
  }finally{for(const child of children)await clean(child);await rm(home,{recursive:true,force:true});}
});

test('simultaneous starts yield one owner; source repair, live archive and restore remain usable',{timeout:90000},async()=>{
  const {home,project}=await fixture();const children:ChildProcess[]=[];
  try{
    const a=await createInstance('race',{config:config(project,await port())},home);
    children.push(start(home,'race'),start(home,'race'));
    await wait(home,'race','running');
    await new Promise(r=>setTimeout(r,300));assert.equal(children.filter(c=>c.exitCode===null&&c.signalCode===null).length,1);
    const original=(await loadInstanceConfig(a)).text;
    await writeFile(a.source.path,'// repair me\n{broken');
    const shown=JSON.parse(await command(home,['config','show','--instance','race','--json'])) as {text:string;revision:string;config:null;problem:string};
    assert.equal(shown.config,null);assert.match(shown.text,/repair me/);assert.match(shown.problem,/line/);
    await saveInstanceConfig(a,original,shown.revision,home);
    await rm(a.source.path);assert.equal((await status(home,'race')).configState,'missing');
    await command(home,['config','recover','--instance','race','--json']);assert.equal((await loadInstanceConfig(a)).config.projectRoot,project);
    await command(home,['instance','archive','race','--json']);assert.equal((await readRegistry(home)).defaultInstanceId,null);
    assert.equal((await resolveInstance('race',home,true)).archived,true);
    await command(home,['instance','restore','race','--json']);assert.equal((await resolveInstance('race',home)).archived,false);
    assert.equal((await readRegistry(home)).defaultInstanceId,null);
  }finally{for(const child of children)await clean(child);await rm(home,{recursive:true,force:true});}
});

test('legacy migration previews without writes, keeps credentials and revocations, and maps profile alias',{timeout:90000},async()=>{
  const {home,project}=await fixture();let child:ChildProcess|undefined;
  try{
    const {saveSetupConfig,defaultSetupPath}=await import('../src/release1-onboarding.js');
    const saved={version:1 as const,projectRoot:project,port:await port(),mode:'read-only' as const,connection:'https' as const};
    await saveSetupConfig(saved,{file:defaultSetupPath(home)});
    const originalSetup=await readFile(defaultSetupPath(home),'utf8');
    const oldAccess=path.join(home,'.config','mac-mcp-gateway','access-v1.json');const access=await createAccessControl(oldAccess);
    const revoked=await access.create('revoked');const active=await access.create('active');await access.setMode('api-key');await access.revoke(revoked.id);
    const original=await readFile(oldAccess,'utf8');
    const preview=JSON.parse(await command(home,['instance','migrate','setup','--json'])) as {result:string;sources:unknown[]};assert.equal(preview.result,'PREVIEW');assert.equal(preview.sources.length,1);
    assert.equal((await readRegistry(home)).instances.length,0);
    await command(home,['instance','migrate','setup','--confirm','--name','migrated','--json']);
    const instance=await resolveInstance('migrated',home);assert.equal(instance.legacy,'setup');
    assert.equal(await readFile(oldAccess,'utf8'),original);assert.equal(await readFile(instancePaths(instance,home).access,'utf8'),original);
    assert.equal(await readFile(defaultSetupPath(home),'utf8'),originalSetup);
    child=start(home,'migrated');await wait(home,'migrated','running');
    const alias=JSON.parse(await command(home,['status','--profile','setup','--json'])) as {instanceId:string};assert.equal(alias.instanceId,instance.id);
    assert.match(await command(home,['status','--profile','live','--json'],false),/LEGACY_PROFILE_NOT_MIGRATED_USE_INSTANCE/);
    assert.match(await command(home,['start-setup','--json'],false),/ALREADY|RUNNING|OWNER/);
    const target=await createAccessControl(instancePaths(instance,home).access);
    await assert.rejects(target.authenticate('Bearer '+revoked.key),/ACCESS_UNAUTHORIZED/);assert.equal((await target.authenticate('Bearer '+active.key)).kind,'verified-api-key');
    await command(home,['instance','migrate','setup','--confirm','--json'],false);
  }finally{if(child)await clean(child);await rm(home,{recursive:true,force:true});}
});
