import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {createInstance,resolveInstance,changeRegistry,instanceConfigSchema} from '../dist/src/instance-store.js';

test('instance selection explains directory mistakes without selecting or changing an instance',async t=>{
 await mkdir('.internal',{recursive:true});
 const home=await mkdtemp(path.resolve('.internal/instance-selection-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const instance=await createInstance('local smoke',{config:instanceConfigSchema.parse({schemaVersion:1,projectRoot:home,port:18894})},home);
 assert.equal((await resolveInstance(instance.id,home)).id,instance.id);
 assert.equal((await resolveInstance(instance.name,home)).id,instance.id);
 await assert.rejects(resolveInstance(home,home),error=>{
  assert.match(error.message,/^INSTANCE_NOT_FOUND:/);assert.match(error.message,/not a project directory/);
  assert.match(error.message,/starmux ls/);assert.ok(error.message.includes('"local smoke"'));
  assert.ok(error.message.includes('starmux status -i '+instance.id));return true;
 });
 await assert.rejects(resolveInstance('missing',home),/starmux ls/);
 assert.equal((await resolveInstance(undefined,home)).id,instance.id);
 await changeRegistry(registry=>{registry.instances[0].archived=true;},home);
 await assert.rejects(resolveInstance(instance.name,home),/starmux ls --archived/);
 assert.equal((await resolveInstance(instance.id,home,true)).id,instance.id);
});
