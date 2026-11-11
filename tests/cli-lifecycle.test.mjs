import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,open,readFile,realpath,rename,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import test from 'node:test';
import {createInstance,instanceConfigSchema,instancePaths,loadInstanceConfig,patchInstanceConfig,readRegistry} from '../dist/src/instance-store.js';
import {runtimePaths} from '../dist/src/instance-runtime.js';

const execute=promisify(execFile);
const cli=path.resolve('bin/starmux.mjs');
async function fixture(t){
  const home=await mkdtemp(path.join(await realpath(tmpdir()),'starmux-cli-'));
  const project=path.join(home,'project');await mkdir(project);
  const server=createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  const instance=await createInstance('default',{config:instanceConfigSchema.parse({schemaVersion:1,projectRoot:project,port})},home);
  async function run(...args){
    try{const result=await execute(process.execPath,[cli,...args],{env:{...process.env,HOME:home,USERPROFILE:home},timeout:40000});return {...result,code:0};}
    catch(error){if(typeof error.code!=='number')throw error;return {stdout:error.stdout,stderr:error.stderr,code:error.code};}
  }
  t.after(async()=>{
    await run('down');
    // This fixture is the only creator of this random instance ID.
    try{
      const owner=JSON.parse(await readFile(runtimePaths(instance.id).meta,'utf8'));
      if(owner.instanceId===instance.id)try{process.kill(owner.pid,'SIGTERM');}catch{}
    }catch{}
    await rm(home,{recursive:true,force:true});
  });
  return {home,instance,port,run};
}

test('CLI unknown state blocks mutations and never passes doctor', {timeout:30000},async t=>{
  const f=await fixture(t),blocker=createServer();
  await new Promise((resolve,reject)=>{blocker.once('error',reject);blocker.listen(f.port,'127.0.0.1',resolve);});
  t.after(()=>new Promise(resolve=>blocker.close(resolve)));
  const before=(await loadInstanceConfig(f.instance)).revision;
  for(const args of [['up','--code','--yes'],['down'],['rm'],['config','apply'],['doctor']]){
    const result=await f.run(...args,'--json');
    assert.equal(result.code,1,`${args.join(' ')} must fail: ${result.stdout}`);
    assert.ok(JSON.parse(result.stdout).error);
  }
  assert.equal((await loadInstanceConfig(f.instance)).revision,before,'failed up must not save coding permissions');
  assert.equal((await readRegistry(f.home)).instances[0].archived,false);
  const status=await f.run('status','--json');
  assert.equal(JSON.parse(status.stdout).phase,'unknown');
  const display=await f.run('status');
  assert.match(display.stdout,/Active mode\s+Unavailable/);
  assert.match(display.stdout,/Saved mode/);
  assert.match((await f.run('ls')).stdout,/unknown.*unavailable/);
  assert.equal(JSON.parse((await f.run('config','show','--effective','--json')).stdout),null);
});

test('real CLI starts, applies permissions, confirms stop, and archives only a stopped run', {timeout:90000},async t=>{
  const f=await fixture(t);
  const started=await f.run('up','--json');
  assert.equal(started.code,0,started.stdout+started.stderr);
  const running=JSON.parse(started.stdout);
  assert.equal(running.phase,'running');assert.equal(running.health,'ok');
  const again=await f.run('up','--json');
  assert.equal(again.code,0,again.stdout+again.stderr);
  assert.equal(JSON.parse(again.stdout).runtime.runId,running.runtime.runId);
  const applied=await f.run('up','--code','--yes','--json');
  assert.equal(applied.code,0,applied.stdout+applied.stderr);
  assert.equal(JSON.parse(applied.stdout).active.config.mode,'read-write');
  const down=await f.run('down','--json');
  assert.equal(down.code,0,down.stdout+down.stderr);
  assert.equal(JSON.parse(down.stdout).result,'STOPPED');
  assert.match((await f.run('down')).stdout,/Already stopped/);
  const stopped=JSON.parse((await f.run('status','--json')).stdout);
  assert.equal(stopped.phase,'stopped');assert.equal(stopped.active,null);
  assert.equal(stopped.lastActive.config.mode,'read-write');
  assert.equal((await f.run('rm','--json')).code,0);
  assert.equal((await readRegistry(f.home)).instances[0].archived,true);
});

