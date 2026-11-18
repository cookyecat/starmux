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

test('an owner can grant and revoke an upstream query while host shell remains blocked',{timeout:90000},async()=>{
  const home=await mkdtemp(path.join(await realpath(tmpdir()),'starmux-query-'));
  const cli=async(...args)=>JSON.parse((await promisify(execFile)(process.execPath,[path.resolve('bin/starmux.mjs'),...args,'--json'],
    {env:{...process.env,HOME:home,USERPROFILE:home},timeout:40000})).stdout);
  const client=new Client({name:'read-only-query-test',version:'1'});
  const definition={id:'reports',command:process.execPath,args:[path.resolve('tests/fixtures/report-query.mjs')],allowTools:['query','list_all']};
  const catalog=async()=>(await client.listTools()).tools.map(t=>t.name);
  const call=(name,args={})=>client.callTool({name,arguments:args});
  try{
    const probe=createServer();
    await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
    const port=probe.address().port;
    await new Promise(resolve=>probe.close(resolve));
    const status=await cli('up',home,'--read','--port',String(port));
    await client.connect(new StreamableHTTPClientTransport(new URL(status.localEndpoint)));
    assert.equal((await cli('server','add',JSON.stringify(definition))).application,'applied');
    assert.ok(!(await catalog()).includes('reports__query'));
    assert.equal((await call('reports__query',{status:'active'})).isError,true);
    assert.equal((await cli('server','add',JSON.stringify({...definition,allowToolsInReadOnly:['query']}),'--replace')).application,'applied');
    const names=await catalog();
    assert.ok(names.includes('reports__query'));
    for(const denied of ['reports__list_all','start_process','write_file'])assert.ok(!names.includes(denied));
    const query=await call('reports__query',{status:'active'});
    assert.ok(!query.isError);
    assert.deepEqual(JSON.parse(query.content[0].text),{count:7});
    for(const [name,args] of [['reports__list_all',{}],['start_process',{command:'echo shell-probe',timeout_ms:1000}]]){
      const denied=await call(name,args);
      assert.equal(denied.isError,true);
      assert.match(denied.content[0].text,/READ_ONLY_MODE/);
    }
    const middlewares=[
      {id:'alias',builtin:'catalog',match:{servers:['reports'],tools:['query']},options:{alias:'report_count'}},
      {id:'route',builtin:'route',match:{servers:['reports'],tools:['query']},options:{when:{status:'all'},target:{serverId:'reports',toolName:'list_all'}}}
    ];
    await cli('config','patch','--revision',(await cli('config','show')).revision,'--patch',JSON.stringify({middlewares}));
    await cli('config','apply');
    assert.ok((await catalog()).includes('report_count'));
    assert.ok(!(await call('report_count',{status:'active'})).isError);
    assert.equal((await call('report_count',{status:'all'})).isError,true);
    assert.equal((await cli('server','add',JSON.stringify({...definition,allowToolsInReadOnly:[]}),'--replace')).application,'applied');
    assert.ok(!(await catalog()).includes('report_count'));
    assert.equal((await call('report_count',{status:'active'})).isError,true);
  }finally{
    await client.close();
    try{await cli('down');}finally{await rm(home,{recursive:true,force:true});}
  }
});

test('committing an upstream catalog refresh preserves a concurrent read-only revocation',async()=>{
  const {ServerRegistry}=await import('../dist/src/server-registry.js');
  const definitions={version:1,upstreams:[{id:'reports',transport:'stdio',command:process.execPath,
    args:[path.resolve('tests/fixtures/report-query.mjs')],allowTools:['query','list_all'],allowToolsInReadOnly:['query','list_all']}]};
  const registry=new ServerRegistry(definitions);
  const original=registry.upstreams[0];
  try{
    await registry.connectAll();
    const refresh=await registry.prepare(definitions,'reports',undefined,true);
    registry.revokeReadOnlyTool('reports','query');
    refresh.commit();
    assert.notEqual(registry.upstreams[0],original);
    assert.equal(registry.status()[0].readOnlyAllowedToolCount,1);
    assert.deepEqual([...refresh.routes[0].allowToolsInReadOnly],['list_all']);
    const apply=await registry.prepare(definitions);
    apply.commit();
    assert.equal(registry.status()[0].readOnlyAllowedToolCount,2);
    assert.deepEqual([...refresh.routes[0].allowToolsInReadOnly],['list_all']);
  }finally{await Promise.all([original.close(),registry.close()]);}
});
