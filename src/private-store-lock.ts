import {mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {createPrivateDirectory} from './platform.js';
/** Cross-process writer lock. Stale locks fail closed rather than guessing ownership. */
export async function withPrivateLock<T>(file:string,action:()=>Promise<T>):Promise<T>{
  createPrivateDirectory(path.dirname(file));
  for(let i=0;i<100;i++){
    try{await mkdir(file,{mode:0o700});break;}catch(e){
      if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
      if(i===99)throw Error('INSTANCE_STORE_BUSY: retry; do not remove locks while an operation is running');
      await new Promise(r=>setTimeout(r,20));
    }
  }
  try{return await action();}finally{await rm(file,{recursive:true});}
}
