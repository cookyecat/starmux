import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,realpath,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {createAccessControl} from '../src/access-control.js';

const exec=promisify(execFile);
const cli=fileURLToPath(new URL('../../bin/starmux.mjs',import.meta.url));
const name='work space';
async function fixture(){
  const home=await realpath(await mkdtemp(path.join(tmpdir(),'starmux-guidance-')));
  const cwd=path.join(home,'project');await mkdir(cwd);
  const env:NodeJS.ProcessEnv={...process.env,HOME:home,USERPROFILE:home};
  for(const key of Object.keys(env))if(key.startsWith('STARMUX_')||key.startsWith('MAC_MCP_'))delete env[key];
  const command=async(args:string[])=>exec(process.execPath,[cli,...args,'-i',name],{cwd,env,timeout:45000});
  const cleanup=async()=>{await command(['down']).catch(()=>{});await new Promise(resolve=>setTimeout(resolve,200));await rm(home,{recursive:true,force:true});};
  return {home,cwd,env,command,cleanup};
}

test('startup guidance follows live ingress, API-key and OAuth authentication without exposing secrets',{timeout:90000},async()=>{
  const f=await fixture();try{
    const port=await freePort();
    const started=(await f.command(['up','--port',String(port)])).stdout;
    assert.match(started,/Auth\s+None \(no token required\)/);
    assert.match(started,/Connect an AI client/);assert.match(started,/Streamable HTTP/);
    assert.match(started,/Authentication\s+None\s+\(optional Bearer API key:/);assert.match(started,/this computer only/i);
    assert.ok(started.includes(`http://127.0.0.1:${port}/mcp`));
    assert.match(started,/protected HTTPS|HTTPS.*protected/);
    assert.match(started,/starmux dashboard -i 'work space'/);
    assert.match(started,/starmux logs -f -i 'work space'/);
    assert.match(started,/starmux down -i 'work space'/);
    const status=JSON.parse((await f.command(['status','--json'])).stdout) as {schemaVersion:number;event:string;phase:string;accessMode:string};
    assert.equal(status.schemaVersion,1);assert.equal(status.event,'GATEWAY_STATUS');assert.equal(status.phase,'running');assert.equal(status.accessMode,'ingress');
    assert.equal(Object.hasOwn(status,'nextSteps'),false);

    const key=JSON.parse((await f.command(['auth','key','Guide client','--json'])).stdout) as {id:string;key:string};
    const owner=(await f.command(['dashboard','--token'])).stdout.trim();
    const paths=JSON.parse((await f.command(['config','path','--json'])).stdout) as {access:string};
    const saved=JSON.parse(await readFile(paths.access,'utf8')) as {credentials:{digest:string}[]};
    const keyed=(await f.command(['up'])).stdout;
    assert.match(keyed,/Auth\s+API key \(Bearer token; 1 active key\)/);
    assert.match(keyed,/Authorization: Bearer <YOUR_API_KEY>/);assert.match(keyed,/STARMUX_TOKEN/);
    assert.match(keyed,/New API key\s+starmux auth key "My AI Client" -i 'work space'/);
    for(const secret of [key.key,owner,saved.credentials[0]!.digest])assert.ok(!keyed.includes(secret));
    assert.doesNotMatch(keyed,/Authentication\s+None/);
    assert.equal(JSON.parse((await f.command(['status','--json'])).stdout).accessMode,'api-key');

    await f.command(['auth','revoke',key.id]);
    const revoked=(await f.command(['status'])).stdout;
    assert.match(revoked,/0 active keys/);assert.match(revoked,/starmux auth key "My AI Client" -i 'work space'/);
    assert.doesNotMatch(revoked,/STARMUX_TOKEN/);

    const access=await createAccessControl(paths.access);
    const resource='https://gateway.example/mcp';const issuer='https://auth.example/realm';
    await access.configureOAuth({issuer,resource,jwksUri:issuer+'/keys',authorizationEndpoint:issuer+'/authorize',tokenEndpoint:issuer+'/token',
      clientId:'guidance-client',clientRegistration:'provided',tokenEndpointAuthMethod:'none',allowedSubjects:['fixture-owner']});
    await f.command(['auth','mode','oauth']);
    const oauth=(await f.command(['up'])).stdout;
    assert.match(oauth,/Auth\s+OAuth \(browser sign-in\)/);
    assert.match(oauth,/Issuer\s+https:\/\/auth\.example\/realm/);
    assert.match(oauth,/Client URL\s+https:\/\/gateway\.example\/mcp/);
    assert.match(oauth,/browser/i);assert.match(oauth,/starmux auth oauth doctor -i 'work space'/);
    assert.doesNotMatch(oauth,/starmux auth key|Authentication\s+None|<YOUR_API_KEY>/);
    for(const secret of [key.key,owner,saved.credentials[0]!.digest])assert.ok(!oauth.includes(secret));
    assert.equal(JSON.parse((await f.command(['status','--json'])).stdout).accessMode,'oauth');

    await f.command(['down']);
    const stopped=(await f.command(['status'])).stdout;
    assert.match(stopped,/saved for next start/);assert.match(stopped,/starmux up -i 'work space'/);
    assert.doesNotMatch(stopped,/Streamable HTTP|Authentication\s+None|Authorization: Bearer/);
  }finally{await f.cleanup();}
});

test('status does not initialize authentication or misreport a missing or invalid store as ingress',async()=>{
  const f=await fixture();try{
    await f.command(['init','--port',String(await freePort())]);
    const paths=JSON.parse((await f.command(['config','path','--json'])).stdout) as {access:string};
    await assert.rejects(readFile(paths.access),/ENOENT/);
    const initial=(await f.command(['status'])).stdout;
    assert.match(initial,/None \(no token required\)/);assert.match(initial,/saved for next start/);
    await assert.rejects(readFile(paths.access),/ENOENT/);await assert.rejects(readFile(paths.access+'.initialized'),/ENOENT/);
    await f.command(['auth','key','Private client','--json']);
    const original=await readFile(paths.access,'utf8');
    await rm(paths.access);
    const missing=(await f.command(['status'])).stdout;
    assert.match(missing,/Auth\s+Unavailable/);assert.doesNotMatch(missing,/Auth\s+None/);
    await assert.rejects(readFile(paths.access),/ENOENT/);
    await writeFile(paths.access,'{invalid private data}',{mode:0o600});
    const invalid=(await f.command(['status'])).stdout;
    assert.match(invalid,/Auth\s+Unavailable/);assert.doesNotMatch(invalid,/Auth\s+None/);
    await writeFile(paths.access,original,{mode:0o600});
  }finally{await f.cleanup();}
});

test('foreground startup shows the same connection guidance',{timeout:60000},async()=>{
  const f=await fixture();let foreground:ReturnType<typeof spawn>|undefined;
  try{
    await f.command(['init','--port',String(await freePort())]);
    foreground=spawn(process.execPath,[cli,'up','--foreground','-i',name],{cwd:f.cwd,env:f.env,stdio:['ignore','pipe','pipe']});
    let output='',error='';foreground.stdout!.on('data',data=>output+=String(data));foreground.stderr!.on('data',data=>error+=String(data));
    for(let attempt=0;attempt<150&&!output.includes('Connect an AI client')&&foreground.exitCode===null;attempt++)await new Promise(resolve=>setTimeout(resolve,100));
    assert.match(output,/Auth\s+None \(no token required\)/,error);
    assert.match(output,/Connect an AI client/);assert.match(output,/Streamable HTTP/);
    assert.match(output,/Ctrl\+C/);
    const exited=new Promise<void>(resolve=>foreground!.once('close',()=>resolve()));foreground.kill('SIGTERM');await exited;
    assert.match(output,/Stopped work space/);
  }finally{
    if(foreground&&foreground.exitCode===null&&foreground.signalCode===null){const exited=new Promise<void>(resolve=>foreground!.once('exit',()=>resolve()));foreground.kill('SIGTERM');await exited;}
    await f.cleanup();
  }
});

test('guidance commands work for an instance name starting with a dash and omit -i default for default instance',{timeout:60000},async()=>{
  const f=await fixture();
  const invoke=(args:string[])=>exec(process.execPath,[cli,...args],{cwd:f.cwd,env:f.env,timeout:45000});
  try{
    await invoke(['init','--port',String(await freePort())]);
    const defaultStatus=(await invoke(['status'])).stdout;
    assert.match(defaultStatus,/○ Starmux is stopped\n/);
    assert.doesNotMatch(defaultStatus,/-i default|mac-mcp-gateway/);
    assert.match(defaultStatus,/Start\s+starmux up\n/);
    await invoke(['rm','default']);

    await f.command(['init','--port',String(await freePort())]);
    await invoke(['config','rename','-i',name,'--','-work']);
    const stopped=(await invoke(['status','--instance=-work'])).stdout;
    const start=stopped.match(/Start\s+starmux (up) --instance='(-work)'/);
    assert.ok(start,stopped);
    const running=(await invoke([start[1]!,`--instance=${start[2]!}`])).stdout;
    assert.match(running,/Starmux is running  \(instance: -work\)/);
    assert.doesNotMatch(running,/mac-mcp-gateway/);
    const stop=running.match(/Stop\s+starmux (down) --instance='(-work)'/);
    assert.ok(stop,running);
    await invoke([stop[1]!,`--instance=${stop[2]!}`]);
    assert.equal(JSON.parse((await invoke(['status','--instance=-work','--json'])).stdout).phase,'stopped');
  }finally{await invoke(['down','--instance=-work']).catch(()=>{});await f.cleanup();}
});

async function freePort(){
  const server=createServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();assert.ok(address&&typeof address!=='string');
  await new Promise<void>(resolve=>server.close(()=>resolve()));return address.port;
}

