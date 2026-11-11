import {lstatSync,mkdirSync,readdirSync,readlinkSync,realpathSync,rmSync} from 'node:fs';
import path from 'node:path';

// Keep the public dist path stable while allowing build artifacts in .internal.
export function prepareBuildOutput(root){
  const dist=path.join(root,'dist');
  let entry;
  try{entry=lstatSync(dist);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(entry?.isSymbolicLink()){
    const target=path.resolve(root,readlinkSync(dist));
    const internal=path.join(root,'.internal');
    const inside=(base,value)=>{
      const relative=path.relative(base,value);
      return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);
    };
    // Never recursively clean the project, .internal itself, or a source tree
    // if someone accidentally repoints dist. Check existing parent symlinks too.
    if(!inside(internal,target))throw Error('BUILD_DIST_LINK_MUST_TARGET_INTERNAL_SUBDIRECTORY');
    mkdirSync(target,{recursive:true});
    const resolved=realpathSync(target);
    if(!inside(realpathSync(internal),resolved))throw Error('BUILD_DIST_LINK_MUST_TARGET_INTERNAL_SUBDIRECTORY');
    for(const name of readdirSync(resolved))rmSync(path.join(resolved,name),{recursive:true,force:true});
  }else{
    if(entry&&!entry.isDirectory())throw Error('BUILD_DIST_MUST_BE_DIRECTORY');
    rmSync(dist,{recursive:true,force:true});
    mkdirSync(dist,{recursive:true});
  }
  return dist;
}
