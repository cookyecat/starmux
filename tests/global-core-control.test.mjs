import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {acquireControl,connectOwner,controlPaths,globalStop} from '../dist/src/global-core-control.js';
import {createPrivateDirectory} from '../dist/src/platform.js';

const port=18893;
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
async function fixture(t){
  const root=path.join(process.platform==='win32'?os.tmpdir():'/tmp','sm-core-'+randomBytes(5).toString('hex'));
  createPrivateDirectory(root);
  const leases=[];
  t.after(async()=>{
    await Promise.all(leases.map(lease=>lease.release().catch(()=>{})));
    await fs.rm(root,{recursive:true,force:true});
  });
  return {root,paths:controlPaths(port,root),async lease(){const lease=await acquireControl(port,{root});leases.push(lease);return lease;}};
}

test('stop acceptance waits for release, including when the handler awaits release itself',{timeout:5000},async t=>{
  const f=await fixture(t),lease=await f.lease(),entered=deferred(),proceed=deferred();
  lease.markRunning();
  lease.onStop(async()=>{entered.resolve();await proceed.promise;await lease.release();});
  let completed=false;
  const stopped=globalStop(port,{root:f.root,timeoutMs:2500}).then(result=>{completed=true;return result;});
  await entered.promise;
  await delay(30);
  assert.equal(completed,false,'STOP_ACCEPTED must not be reported as STOPPED');
  assert.equal((await connectOwner(port,{root:f.root})).result.result,'STOPPING');
  proceed.resolve();
  assert.deepEqual(await stopped,{result:'STOPPED',launcher:'cli',ownerPid:process.pid,restarted:false});
  await assert.rejects(fs.stat(f.paths.lock),{code:'ENOENT'});
});

test('missing lease is distinct from an incomplete existing lease',async t=>{
  const f=await fixture(t);
  assert.deepEqual(await globalStop(port,{root:f.root}),{result:'NO_CONTROL_OWNER'});
  await fs.mkdir(f.paths.lock,{mode:0o700});
  await assert.rejects(globalStop(port,{root:f.root}),{code:'ENOENT'});
});

test('accepted stop without cleanup times out and retains the lease',{timeout:5000},async t=>{
  const f=await fixture(t),lease=await f.lease();
  lease.onStop(()=>{});
  await assert.rejects(globalStop(port,{root:f.root,timeoutMs:180}),/CORE_STOP_TIMEOUT/);
  assert.equal(JSON.parse(await fs.readFile(f.paths.meta,'utf8')).runId,lease.owner.runId);
});

test('handler failure is reported, never converted into a successful stop',async t=>{
  const f=await fixture(t),lease=await f.lease();
  lease.onStop(async()=>{throw Error('simulated cleanup failure');});
  await assert.rejects(globalStop(port,{root:f.root,timeoutMs:1500}),/CORE_STOP_FAILED/);
  assert.equal((await connectOwner(port,{root:f.root})).result.result,'STOP_FAILED');
});

test('stop without a registered handler is rejected',async t=>{
  const f=await fixture(t);await f.lease();
  await assert.rejects(globalStop(port,{root:f.root,timeoutMs:1500}),/CORE_STOP_UNVERIFIED/);
});

test('concurrent stop requests invoke cleanup once and both await it',{timeout:5000},async t=>{
  const f=await fixture(t),lease=await f.lease(),proceed=deferred();let calls=0;
  lease.onStop(async()=>{calls++;await proceed.promise;await lease.release();});
  const stops=[globalStop(port,{root:f.root,timeoutMs:2500}),globalStop(port,{root:f.root,timeoutMs:2500})];
  await delay(60);
  assert.equal(calls,1);
  proceed.resolve();
  assert.deepEqual((await Promise.all(stops)).map(r=>r.result),['STOPPED','STOPPED']);
});

test('a successor lease is left running when the requested run has stopped',{timeout:5000},async t=>{
  const f=await fixture(t),lease=await f.lease(),replaced=deferred();let successor;
  lease.onStop(async()=>{
    // Allow the first completion probe to observe the original lease.
    await delay(20);
    await lease.release();
    successor=await f.lease();successor.markRunning();replaced.resolve();
  });
  const result=await globalStop(port,{root:f.root,timeoutMs:2500});
  await replaced.promise;
  assert.equal(result.result,'STOPPED');
  assert.equal(result.restarted,true);
  assert.notEqual(successor.owner.runId,lease.owner.runId);
  const current=await connectOwner(port,{root:f.root});
  assert.equal(current.owner.runId,successor.owner.runId);
  assert.equal(current.result.result,'RUNNING');
});

test('release is shared by concurrent callers and closes idle connections within its bound',{timeout:5000},async t=>{
  const f=await fixture(t),lease=await f.lease();
  const socket=net.createConnection(f.paths.socket);
  socket.on('error',()=>{});t.after(()=>socket.destroy());
  await once(socket,'connect');
  const first=lease.release(),second=lease.release();
  assert.equal(first,second);
  await Promise.all([first,second]);
  await assert.rejects(fs.stat(f.paths.lock),{code:'ENOENT'});
});

test('unknown owner protocol is explicit and is not recovered as stale',async t=>{
  const f=await fixture(t),lease=await f.lease();
  await fs.writeFile(f.paths.meta,JSON.stringify({...lease.owner,version:99}),{mode:0o600});
  await assert.rejects(connectOwner(port,{root:f.root}),/CORE_CONTROL_PROTOCOL_UNSUPPORTED/);
  await assert.rejects(globalStop(port,{root:f.root}),/CORE_CONTROL_PROTOCOL_UNSUPPORTED/);
  await assert.rejects(acquireControl(port,{root:f.root}),/CORE_CONTROL_PROTOCOL_UNSUPPORTED/);
  assert.equal(JSON.parse(await fs.readFile(f.paths.meta,'utf8')).version,99);
  await fs.writeFile(f.paths.meta,JSON.stringify(lease.owner),{mode:0o600});
});

test('long durable state paths use short sockets',async t=>{
  const f=await fixture(t),root=path.join(f.root,'long-home-'.repeat(16));
  const lease=await acquireControl(port,{root});
  t.after(()=>lease.release());
  lease.markRunning();
  assert.equal((await connectOwner(port,{root})).result.result,'RUNNING');
});

test('release can clean its own directory after its metadata is deleted',async t=>{
  const f=await fixture(t),lease=await f.lease();
  await fs.unlink(f.paths.meta);
  assert.equal(lease.intact(),false);
  await lease.release();
  await assert.rejects(fs.stat(f.paths.lock),{code:'ENOENT'});
});

test('release refuses to remove a replaced control directory',async t=>{
  const f=await fixture(t),lease=await f.lease();
  await fs.rename(f.paths.lock,f.paths.lock+'.original');
  await fs.mkdir(f.paths.lock,{mode:0o700});
  await fs.writeFile(f.paths.meta,JSON.stringify(lease.owner),{mode:0o600});
  await assert.rejects(lease.release(),/CORE_CONTROL_LEASE_CHANGED/);
  assert.equal(JSON.parse(await fs.readFile(f.paths.meta,'utf8')).runId,lease.owner.runId);
});
