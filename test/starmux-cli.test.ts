import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,realpath,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const cli=fileURLToPath(new URL('../src/cli/starmux.js',import.meta.url));
async function fixture(t:TestContext){
  const home=await realpath(await mkdtemp(path.join(tmpdir(),'starmux-cli-')));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const cwd=path.join(home,'project space');await mkdir(cwd);
  const env:NodeJS.ProcessEnv={...process.env,HOME:home,USERPROFILE:home};
  for(const key of Object.keys(env))if(key.startsWith('STARMUX_')||key.startsWith('MAC_MCP_'))delete env[key];
  return {home,cwd,env};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
function command(f:Fixture,args:string[],success=true){
  const result=spawnSync(process.execPath,[cli,...args],{cwd:f.cwd,env:f.env,encoding:'utf8',timeout:15000});
  assert.ifError(result.error);
  assert.equal(result.status,success?0:1,JSON.stringify({args,stdout:result.stdout,stderr:result.stderr}));
  return {stdout:result.stdout,stderr:result.stderr};
}

test('Starmux config schema works before initialization',async t=>{
  const f=await fixture(t);
  const schema=JSON.parse(command(f,['config','schema','--json']).stdout) as {$ref:string;definitions:{GatewayInstance:{properties:{schemaVersion:unknown;projectRoot:unknown}}}};
  assert.equal(schema.$ref,'#/definitions/GatewayInstance');
  assert.ok(schema.definitions.GatewayInstance.properties.schemaVersion);assert.ok(schema.definitions.GatewayInstance.properties.projectRoot);
  await assert.rejects(readFile(path.join(f.home,'.config','starmux','registry.json')),/ENOENT/);
});

test('Starmux alias help describes the command and rejects unknown topics',async t=>{
  const f=await fixture(t);
  for(const args of [['stop','--help'],['help','stop']])assert.match(command(f,args).stdout,/down \(alias: stop\)\n  Stop the selected instance\./);
  for(const args of [['help','typo'],['typo','--help']])assert.match(command(f,args,false).stderr,/Unknown command: typo/);
});

test('Starmux rejects incomplete or extra config arguments before mutating instances',async t=>{
  const f=await fixture(t);command(f,['init']);
  const registry=path.join(f.home,'.config','starmux','registry.json');const before=await readFile(registry,'utf8');
  for(const args of [
    ['config','default'],['config','default',''],['config','copy'],['config','rename'],
    ['config','archive','EXTRA'],['config','rename','new name','EXTRA'],['config','default','default','EXTRA'],
    ['config','archive','--file','unused'],['config','default','default','--name','ignored'],
    ['config','show','--output','ignored'],['config','secret','set','token','EXTRA'],
    ['config','archive','--instance='],
  ]){
    const result=command(f,[...args,'--json'],false);
    assert.match(JSON.parse(result.stdout).error,/Invalid arguments|not supported|non-empty/);
    assert.equal(await readFile(registry,'utf8'),before,args.join(' '));
  }
});

test('Starmux validates auth subcommand arguments without creating credentials',async t=>{
  const f=await fixture(t);command(f,['init']);
  for(const args of [
    ['auth','--expires','30d'],['auth','key','client','--issuer','https://ignored.example'],
    ['auth','oauth','status','EXTRA'],['auth','oauth','status','--issuer','https://ignored.example'],
    ['auth','oauth','init-keycloak','--client-id','ignored'],
    ['auth','oauth','setup','--subject','one','--subjects','two'],
  ])assert.match(command(f,args,false).stderr,/Invalid arguments|not supported|either --subject or --subjects/);
  assert.deepEqual(JSON.parse(command(f,['auth','--json']).stdout).credentials,[]);
});

test('Starmux config instance commands still accept names and global selectors',async t=>{
  const f=await fixture(t);command(f,['init']);
  command(f,['config','copy','work copy','-i','default']);
  command(f,['config','rename','work renamed','-i','work copy']);
  command(f,['config','default','work renamed']);
  command(f,['config','archive','-i','work renamed']);
  command(f,['config','restore','-i','work renamed']);
  command(f,['config','default','work renamed']);
  const list=JSON.parse(command(f,['ls','--json']).stdout) as {defaultInstanceId:string;instances:{name:string;instanceId:string;archived:boolean}[]};
  const selected=list.instances.find(i=>i.instanceId===list.defaultInstanceId);
  assert.equal(selected?.name,'work renamed');assert.equal(selected?.archived,false);assert.equal(list.instances.length,2);
});
