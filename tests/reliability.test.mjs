import assert from 'node:assert/strict';
import test from 'node:test';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,mkdtemp,readFile,writeFile,rm,readdir,stat,utimes,open,symlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {finished} from 'node:stream/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {withPrivateLock} from '../dist/src/private-store-lock.js';
import {createAccessControl} from '../dist/src/access-control.js';
import {createProcessLog,readProcessLogTail} from '../dist/src/process-log.js';
import {createPrivateDirectory} from '../dist/src/platform.js';
import {createToolDispatcher} from '../dist/src/tool-dispatch.js';
import {GatewayError} from '../dist/src/validation.js';
import {ConfiguredStdioUpstream,bootstrapConfiguredUpstreams} from '../dist/src/configured-mcp-upstreams.js';

async function fixture(t){
  await mkdir('.internal',{recursive:true});
  const root=await mkdtemp(path.resolve('.internal/reliability-'));
  const folder=path.join(root,'private');createPrivateDirectory(folder);
  t.after(()=>rm(root,{recursive:true,force:true}));
  return folder;
}
async function holder(t,file){
  const child=fork(new URL('./fixtures/private-lock-holder.mjs',import.meta.url),[file],{stdio:['ignore','ignore','pipe','ipc']});
  let errors='';child.stderr.on('data',data=>{errors+=data;});
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const closed=once(child,'close');child.kill('SIGKILL');await closed;}});
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Lock holder timed out: '+errors)),5000);
    child.once('message',()=>{clearTimeout(timeout);resolve();});
    child.once('exit',()=>{clearTimeout(timeout);reject(Error('Lock holder exited: '+errors));});
  });
  return child;
}
async function kill(child){const closed=once(child,'close');child.kill('SIGKILL');await closed;}

test('a killed store writer is recovered and concurrent recoverers remain exclusive',async t=>{
  const folder=await fixture(t),file=path.join(folder,'store.lock');
  await kill(await holder(t,file));
  let inside=0,completed=0;
  await Promise.all(Array.from({length:12},()=>withPrivateLock(file,async()=>{
    assert.equal(++inside,1);await delay(10);completed++;inside--;
  })));
  assert.equal(completed,12);assert.deepEqual(await readdir(folder),[]);
});

test('an old but live lock is never stolen',async t=>{
  const file=path.join(await fixture(t),'store.lock'),child=await holder(t,file);
  await utimes(file,new Date(0),new Date(0));
  await assert.rejects(withPrivateLock(file,()=>assert.fail('live lock stolen')),/INSTANCE_STORE_BUSY/);
  const closed=once(child,'close');child.send('release');await closed;
  await withPrivateLock(file,()=>{});
});

test('legacy empty locks retain unconfirmed ownership instead of being deleted by age',async t=>{
  const file=path.join(await fixture(t),'store.lock');await mkdir(file,{mode:0o700});
  await utimes(file,new Date(0),new Date(0));
  await assert.rejects(withPrivateLock(file,()=>assert.fail('legacy lock stolen')),/INSTANCE_STORE_BUSY/);
  assert.ok((await stat(file)).isDirectory());
});

test('authentication recovers a crashed lock without losing credentials or revocation',async t=>{
  const file=path.join(await fixture(t),'access.json'),access=await createAccessControl(file);
  const key=await access.create('fixture',null,true);
  await kill(await holder(t,file+'.lock'));
  assert.equal((await access.authenticate('Bearer '+key.key)).kind,'verified-api-key');
  await access.revoke(key.id);
  await assert.rejects(access.authenticate('Bearer '+key.key),/ACCESS_UNAUTHORIZED/);
  assert.equal((await access.snapshot()).mode,'api-key');
});

test('process logs rotate during writes, preserve the recent tail, and retain only three backups',async t=>{
  const folder=await fixture(t),file=path.join(folder,'core.log'),limit=4096;
  const stream=await createProcessLog(file,limit),done=finished(stream);
  const payload=Buffer.from('0123456789\n'.repeat(3000));
  stream.end(payload);await done;
  const files=await readdir(folder);assert.equal(files.length,4);
  const chunks=[];
  for(const name of ['core.log.3','core.log.2','core.log.1','core.log']){
    const data=await readFile(path.join(folder,name));assert.ok(data.length<=limit);chunks.push(data);
    if(process.platform!=='win32')assert.equal((await stat(path.join(folder,name))).mode&0o077,0);
  }
  const retained=Buffer.concat(chunks);assert.deepEqual(retained,payload.subarray(payload.length-retained.length));
});

test('oversized legacy logs remain readable and reopen without the old 32 MiB failure',async t=>{
  const file=path.join(await fixture(t),'core.log'),handle=await open(file,'w',0o600);
  await handle.truncate(33*1024*1024);await handle.write(Buffer.from('\nlegacy-tail\n'),0,13,33*1024*1024-13);await handle.close();
  const tail=await readProcessLogTail(file,4096);assert.match(tail.text,/legacy-tail/);assert.ok(tail.bytes.length<=4096);
  const stream=await createProcessLog(file,4096),done=finished(stream);stream.end('new-output\n');await done;
  assert.match(await readFile(file,'utf8'),/new-output/);
  assert.ok((await stat(file+'.1')).size<=4096);
});

