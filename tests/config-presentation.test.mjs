import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {configTemplate,configWarnings,createInstance,instanceConfigSchema,loadInstanceConfig,parseConfig,patchInstanceConfig,saveInstanceConfig,validateConfig} from '../dist/src/instance-store.js';

async function fixture(t){
  await mkdir('.internal',{recursive:true});
  const home=await mkdtemp(path.resolve('.internal/config-presentation-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const projectRoot=path.join(home,'project');await mkdir(projectRoot);
  return {home,config:instanceConfigSchema.parse({schemaVersion:1,projectRoot,port:18893})};
}

test('ordinary templates omit compatibility fields while retaining equivalent runtime defaults',async t=>{
  const {config}=await fixture(t);
  for(const values of [{},{mode:'read-write',accessRole:'trusted'}]){
    const original={...config,...values},text=configTemplate(original);
    assert.doesNotMatch(text,/gitMode|worktreeMode/);
    assert.deepEqual(parseConfig(text),original);
    assert.deepEqual(configWarnings(original,text),[]);
  }
});

test('explicit inactive values receive mode-accurate notices without becoming invalid',async t=>{
  const {config}=await fixture(t);
  for(const mode of ['read-only','read-write']){
    const configured={...config,mode,accessRole:mode==='read-only'?'restricted':'trusted',gitMode:'review',worktreeMode:'linked'};
    assert.deepEqual(await validateConfig(configured),configured);
    const warnings=configWarnings(configured,JSON.stringify(configured));
    assert.deepEqual(warnings.map(w=>w.field),['gitMode','worktreeMode']);
    assert.match(warnings[0].message,mode==='read-only'?/blocks shell execution/:/Git remains available through the terminal/);
    assert.match(warnings[1].message,/does not restrict access/);
    assert.match(configTemplate(configured),/"gitMode": "review"/);
  }
  const explicitOff=JSON.stringify({...config,mode:'read-write',accessRole:'trusted'});
  assert.equal(configWarnings(parseConfig(explicitOff),explicitOff).length,2,'explicit off must not imply a Git or directory restriction');
  const onlyGit=JSON.stringify({schemaVersion:1,projectRoot:config.projectRoot,port:18893,gitMode:'review'});
  assert.deepEqual(configWarnings(parseConfig(onlyGit),onlyGit).map(w=>w.field),['gitMode']);
});

test('workspace-scoped compatibility options remain available and are not reported as ignored',async t=>{
  const {config}=await fixture(t);
  const custom={...config,mode:'read-write',accessRole:'restricted',gitMode:'review',worktreeMode:'linked'};
  await validateConfig(custom);
  assert.deepEqual(configWarnings(custom,JSON.stringify(custom)),[]);
  assert.deepEqual(parseConfig(configTemplate(custom)),custom);
  const disabled={...custom,gitMode:'off',worktreeMode:'off'};
  assert.match(configTemplate(disabled),/"gitMode": "off"/);
});

test('legacy JSONC values and comments survive managed/linked import, patch, save and copy',async t=>{
  const {home,config}=await fixture(t);
  const text='// retained legacy note\n'+JSON.stringify({...config,gitMode:'review',worktreeMode:'linked'},null,2);
  const file=path.join(home,'legacy.jsonc');await writeFile(file,text,{mode:0o600});
  for(const link of [false,true]){
    const instance=await createInstance(link?'linked':'managed',{file,link},home);
    let loaded=await loadInstanceConfig(instance);
    assert.equal(loaded.warnings.length,2);assert.match(loaded.text,/retained legacy note/);
    loaded=await patchInstanceConfig(instance,{port:18895},loaded.revision,home);
    loaded=await saveInstanceConfig(instance,loaded.text+'\n// edited\n',loaded.revision,home);
    assert.equal(loaded.config.gitMode,'review');assert.equal(loaded.config.worktreeMode,'linked');
    assert.match(await readFile(instance.source.path,'utf8'),/retained legacy note/);
    const copy=await createInstance('copy-'+link,{config:loaded.config},home);
    assert.equal((await loadInstanceConfig(copy)).warnings.length,2);
  }
});
