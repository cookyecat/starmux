import {createHash} from 'node:crypto';
import {readFile,readdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {packageRoot} from './runtime-paths.js';
import {parseJSON,record} from './validation.js';

// Identify emitted code, not the version of a different legacy installation.
export async function runtimeIdentity(){
  const root=await realpath(packageRoot);
  const pkg=record(parseJSON(await readFile(path.join(root,'package.json'),'utf8')));
  if(typeof pkg.version!=='string')throw Error('INVALID_PACKAGE_VERSION');
  const hash=createHash('sha256');
  async function visit(directory:string){
    for(const item of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
      const file=path.join(directory,item.name);
      if(item.isDirectory())await visit(file);
      else if(item.isFile()&&item.name.endsWith('.js')){
        hash.update(path.relative(root,file)).update('\0').update(await readFile(file)).update('\0');
      }
    }
  }
  await visit(path.join(root,'dist','src'));
  hash.update(await readFile(path.join(root,'package.json')));
  return {coreProgram:path.join(root,'dist','src','dc-workspace-http.js'),
    buildVersion:`${pkg.version} (sha256:${hash.digest('hex').slice(0,16)})`};
}
