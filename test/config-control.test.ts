import assert from 'node:assert/strict';
import { chmod,mkdir,mkdtemp,readFile,realpath,rm,symlink,writeFile } from 'node:fs/promises';
import { createConnection,createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { acquireControl,connectOwner,controlPaths,globalStop } from '../src/global-core-control.js';
import { sandboxedDesktopSpawn } from '../src/home-write-sandbox.js';
import { operatorCommand } from '../src/operator-cli.js';
import { createProjectPolicy } from '../src/project-workspace-policy.js';
import { defaultSetupPath,loadSetupConfig,saveSetupConfig,setupRuntimeEnv } from '../src/release1-onboarding.js';

test('onboarding v1/v2/v3 retain roles, reason codes and private file protections',async()=>{
  const home=await realpath(await mkdtemp(join(tmpdir(),'gateway-config-test-')));
  const project=join(home,'project');await mkdir(project);
  const file=defaultSetupPath(home);
  const common={projectRoot:project,port:18993,connection:'https',mode:'read-only'};
  try{
    for(const config of [{...common,version:1},{...common,version:2,accessRole:'restricted'},
      {...common,mode:'read-write',version:2,accessRole:'trusted'},
      {...common,mode:'read-write',version:3,accessRole:'trusted',writeScope:'home-only'}]){
      await saveSetupConfig(config,{file,replace:true});assert.deepEqual(await loadSetupConfig(file),config);
      const env=setupRuntimeEnv(config);
      assert.equal(env.MAC_MCP_DC_ACCESS_MODE,config.mode==='read-write'?'native':'workspace');
      assert.equal(env.MAC_MCP_DC_WRITE_SCOPE,config.version===3?'home-only':'unrestricted');
    }
    assert.throws(()=>setupRuntimeEnv({...common,version:2,accessRole:'trusted'}),/SETUP_ACCESS_ROLE_MISMATCH/);
    assert.throws(()=>setupRuntimeEnv({...common,version:1,port:0}),/SETUP_INVALID_PORT/);
    await chmod(file,0o644);await assert.rejects(loadSetupConfig(file),/SETUP_CONFIG_FILE_UNSAFE/);
    await chmod(file,0o600);
    const contents=await readFile(file,'utf8');await rm(file);await writeFile(join(home,'target'),contents,{mode:0o600});
    await symlink(join(home,'target'),file);await assert.rejects(loadSetupConfig(file),/SETUP_CONFIG_FILE_UNSAFE/);
    const policy=await createProjectPolicy({root:project,mode:'read-write'});
    await assert.rejects(policy.prepare('read_file',{path:'../outside'}));
    await symlink(home,join(project,'escape'));await assert.rejects(policy.prepare('write_file',{path:'escape/private',content:'x'}));
    await assert.rejects(sandboxedDesktopSpawn({home,nodeBinary:process.execPath,entryArgs:[],binary:'/nonexistent/sandbox-exec'}),/HOME_WRITE_SANDBOX_UNAVAILABLE/);
  }finally{await rm(home,{recursive:true,force:true});}
});

test('owner control refuses duplicates and forged socket messages; only authenticated stop runs',async()=>{
  const root=await mkdtemp('/private/tmp/gw-ctrl-');
  const port=19983;
  const lease=await acquireControl(port,{root});let stopped=0;
  lease.onStop(async()=>{stopped++;return 'STOPPED';});lease.markRunning();
  try{
    assert.equal((await connectOwner(port,{root}))?.result.result,'RUNNING');
    await assert.rejects(acquireControl(port,{root}),/CORE_ALREADY_RUNNING/);
    const socket=createConnection(controlPaths(port,root).socket);
    await new Promise<void>((resolve,reject)=>{
      socket.on('error',reject);socket.on('close',()=>resolve());
      socket.on('connect',()=>socket.write(JSON.stringify({version:1,token:'forged',runId:lease.owner.runId,method:'stop'})+'\n'));
    });
    assert.equal(stopped,0);
    assert.equal((await globalStop(port,{root})).result,'STOPPED');assert.equal(stopped,1);
  }finally{await lease.release();await rm(root,{recursive:true,force:true});}
});

test('unknown listener is never adopted or stopped and failed launch releases its lease',async()=>{
  const home=await realpath(await mkdtemp('/private/tmp/gw-unknown-'));
  const root=join(home,'control');await mkdir(root,{mode:0o700});
  const project=join(home,'project');await mkdir(project);
  const listener=createServer();await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));
  const address=listener.address();assert.ok(address&&typeof address!=='string');
  try{
    await saveSetupConfig({version:1,projectRoot:project,port:address.port,mode:'read-only',connection:'https'}, {file:defaultSetupPath(home)});
    await assert.rejects(operatorCommand('run',{home,profile:'setup',controlRoot:root}),/PORT_IN_USE/);
    assert.equal(listener.listening,true);
    assert.equal(await connectOwner(address.port,{root}),null);
    assert.deepEqual(await globalStop(address.port,{root}),{result:'NO_CONTROL_OWNER'});
    assert.equal(listener.listening,true);
  }finally{await new Promise<void>(resolve=>listener.close(()=>resolve()));await rm(home,{recursive:true,force:true});}
});
