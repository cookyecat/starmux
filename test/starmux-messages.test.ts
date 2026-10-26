import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const exec=promisify(execFile);
const cli=fileURLToPath(new URL('../../bin/starmux.mjs',import.meta.url));
async function fixture(){
  const home=await realpath(await mkdtemp(path.join(tmpdir(),'starmux-messages-')));
  const cwd=path.join(home,'project');await mkdir(cwd);
  const env:NodeJS.ProcessEnv={...process.env,HOME:home,USERPROFILE:home};
  for(const key of Object.keys(env))if(key.startsWith('STARMUX_')||key.startsWith('MAC_MCP_'))delete env[key];
  const command=async(args:string[])=>exec(process.execPath,[cli,...args],{cwd,env,timeout:15000});
  return {home,command};
}

test('empty instance lists recommend the public Starmux command and retain JSON output',async()=>{
  const f=await fixture();try{
    for(const args of [['ls'],['status','--all']]){
      const {stdout,stderr}=await f.command(args);
      assert.equal(stdout,'No instances. Run: starmux up\n');assert.equal(stderr,'');
    }
    const {stdout}=await f.command(['ls','--json']);
    assert.deepEqual(JSON.parse(stdout),{schemaVersion:1,defaultInstanceId:null,instances:[]});
    await assert.rejects(f.command(['config','show']),error=>{
      assert.match((error as {stderr:string}).stderr,/Run starmux up in your project/);return true;
    });
    const preview=JSON.parse((await f.command(['migrate','--json'])).stdout) as {legacy:{message:string}};
    assert.match(preview.legacy.message,/starmux migrate setup/);assert.doesNotMatch(preview.legacy.message,/--confirm/);
  }finally{await rm(f.home,{recursive:true,force:true});}
});

test('archived and ambiguous instances provide working public recovery commands',async()=>{
  const f=await fixture();try{
    await f.command(['init']);await f.command(['config','archive','-i','default']);
    const archived=(await f.command(['ls'])).stdout;
    assert.match(archived,/No active instances/);assert.match(archived,/starmux ls --archived/);
    assert.match(archived,/starmux config restore -i NAME/);assert.doesNotMatch(archived,/mac-mcp-gateway/);
    assert.match((await f.command(['ls','--archived'])).stdout,/default/);
    await f.command(['config','restore','-i','default']);
    await f.command(['init','-i','second']);
    await assert.rejects(f.command(['status']),error=>{
      const stderr=(error as {stderr:string}).stderr;
      assert.match(stderr,/starmux config default NAME/);assert.doesNotMatch(stderr,/mac-mcp-gateway|or instance default/);return true;
    });
    await f.command(['config','default','second']);
    assert.equal(JSON.parse((await f.command(['status','--json'])).stdout).name,'second');
  }finally{await rm(f.home,{recursive:true,force:true});}
});

test('logs return valid JSON when empty and count complete lines correctly',async()=>{
  const f=await fixture();try{
    await f.command(['init']);
    const paths=JSON.parse((await f.command(['config','path','--json'])).stdout) as {instanceId:string;logs:string};
    assert.deepEqual(JSON.parse((await f.command(['logs','--json'])).stdout),{instanceId:paths.instanceId,output:''});
    assert.equal((await f.command(['logs'])).stdout,'No logs yet.\n');
    for(const ending of ['\n','']){
      await writeFile(path.join(paths.logs,'core.log'),'first\nsecond\nthird'+ending,{mode:0o600});
      assert.equal((await f.command(['logs','--lines','2'])).stdout,'second\nthird'+ending);
      assert.equal(JSON.parse((await f.command(['logs','--lines','1','--json'])).stdout).output,'third'+ending);
    }
    await writeFile(path.join(paths.logs,'core.log'),'');
    assert.deepEqual(JSON.parse((await f.command(['logs','--json'])).stdout),{instanceId:paths.instanceId,output:''});
  }finally{await rm(f.home,{recursive:true,force:true});}
});