test('real CLI stays healthy with several slow or unresponsive optional upstreams',{timeout:90000},async t=>{
  const f=await fixture(t),loaded=await loadInstanceConfig(f.instance);
  const upstreams=['silent','slow-catalog','stubborn','healthy'].map((mode,index)=>({
    id:'optional'+index,transport:'stdio',command:process.execPath,
    args:[path.resolve('tests/fixtures/optional-upstream.mjs'),mode,path.join(f.home,mode+'.pid')],allowTools:['echo']
  }));
  await patchInstanceConfig(f.instance,{upstreams},loaded.revision,f.home);
  const started=await f.run('up','--json');
  assert.equal(started.code,0,started.stdout+started.stderr);
  const state=JSON.parse(started.stdout);assert.equal(state.phase,'running');assert.equal(state.health,'ok');
  assert.equal(state.accessMode,'ingress');
  assert.equal((await f.run('down','--json')).code,0);
});

test('CLI reads oversized logs and follows same-sized rotated replacements',{timeout:30000},async t=>{
  const f=await fixture(t),log=path.join(instancePaths(f.instance,f.home).logs,'core.log');
  const handle=await open(log,'w',0o600);await handle.truncate(33*1024*1024);
  const marker=Buffer.from('\nold-output\n');await handle.write(marker,0,marker.length,33*1024*1024-marker.length);await handle.close();
  const initial=await f.run('logs','--json','--lines','1');assert.equal(initial.code,0,initial.stderr);
  assert.equal(JSON.parse(initial.stdout).output,'old-output\n');
  await writeFile(log,'old-output\n');
  const child=spawn(process.execPath,[cli,'logs','--json','--follow','--lines','1'],{
    env:{...process.env,HOME:f.home,USERPROFILE:f.home},stdio:['ignore','pipe','pipe']
  });
  let output='',errors='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>errors+=data);
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const closed=once(child,'close');child.kill('SIGKILL');await closed;}});
  async function waitForText(text){
    for(let n=0;n<150;n++){if(output.includes(text))return;await new Promise(resolve=>setTimeout(resolve,40));}
    assert.fail('Missing '+text+': '+output+errors);
  }
  await waitForText('old-output');await rename(log,log+'.1');await writeFile(log,'new-output\n',{mode:0o600});
  await waitForText('new-output');
  const closed=once(child,'close');child.kill('SIGTERM');await closed;
});

test('ordinary CLI mode changes keep configs simple; explicit ignored options get nonblocking notices',{timeout:90000},async t=>{
  const f=await fixture(t);
  assert.doesNotMatch((await loadInstanceConfig(f.instance)).text,/gitMode|worktreeMode/);
  assert.doesNotMatch((await f.run('config','show')).stdout,/Git workflow|gitMode|worktreeMode/);
  assert.doesNotMatch((await f.run('config','diff')).stdout,/gitMode|worktreeMode/);
  assert.deepEqual(JSON.parse((await f.run('config','validate','--json')).stdout).warnings,[]);
  for(const mode of ['--code','--read','--code']){
    const result=await f.run('up',mode,'--yes','--json');assert.equal(result.code,0,result.stderr+result.stdout);
    assert.doesNotMatch((await loadInstanceConfig(f.instance)).text,/gitMode|worktreeMode/);
  }
  let loaded=await loadInstanceConfig(f.instance);
  const patch=await f.run('config','patch','--patch',JSON.stringify({gitMode:'review',worktreeMode:'linked'}),'--revision',loaded.revision,'--json');
  assert.equal(patch.code,0,patch.stderr);assert.equal(JSON.parse(patch.stdout).warnings.length,2);
  const valid=await f.run('config','validate');assert.equal(valid.code,0);assert.match(valid.stdout,/Git remains available through the terminal/);
  const applied=await f.run('config','apply','--json');assert.equal(applied.code,0,applied.stderr);assert.equal(JSON.parse(applied.stdout).warnings.length,2);
  assert.match((await f.run('config','show','--effective')).stdout,/gitMode=.*ignored/);
  const up=await f.run('up','--json');assert.equal(up.code,0);assert.doesNotMatch(up.stderr,/CONFIG_OPTION_IGNORED|Note:/);
  loaded=await loadInstanceConfig(f.instance);assert.equal(loaded.config.gitMode,'review');assert.equal(loaded.config.worktreeMode,'linked');
  assert.equal((await f.run('config','export')).stdout,loaded.text);
  assert.equal((await f.run('down','--json')).code,0);
});

