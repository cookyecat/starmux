import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,mkdir,readFile,realpath,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import test from 'node:test';
import {createInstance,instanceConfigSchema,loadInstanceConfig,readRegistry} from '../dist/src/instance-store.js';
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
