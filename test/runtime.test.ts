import {once} from 'node:events';
import assert from 'node:assert/strict';
import { mkdtemp,realpath,rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createGatewayRuntime } from '../src/dc-workspace-http.js';

test('runtime is explicit, coalesces starts, releases ports, and cleans failed startup',async()=>{
  const dir=await realpath(await mkdtemp(join(tmpdir(),'gateway-runtime-')));
  const signals=process.listenerCount('SIGTERM');
  const env={MAC_MCP_PROJECT_ROOT:dir,MAC_MCP_PROJECT_PORT:'0',MAC_MCP_DEV_COMMANDS:'presets'};
  const runtime=createGatewayRuntime({env,audit:()=>{}});
  assert.equal(runtime.port,null);assert.equal(process.listenerCount('SIGTERM'),signals);
  try{
    await Promise.all([runtime.start(),runtime.start()]);
    const port=runtime.port;assert.ok(port);
    assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status,200);
    await Promise.all([runtime.close(),runtime.close()]);assert.equal(runtime.port,null);
    const occupied=createServer();await new Promise<void>(resolve=>occupied.listen(port,'127.0.0.1',resolve));
    const collision=createGatewayRuntime({env:{...env,MAC_MCP_PROJECT_PORT:String(port)},audit:()=>{}});
    await assert.rejects(collision.start(),/EADDRINUSE/);await collision.close();
    await new Promise<void>(resolve=>occupied.close(()=>resolve()));
    await runtime.start();assert.ok(runtime.port);await runtime.close();
    const broken=createGatewayRuntime({env:{...env,MAC_MCP_GIT_MODE:'invalid'},audit:()=>{}});
    await assert.rejects(broken.start(),/INVALID_GIT_MODE/);await broken.close();
    assert.equal(process.listenerCount('SIGTERM'),signals);
  }finally{await runtime.close();await rm(dir,{recursive:true,force:true});}
});

test('parent App exit shuts down its owned Core and releases the port', {timeout:30000},async()=>{
  const {spawn}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const {mkdir}=await import('node:fs/promises');
  const {saveSetupConfig,defaultSetupPath}=await import('../src/release1-onboarding.js');
  const home=await realpath(await mkdtemp('/private/tmp/gateway-parent-'));
  const root=join(home,'project');await mkdir(root);
  const portProbe=createServer();await new Promise<void>(resolve=>portProbe.listen(0,'127.0.0.1',resolve));
  const addr=portProbe.address();assert.ok(addr&&typeof addr!=='string');
  const port=addr.port;await new Promise<void>(resolve=>portProbe.close(()=>resolve()));
  await saveSetupConfig({version:1,projectRoot:root,port,mode:'read-only',connection:'https'},{file:defaultSetupPath(home)});
  const parent=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/app-parent.js',import.meta.url))],{
    env:{HOME:home,PATH:process.env.PATH||'/usr/bin:/bin'},stdio:['ignore','pipe','pipe']});
  const closed=once(parent,'close');let output='';let childPid: number|undefined;
  parent.stdout.on('data',chunk=>{
    output+=String(chunk);const match=output.match(/"testChildPid":(\d+)/);if(match)childPid=Number(match[1]);
  });
  parent.stderr.on('data',chunk=>{output+=String(chunk);});
  async function healthy(){try{return (await fetch(`http://127.0.0.1:${port}/healthz`,{signal:AbortSignal.timeout(200)})).ok;}catch{return false;}}
  async function waitFor(expected: boolean){
    for(let i=0;i<150;i++){
      if(await healthy()===expected)return;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.fail('Core health did not become '+expected+': '+output);
  }
  try{
    await waitFor(true);parent.kill('SIGTERM');await waitFor(false);await closed;
    const probe=createServer();await new Promise<void>((resolve,reject)=>probe.once('error',reject).listen(port,'127.0.0.1',resolve));
    await new Promise<void>(resolve=>probe.close(()=>resolve()));
  }finally{
    if(parent.exitCode===null&&!parent.killed)parent.kill('SIGTERM');
    if(childPid){try{process.kill(childPid,'SIGTERM');}catch{/* Already stopped. */}}
    await rm(home,{recursive:true,force:true});
  }
});