test('CLI network flags persist, apply live, and preserve idempotent runs', {timeout:90000},async t=>{
  const f=await fixture(t);
  for(const args of [['--allow-lan','--local'],['--local','--allow-lan'],['--allow-lan','--no-allow-lan'],['--no-allow-lan','--allow-lan']]){
    const before=(await loadInstanceConfig(f.instance)).revision;
    const conflict=await f.run('up',...args,'--json');
    assert.equal(conflict.code,1);
    assert.equal(JSON.parse(conflict.stdout).error,'CLI_CONFLICTING_NETWORK_FLAGS:Choose either --allow-lan or --local, not both.');
    assert.equal((await loadInstanceConfig(f.instance)).revision,before);
  }
  const up=async(...flags)=>{
    const result=await f.run('up',...flags,'--json');assert.equal(result.code,0,result.stdout+result.stderr);
    const state=JSON.parse(result.stdout);assert.equal(state.health,'ok');return state;
  };
  const lan=await up('--allow-lan');
  assert.equal(lan.active.config.allowLan,true);
  assert.equal((await loadInstanceConfig(f.instance)).config.allowLan,true);
  assert.equal((await up()).runtime.runId,lan.runtime.runId);
  assert.equal((await up('--allow-lan')).runtime.runId,lan.runtime.runId);
  assert.match((await f.run('status')).stdout,new RegExp(`0\\.0\\.0\\.0:${f.port}`));
  assert.match((await f.run('ls')).stdout,new RegExp(`0\\.0\\.0\\.0:${f.port}`));
  const status=(await f.run('status')).stdout;
  assert.match(status,new RegExp(`Setup URL\\s+http://127\\.0\\.0\\.1:${f.port}/access`));
  assert.match(status,new RegExp(`Dashboard URL\\s+http://127\\.0\\.0\\.1:${f.port}/dashboard`));
  const local=await up('--local');
  assert.equal(local.active.config.allowLan,false);
  assert.notEqual(local.runtime.runId,lan.runtime.runId);
  assert.equal(local.runtime.pid,lan.runtime.pid,'apply keeps the supervisor');
  assert.equal((await up()).runtime.runId,local.runtime.runId);
  const lanAgain=await up('--allow-lan');
  assert.equal(lanAgain.active.config.allowLan,true);
  const alias=await up('--no-allow-lan');assert.equal(alias.active.config.allowLan,false);
  assert.notEqual(alias.runtime.runId,lanAgain.runtime.runId);
  const stopped=await f.run('down','--json');assert.equal(stopped.code,0,stopped.stdout+stopped.stderr);
  assert.equal(JSON.parse(stopped.stdout).runId,alias.runtime.runId,'stop confirms the new control generation');
  assert.equal((await f.run('init','--allow-lan','--json')).code,0);
  assert.equal((await f.run('init','--json')).code,0);
  assert.equal((await loadInstanceConfig(f.instance)).config.allowLan,true);
  assert.equal((await f.run('init','--no-allow-lan','--json')).code,0);
  assert.equal((await loadInstanceConfig(f.instance)).config.allowLan,false);
});

test('CLI permission round trips preserve services and advanced compatibility values',{timeout:90000},async t=>{
  const f=await fixture(t),loaded=await loadInstanceConfig(f.instance);
  const upstreams=[{id:'retained',transport:'stdio',command:process.execPath,args:[path.resolve('tests/fixtures/optional-upstream.mjs'),'healthy',path.join(f.home,'child.pid')],allowTools:['echo']}];
  await patchInstanceConfig(f.instance,{upstreams,gitMode:'review',worktreeMode:'linked'},loaded.revision,f.home);
  const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
  const {StreamableHTTPClientTransport}=await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  for(const mode of ['code','read','code']){
    const started=await f.run('up','--'+mode,'--yes','--json');assert.equal(started.code,0,started.stdout+started.stderr);
    const saved=await loadInstanceConfig(f.instance);
    assert.deepEqual(saved.config.upstreams,instanceConfigSchema.parse({...saved.config,upstreams}).upstreams);
    assert.equal(saved.config.gitMode,'review');assert.equal(saved.config.worktreeMode,'linked');
    const client=new Client({name:'mode-regression',version:'1'},{capabilities:{}});
    try{
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${f.port}/mcp`)));
      const tools=(await client.listTools()).tools;
      assert.equal(tools.some(tool=>tool.name==='retained__echo'),mode==='code');
      const call=await client.callTool({name:'retained__echo',arguments:{}});
      if(mode==='read'){assert.equal(call.isError,true);assert.match(call.content[0].text,/READ_ONLY_MODE/);}
      else assert.equal(call.content[0].text,'healthy');
    }finally{await client.close();}
  }
});
