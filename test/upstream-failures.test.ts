import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ConfiguredStdioUpstream,bootstrapConfiguredUpstreams } from '../src/configured-mcp-upstreams.js';

test('optional startup failure is isolated; uncertain stdio call is not automatically retried',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'gateway-upstream-test-'));
  const config=join(dir,'upstreams.json');
  const marker=join(dir,'effects.txt');
  const definition={id:'optional',transport:'stdio',command:process.execPath,
    args:[fileURLToPath(new URL('./fixtures/uncertain-upstream.js',import.meta.url)),marker],allowTools:['write']};
  const upstream=new ConfiguredStdioUpstream(definition);
  try{
    await writeFile(config,JSON.stringify({version:1,upstreams:[{...definition,command:'/nonexistent/gateway-test'}]}),{mode:0o600});
    const unavailable=await bootstrapConfiguredUpstreams(config);
    assert.equal(unavailable.routes.length,0);assert.equal(unavailable.status()[0]?.status,'UNAVAILABLE');
    for(const child of unavailable.upstreams)await child.close();
    await upstream.connect();assert.equal(upstream.status.status,'READY');
    await assert.rejects(upstream.forwardWorkspaceInvocation({name:'write'}),/UPSTREAM_CALL_UNCERTAIN/);
    assert.equal(await readFile(marker,'utf8'),'executed\n');
    assert.equal(upstream.status.status,'UNAVAILABLE');
    assert.equal(upstream.status.lastError,'UPSTREAM_CALL_UNCERTAIN');
  }finally{await upstream.close();await rm(dir,{recursive:true,force:true});}
});
