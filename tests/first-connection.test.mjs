import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

test('first up skips an occupied default port and distinguishes self-check from a target client read',{timeout:90000},async()=>{
  const home=await mkdtemp(path.join(await realpath(tmpdir()),'starmux-first-connect-'));
  const cli=async(...args)=>JSON.parse((await promisify(execFile)(process.execPath,[path.resolve('bin/starmux.mjs'),...args,'--json'],
    {env:{...process.env,HOME:home,USERPROFILE:home},timeout:40000})).stdout);
  const blocker=createServer(socket=>socket.destroy());
  const client=new Client({name:'target-test-client',version:'1'});
  try{
    await new Promise((resolve,reject)=>{
      blocker.once('error',e=>e.code==='EADDRINUSE'?resolve():reject(e));
      blocker.listen(18893,'127.0.0.1',resolve);
    });
    const status=await cli('up',home);
    assert.ok(status.port>18893&&status.port<=19892);
    assert.equal(status.localEndpoint,'http://127.0.0.1:'+status.port+'/mcp');
    assert.equal(status.verification.localVerifiedAt,null);
    const consoleUrl=new URL((await cli('dashboard','--no-open')).url);
    const headers={authorization:'Bearer '+new URLSearchParams(consoleUrl.hash.slice(1)).get('token')};
    const consoleStatus=async()=>{
      const response=await fetch(consoleUrl.origin+'/api/v1/instances',{headers});
      assert.equal(response.status,200);
      return (await response.json()).instances.find(i=>i.instanceId===status.instanceId);
    };
    const connections=await fetch(consoleUrl.origin+'/api/v1/instances/'+status.instanceId+'/access',{headers});
    assert.ok((await connections.json()).urls.includes(status.localEndpoint));
    const local=await cli('verify');
    assert.ok(local.verification.localVerifiedAt);
    assert.equal(local.targetClientVerified,false);
    assert.deepEqual((await consoleStatus()).verification,local.verification);
    await client.connect(new StreamableHTTPClientTransport(new URL(status.localEndpoint)));
    const catalog=await client.listTools();
    assert.ok(catalog.tools.find(t=>t.name==='get_file_info').inputSchema.properties.starmuxCheck);
    const read=args=>client.callTool({name:'get_file_info',arguments:{path:home,...args}});
    assert.ok(!(await read({})).isError);
    assert.ok((await read({starmuxCheck:'old-code'})).isError);
    assert.ok((await read({starmuxCheck:status.verification.code,path:path.join(home,'missing')})).isError);
    assert.equal((await cli('status')).verification.targetVerifiedAt,null);
    assert.ok(!(await read({starmuxCheck:status.verification.code})).isError);
    const confirmed=(await cli('status')).verification;
    assert.ok(confirmed.targetVerifiedAt);
    assert.deepEqual((await consoleStatus()).verification,confirmed);
    assert.equal((await cli('verify')).verification.targetVerifiedAt,confirmed.targetVerifiedAt);
  }finally{
    await client.close();
    try{await cli('dashboard','stop');await cli('down');}finally{
      if(blocker.listening)await new Promise(resolve=>blocker.close(resolve));
      await rm(home,{recursive:true,force:true});
    }
  }
});
