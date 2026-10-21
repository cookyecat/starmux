import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {windows,ownedByUser,createPrivateDirectory,within,diskUsageCommand,commandOptions} from '../src/platform.js';
import {lstatSync} from 'node:fs';
import {loadSetupConfig} from '../src/release1-onboarding.js';
const exec=promisify(execFile);
const cli=fileURLToPath(new URL('../../bin/mac-mcp-gateway.mjs',import.meta.url));
async function freePort(){
  const server=net.createServer();
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();assert(address&&typeof address!=='string');
  await new Promise<void>(resolve=>server.close(()=>resolve()));return address.port;
}
test('portable CLI: private setup, restricted denial, native write and Shell, authenticated stop', {timeout:300000},async()=>{
  const home=await realpath(await mkdtemp(path.join(tmpdir(),'gateway-platform-')));
  const project=path.join(home,'projects','code',"Workspace space ' 中文");
  await mkdir(project,{recursive:true});await writeFile(path.join(project,'hello.txt'),'platform fixture');
  const env:NodeJS.ProcessEnv={...process.env,HOME:home,USERPROFILE:home,...(windows?{APPDATA:path.join(home,"AppData","Roaming"),LOCALAPPDATA:path.join(home,"AppData","Local")}:{} )};
  for(const key of Object.keys(env))if(key.startsWith('MAC_MCP_'))delete env[key];
  const port=await freePort();const endpoint=`http://127.0.0.1:${port}`;
  const run=(...args:string[])=>exec(process.execPath,[cli,...args],{env,cwd:tmpdir(),timeout:45000,maxBuffer:100000});
  let child:ReturnType<typeof spawn>|undefined;
  let output='';
  async function start(){
    output='';child=spawn(process.execPath,[cli,'run'],{env,cwd:tmpdir(),stdio:['ignore','pipe','pipe']});
    child.stdout?.on('data',chunk=>{output+=String(chunk);});child.stderr?.on('data',chunk=>{output+=String(chunk);});
    for(let i=0;i<100;i++){
      if(child.exitCode!==null)throw Error(output);
      try{if((await fetch(endpoint+'/healthz',{signal:AbortSignal.timeout(500)})).ok)return;}catch{}
      await new Promise(resolve=>setTimeout(resolve,300));
    }
    throw Error('Core startup timed out: '+output);
  }
  async function rpc(method:string,params:Record<string,unknown>={}){
    const response=await fetch(endpoint+'/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(20000)});
    assert.equal(response.status,200);
    const body=await response.json() as {error?:unknown;result:{isError?:boolean;content?:{text?:string}[];tools?:{name:string}[]}};
    assert.equal(body.error,undefined);return body.result;
  }
  async function stop(){
    const stopped=await run('stop');assert.match(stopped.stdout,/STOPPED/);
    for(let i=0;i<50&&child?.exitCode===null;i++)await new Promise(resolve=>setTimeout(resolve,100));
    assert.notEqual(child?.exitCode,null,output);child=undefined;
    await assert.rejects(fetch(endpoint+'/healthz',{signal:AbortSignal.timeout(1000)}));
  }
  try{
    await run('setup','--access-role','restricted','--project',project,'--connection','tunnel','--port',String(port));
    const config=path.join(home,'.config','mac-mcp-gateway','onboarding-v1.json');
    assert(ownedByUser(config,lstatSync(config),true));
    const doctor=await run('doctor');assert.match(doctor.stdout,/"result":"PASS"/);
    await start();assert.match(output,/Config source/);assert.match(output,/Build version/);
    await assert.rejects(run('run'),/CORE_ALREADY_RUNNING/);
    assert.notEqual((await rpc('tools/call',{name:'read_file',arguments:{path:'hello.txt'}})).isError,true);
    assert.equal((await rpc('tools/call',{name:'write_file',arguments:{path:'blocked.txt',content:'no'}})).isError,true);
    const status=await run('status','--json');assert.match(status.stdout,/"coreControl":"RUNNING"/);
    assert.match((await run('verify')).stdout,/"result":"PASS"/);await stop();
    const trusted=['setup','--access-role','trusted','--project',project,'--connection','tunnel','--port',String(port),'--approve-trusted-developer','--replace'];
    if(process.platform!=='darwin'){
      await assert.rejects(run(...trusted),error=>{assert(error&&typeof error==='object'&&'stdout' in error);assert.match(String(error.stdout),/SETUP_UNRESTRICTED_APPROVAL_REQUIRED/);return true;});
      trusted.push('--approve-unrestricted');
    }
    await run(...trusted);await start();
    const catalog=await rpc('tools/list');assert(catalog.tools?.some(tool=>tool.name==='start_process'));
    const file=path.join(project,'native.txt');
    assert.notEqual((await rpc('tools/call',{name:'write_file',arguments:{path:file,content:'native platform write',mode:'rewrite'}})).isError,true);
    assert.equal(await readFile(file,'utf8'),'native platform write');
    const shell=await rpc('tools/call',{name:'start_process',arguments:{command:windows?"Write-Output 'GATEWAY_PLATFORM_SHELL'":"printf GATEWAY_PLATFORM_SHELL",...(windows?{shell:'powershell.exe'}:{}),timeout_ms:10000}});
    assert.notEqual(shell.isError,true);assert.match(JSON.stringify(shell),/GATEWAY_PLATFORM_SHELL/);
    const sizes=await rpc('tools/call',{name:'start_process',arguments:{...commandOptions(diskUsageCommand(project,1)),timeout_ms:10000}});
    assert.notEqual(sizes.isError,true);assert.match(JSON.stringify(sizes),/Workspace space/);
    await stop();
  }finally{
    if(child?.exitCode===null){try{await run('stop');}catch{child.kill();}}
    await rm(home,{recursive:true,force:true});
  }
});
test('private storage and path boundaries use host semantics',async()=>{
  const home=await mkdtemp(path.join(tmpdir(),'gateway-private-'));
  try{
    const folder=path.join(home,'private');createPrivateDirectory(folder);
    assert(ownedByUser(folder,lstatSync(folder),true));
    assert(within(path.join(folder,'file'),folder));assert(!within(folder+'-other',folder));
    if(windows){
      assert(within(path.join(folder.toUpperCase(),'file'),folder));
      const file=path.join(folder,'sensitive.json');await writeFile(file,'{}');
      assert(ownedByUser(file,lstatSync(file),true));
      await exec('icacls.exe',[file,'/grant','*S-1-1-0:R']);
      assert.equal(ownedByUser(file,lstatSync(file),true),false);
      await assert.rejects(loadSetupConfig(file),/SETUP_CONFIG_FILE_UNSAFE/);
    }
  }finally{await rm(home,{recursive:true,force:true});}
});
