import {lstat,mkdir,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {createPrivateDirectory,ownedByUser} from './platform.js';

const ownerPattern=/^owner-([1-9][0-9]*)-([a-f0-9-]{36})$/;
const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT';
function alive(pid:number){
  try{process.kill(pid,0);return true;}
  catch(error){return (error as NodeJS.ErrnoException).code!=='ESRCH';}
}

async function recoverDeadOwner(file:string){
  try{
    const directory=await lstat(file);
    if(!directory.isDirectory()||directory.isSymbolicLink())throw Error('PRIVATE_LOCK_UNSAFE');
    const entries=await readdir(file);
    // Old releases used empty directories. Their owner cannot be established;
    // age alone never authorizes removing one, nor an incomplete/unknown record.
    if(entries.length!==1)return;
    const name=entries[0]!,match=ownerPattern.exec(name);
    if(!match)return;
    const pid=Number(match[1]);
    if(!Number.isSafeInteger(pid)||pid<2||alive(pid))return;
    if(!ownedByUser(file,directory,true))throw Error('PRIVATE_LOCK_UNSAFE');
    const record=path.join(file,name),stat=await lstat(record);
    if(!stat.isFile()||stat.nlink!==1||!ownedByUser(record,stat,true))throw Error('PRIVATE_LOCK_UNSAFE');
    const current=await lstat(file);
    if(current.dev!==directory.dev||current.ino!==directory.ino)return;
    // Elect one recoverer by atomically replacing the uniquely named record.
    // The directory never becomes empty: even a crash during recovery leaves
    // a complete PID record for the next attempt.
    const reaper=`owner-${process.pid}-${randomUUID()}`;
    await rename(record,path.join(file,reaper));
    const retired=file+'.retired-'+reaper;
    await rename(file,retired);
    await rm(retired,{recursive:true});
  }catch(error){if(!missing(error))throw error;}
}

/** Atomically publish a complete owner record; recover only a proven-dead PID. */
export async function withPrivateLock<T>(file:string,action:()=>Promise<T>,busyCode='INSTANCE_STORE_BUSY'):Promise<T>{
  createPrivateDirectory(path.dirname(file));
  const owner=`owner-${process.pid}-${randomUUID()}`;
  const candidate=file+'.candidate-'+owner;
  await mkdir(candidate,{mode:0o700});
  let acquired=false;
  try{
    await writeFile(path.join(candidate,owner),'',{flag:'wx',mode:0o600});
    for(let i=0;i<100;i++){
      // Do not replace a legacy empty directory. Current locks are nonempty
      // from the instant they become visible, so rename cannot overwrite them.
      const existing=await lstat(file).catch(error=>{if(missing(error))return null;throw error;});
      if(existing)await recoverDeadOwner(file);
      else try{await rename(candidate,file);acquired=true;break;}
      catch(error){
        if(!['EEXIST','ENOTEMPTY','EPERM','EACCES'].includes((error as NodeJS.ErrnoException).code??''))throw error;
        if(!await lstat(file).catch(e=>{if(missing(e))return null;throw e;}))throw error;
      }
      await new Promise(r=>setTimeout(r,20));
    }
    if(!acquired)throw Error(busyCode+': retry; lock ownership is live or unconfirmed');
    try{return await action();}
    finally{
      await lstat(path.join(file,owner));
      // Detach the complete lock before cleanup, avoiding an empty canonical
      // lock if the owner is killed during release.
      await rename(file,candidate);
    }
  }finally{
    await rm(candidate,{recursive:true,force:true});
  }
}
