import {open,rename,rm,type FileHandle} from 'node:fs/promises';
import {Writable} from 'node:stream';
import {trustedFileStat} from './instance-store.js';

export const PROCESS_LOG_BYTES=8*1024*1024;
const BACKUPS=3;
const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT';
async function inspect(file:string){
  return trustedFileStat(file,true,Infinity).catch(error=>{if(missing(error))return null;throw error;});
}
async function openChecked(file:string){
  const previous=await inspect(file);
  const handle=await open(file,'a+',0o600);
  try{
    const current=await trustedFileStat(file,true,Infinity),actual=await handle.stat();
    if(current.dev!==actual.dev||current.ino!==actual.ino||
       (previous&&(previous.dev!==actual.dev||previous.ino!==actual.ino)))throw Error('LOG_CHANGED');
    return handle;
  }catch(error){await handle.close();throw error;}
}

/** Bound old logs without loading them whole; also used by the CLI log reader. */
export async function readProcessLogTail(file:string,maxBytes=PROCESS_LOG_BYTES){
  await trustedFileStat(file,true,Infinity);
  const handle=await open(file,'r');
  try{
    const current=await trustedFileStat(file,true,Infinity),actual=await handle.stat();
    if(current.dev!==actual.dev||current.ino!==actual.ino)throw Error('LOG_CHANGED');
    const start=Math.max(0,actual.size-maxBytes),buffer=Buffer.alloc(actual.size-start);
    const {bytesRead}=await handle.read(buffer,0,buffer.length,start);
    const text=buffer.subarray(0,bytesRead).toString('utf8');
    return {text:start>0?text.slice(text.indexOf('\n')+1):text,bytes:buffer.subarray(0,bytesRead),
      offset:actual.size,identity:`${actual.dev}:${actual.ino}`};
  }finally{await handle.close();}
}

/** One serialized writer for both child streams; three bounded private backups. */
export async function createProcessLog(file:string,maxBytes=PROCESS_LOG_BYTES):Promise<Writable>{
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw Error('INVALID_LOG_LIMIT');
  let handle:FileHandle|null=await openChecked(file);
  let size=(await handle.stat()).size;
  try{
    // Older releases appended without a bound. Keep their most recent output
    // instead of refusing startup once the old log exceeds the former 32 MiB cap.
    if(size>maxBytes){
      const tail=await readProcessLogTail(file,maxBytes);
      await handle.truncate(0);await handle.writeFile(tail.bytes);size=tail.bytes.length;
    }
  }catch(error){await handle.close();throw error;}
  async function rotate(){
    await handle!.close();handle=null;
    // Validate every existing target before any rename or deletion.
    for(let i=0;i<=BACKUPS;i++)await inspect(i?file+'.'+i:file);
    await rm(file+'.'+BACKUPS,{force:true});
    for(let i=BACKUPS-1;i>=0;i--){
      const source=i?file+'.'+i:file;
      try{await rename(source,file+'.'+(i+1));}catch(error){if(!missing(error))throw error;}
    }
    handle=await openChecked(file);size=0;
  }
  async function append(chunk:Buffer){
    for(let offset=0;offset<chunk.length;){
      if(size>=maxBytes)await rotate();
      const length=Math.min(maxBytes-size,chunk.length-offset);
      await handle!.writeFile(chunk.subarray(offset,offset+length));
      offset+=length;size+=length;
    }
  }
  return new Writable({
    write(chunk:Buffer,_encoding,callback){void append(chunk).then(()=>callback(),callback);},
    destroy(error,callback){
      const current=handle;handle=null;
      void (current?.close()??Promise.resolve()).then(()=>callback(error),callback);
    }
  });
}
