import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {previewServerImport,commandWords} from '../dist/src/server-import.js';
import {ServerManagement} from '../dist/src/server-management.js';
import {createInstance,instanceConfigSchema,saveInstanceConfig,loadInstanceConfig,instancePaths,readTrusted} from '../dist/src/instance-store.js';

test('command parser preserves quoted arguments without shell expansion',()=>{
 assert.deepEqual(commandWords('node "a b.mjs" \'literal $HOME\' ""'),['node','a b.mjs','literal $HOME','']);
 for(const text of ['node a | sh','node a; echo x','node $(pwd)','node a\nsh','node "unfinished'])assert.throws(()=>commandWords(text),/SERVER_/);
 assert.deepEqual(commandWords('"C:\\Program Files\\node.exe" x'),['C:\\Program Files\\node.exe','x']);
});
test('preview redacts credentials, resolves source-relative paths, and rejects unknown fields',async()=>{
 const base=path.resolve('.internal');
 const r=await previewServerImport(JSON.stringify({mcpServers:{local:{command:'node',args:['./server.mjs'],env:{API_KEY:'private'}},remote:{url:'https://example.invalid/mcp',headers:{Authorization:'Bearer private','X-Region':'local'}}}}),{base});
 assert.equal(r.servers[0].args[0],path.join(base,'server.mjs'));
 assert.equal(r.servers[0].cwd,base);assert.equal(JSON.stringify(r.servers).includes('private'),false);
 assert.equal(r.servers[1].headers['X-Region'],'local');assert.equal(Object.keys(r.secrets).length,2);
 await assert.rejects(previewServerImport('{"command":"node","unsupported":true}',{base}),/UNKNOWN_FIELDS/);
 await assert.rejects(previewServerImport('https://user:password@example.invalid/mcp',{base}),/INVALID/);
});
test('preview never starts a command; tested merge preserves old configuration and secrets',async()=>{
 const home=await mkdtemp(path.resolve('.internal/import-test-'));
 try{
  const instance=await createInstance('import',{config:instanceConfigSchema.parse({schemaVersion:1,projectRoot:home,port:23101})},home);
  const manager=new ServerManagement(home);const file=path.resolve('tests/fixtures/optional-upstream.mjs');
  const preview=await manager.preview(instance,JSON.stringify({id:'sample',command:process.execPath,args:[file,'healthy',path.join(home,'child.pid')],env:{FIXTURE_MODE:'normal'}}));
  await assert.rejects(manager.savePreview(instance,preview.previewId,preview.revision),/TEST_REQUIRED/);
  const tested=await manager.test(instance,{previewId:preview.previewId});assert.equal(tested.results[0].status,'READY');
  await manager.savePreview(instance,preview.previewId,preview.revision);
  const loaded=await loadInstanceConfig(instance);assert.equal(loaded.config.upstreams.length,1);assert.ok(loaded.config.upstreams[0].allowTools.length);
  assert.equal(loaded.text.includes('"normal"'),false);
  assert.ok((await readTrusted(path.join(instancePaths(instance,home).state,'secrets.json'))).includes('normal'));
  await assert.rejects(manager.action(instance,'sample','disable',preview.revision),/CONFLICT/);
  await manager.action(instance,'sample','disable',loaded.revision);assert.equal((await loadInstanceConfig(instance)).config.upstreams[0].enabled,false);
  const current=await loadInstanceConfig(instance);await saveInstanceConfig(instance,current.text.replace('"id": "sample"','// existing nested note\n      "id": "sample"'),current.revision,home);
  const next=await manager.preview(instance,JSON.stringify({id:'second',command:process.execPath,args:[file,'healthy',path.join(home,'child2.pid')],allowTools:[]}));
  const checked=await manager.test(instance,{previewId:next.previewId});assert.equal(checked.results[0].allowed,0);
  await manager.savePreview(instance,next.previewId,next.revision);assert.match((await loadInstanceConfig(instance)).text,/existing nested note/);

 }finally{await rm(home,{recursive:true,force:true});}
});
