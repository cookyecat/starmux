import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,symlink,lstat,readlink,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {prepareBuildOutput} from '../scripts/build-output.mjs';

async function fixture(t){
  await mkdir('.internal',{recursive:true});
  const root=await mkdtemp(path.resolve('.internal/build-output-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  return root;
}
test('build output supports a fresh directory and removes stale compiled files',async t=>{
  const root=await fixture(t),dist=prepareBuildOutput(root);
  await mkdir(path.join(dist,'old'),{recursive:true});
  await writeFile(path.join(dist,'old/removed-source.js'),'stale');
  prepareBuildOutput(root);
  assert.deepEqual(await readdir(dist),[]);
  await writeFile(path.join(dist,'new.js'),'compiled');
  assert.equal(await readFile(path.join(dist,'new.js'),'utf8'),'compiled');
});
test('build preserves internal dist links, recreates missing targets, and leaves sibling artifacts alone',async t=>{
  for(const missing of [false,true])await t.test(missing?'missing target':'existing target',async t=>{
    const root=await fixture(t),target=path.join(root,'.internal/build/dist'),dist=path.join(root,'dist');
    await mkdir(path.dirname(target),{recursive:true});
    await writeFile(path.join(root,'.internal/keep.txt'),'keep');
    if(!missing){await mkdir(target);await writeFile(path.join(target,'stale.js'),'stale');}
    const link=process.platform==='win32'?target:path.relative(root,target);
    await symlink(link,dist,process.platform==='win32'?'junction':'dir');
    const before=await readlink(dist);
    prepareBuildOutput(root);
    assert.ok((await lstat(dist)).isSymbolicLink());assert.equal(await readlink(dist),before);
    assert.deepEqual(await readdir(target),[]);
    await writeFile(path.join(dist,'compiled.js'),'new');
    assert.equal(await readFile(path.join(target,'compiled.js'),'utf8'),'new');
    assert.equal(await readFile(path.join(root,'.internal/keep.txt'),'utf8'),'keep');
  });
});
test('build refuses links to source directories or the entire internal directory before deleting files',async t=>{
  for(const name of ['src','.internal'])await t.test(name,async t=>{
    const root=await fixture(t),target=path.join(root,name);
    await mkdir(target);await writeFile(path.join(target,'keep.txt'),'keep');
    await symlink(process.platform==='win32'?target:name,path.join(root,'dist'),process.platform==='win32'?'junction':'dir');
    assert.throws(()=>prepareBuildOutput(root),/BUILD_DIST_LINK_MUST_TARGET_INTERNAL_SUBDIRECTORY/);
    assert.equal(await readFile(path.join(target,'keep.txt'),'utf8'),'keep');
  });
});