test('log rotation refuses an unsafe backup target',{skip:process.platform==='win32'},async t=>{
  const folder=await fixture(t),file=path.join(folder,'core.log'),target=path.join(folder,'untouched');
  await writeFile(target,'keep',{mode:0o600});await symlink(target,file+'.1');
  const stream=await createProcessLog(file,32),done=finished(stream);stream.end(Buffer.alloc(64));
  await assert.rejects(done,/CONFIG_FILE_UNSAFE/);assert.equal(await readFile(target,'utf8'),'keep');
});

test('multiple unhealthy optional servers share a startup budget and healthy routes survive',{timeout:20000},async t=>{
  const folder=await fixture(t),config=path.join(folder,'upstreams.json');
  const modes=['silent','slow-catalog','stubborn','healthy'];
  const definitions=modes.map((mode,index)=>({id:'route'+index,transport:'stdio',command:process.execPath,
    args:[fileURLToPath(new URL('./fixtures/optional-upstream.mjs',import.meta.url)),mode,path.join(folder,mode+'.pid')],allowTools:['echo']}));
  await writeFile(config,JSON.stringify({version:1,upstreams:definitions}),{mode:0o600});
  const started=Date.now(),result=await bootstrapConfiguredUpstreams(config);
  t.after(()=>Promise.all(result.upstreams.map(child=>child.close())));
  assert.ok(Date.now()-started<14500,'discovery and child cleanup must fit below the Worker 20s deadline');
  assert.deepEqual(result.routes.map(route=>route.id),['route3']);
  assert.deepEqual(result.status().map(route=>route.status),['UNAVAILABLE','UNAVAILABLE','UNAVAILABLE','READY']);
  assert.equal((await result.upstreams[3].forwardWorkspaceInvocation({name:'echo',arguments:{}})).content[0].text,'healthy');
  for(const mode of modes.slice(0,3)){
    const pid=Number(await readFile(path.join(folder,mode+'.pid'),'utf8'));
    // SIGKILL delivery/child reaping can lag transport.close by a scheduling turn.
    let exited=false;
    for(let n=0;n<100;n++){try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH'){exited=true;break;}throw error;}await delay(20);}
    assert.ok(exited,mode+' child must be cleaned up');
  }
});

async function waitUntil(check){
  for(let n=0;n<150;n++){if(await check())return;await delay(20);}
  assert.fail('Timed out waiting for upstream lifecycle');
}
const processAlive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
for(const reconnect of [false,true])test(`close cancels real ${reconnect?'reconnection':'initialization'} and remains terminal`,async t=>{
  const folder=await fixture(t),pidFile=path.join(folder,'child.pid');
  const upstream=new ConfiguredStdioUpstream({id:'delayed',transport:'stdio',command:process.execPath,args:[path.resolve('tests/fixtures/optional-upstream.mjs'),'delayed',pidFile],allowTools:['echo']});
  t.after(()=>upstream.close());
  if(reconnect){
    await upstream.connect();process.kill(Number(await readFile(pidFile,'utf8')),'SIGKILL');
    await waitUntil(()=>upstream.status.status==='UNAVAILABLE');await rm(pidFile);
  }
  const pending=reconnect?upstream.forwardWorkspaceInvocation({name:'echo',arguments:{}}):upstream.connect();
  const rejected=assert.rejects(pending,e=>e.code==='UPSTREAM_CLOSED');
  let pid;await waitUntil(async()=>{try{pid=Number(await readFile(pidFile,'utf8'));return !!pid;}catch{return false;}});
  await Promise.all([upstream.close(),upstream.close(),rejected]);
  assert.equal(upstream.status.status,'CLOSED');assert.equal(processAlive(pid),false);
  await assert.rejects(upstream.connect(),e=>e.code==='UPSTREAM_CLOSED');
  await assert.rejects(upstream.forwardWorkspaceInvocation({name:'echo',arguments:{}}),e=>e.code==='UPSTREAM_CLOSED');
  assert.equal(processAlive(pid),false);
});
test('closing a dispatched call reports uncertain effects while preserving CLOSED',async t=>{
  const folder=await fixture(t),pidFile=path.join(folder,'child.pid');
  const upstream=new ConfiguredStdioUpstream({id:'hanging',transport:'stdio',command:process.execPath,args:[path.resolve('tests/fixtures/optional-upstream.mjs'),'hanging-call',pidFile],allowTools:['echo']});
  t.after(()=>upstream.close());await upstream.connect();
  const pending=assert.rejects(upstream.forwardWorkspaceInvocation({name:'echo',arguments:{}}),e=>e.code==='UPSTREAM_CALL_UNCERTAIN');
  await upstream.close();await pending;assert.equal(upstream.status.status,'CLOSED');
  assert.equal(processAlive(Number(await readFile(pidFile,'utf8'))),false);
});
test('AI receives distinct actionable closed and uncertain MCP tool errors',async()=>{
  for(const code of ['UPSTREAM_CLOSED','UPSTREAM_CALL_UNCERTAIN']){
    const dispatch=createToolDispatcher({forwardWorkspaceInvocation:async()=>{throw new GatewayError(code);}},()=>{},{upstreamRouter:{routeFor:()=> 'extra',authorizeExtension:async(name,args)=>({name,arguments:args})}});
    const result=await dispatch({name:'extra__echo',arguments:{}},{requestId:'lifecycle-feedback'});
    assert.equal(result.isError,true);assert.match(result.content[0].text,new RegExp('^'+code+':'));
    assert.match(result.content[0].text,code==='UPSTREAM_CLOSED'?/not dispatched.*restart/:/may have executed.*do not automatically replay/);
  }
});
