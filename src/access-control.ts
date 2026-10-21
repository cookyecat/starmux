import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {lstat,readFile,writeFile,rename,rm,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import {createPrivateDirectory,ownedByUser} from './platform.js';
import type {RequestContext} from './contracts.js';

const credential=z.object({id:z.string().regex(/^[a-f0-9]{24}$/),name:z.string().trim().min(1).max(80).regex(/^[^\x00-\x1f\x7f]+$/),
  digest:z.string().regex(/^[a-f0-9]{64}$/),createdAt:z.string().datetime(),expiresAt:z.string().datetime().nullable(),
  revokedAt:z.string().datetime().nullable(),lastUsedAt:z.string().datetime().nullable(),permission:z.literal('owner-default')}).strict();
const schema=z.object({version:z.literal(1),mode:z.enum(['ingress','api-key']),credentials:z.array(credential).max(256)}).strict();
type State=z.infer<typeof schema>;
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const equal=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export const defaultAccessFile=()=>process.env.MAC_MCP_ACCESS_FILE||path.join(homedir(),'.config','mac-mcp-gateway','access-v1.json');
const active=(c:Pick<z.infer<typeof credential>,'revokedAt'|'expiresAt'>)=>!c.revokedAt&&(!c.expiresAt||Date.parse(c.expiresAt)>Date.now());
export async function createAccessControl(file=defaultAccessFile()){
  if(!path.isAbsolute(file))throw Error('ACCESS_FILE_ABSOLUTE_REQUIRED');
  const folder=path.dirname(file);createPrivateDirectory(folder);
  async function readPrivate(target:string){
    const st=await lstat(target);
    if(!st.isFile()||st.nlink!==1||!ownedByUser(target,st,true)||st.size>262144)throw Error('ACCESS_FILE_UNSAFE');
    return readFile(target,'utf8');
  }
  async function save(data:State){
    schema.parse(data);
    const temp=file+'.'+randomBytes(12).toString('hex');
    try{await writeFile(temp,JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});await rename(temp,file);}
    finally{await rm(temp,{force:true});}
  }
  // A filesystem lock serializes mutations across CLI and Core processes.
  async function locked<T>(action:()=>Promise<T>):Promise<T>{
    const lock=file+'.lock';let acquired=false;
    for(let i=0;i<100;i++){
      try{await mkdir(lock,{mode:0o700});acquired=true;break;}
      catch(e){if(!(e instanceof Error&&'code' in e&&e.code==='EEXIST'))throw e;await new Promise(r=>setTimeout(r,20));}
    }
    if(!acquired)throw Error('ACCESS_STORE_BUSY');
    try{return await action();}finally{await rm(lock,{recursive:true,force:true});}
  }
  async function load(){
    if(!ownedByUser(folder,await lstat(folder),true))throw Error('ACCESS_DIRECTORY_UNSAFE');
    return schema.parse(JSON.parse(await readPrivate(file)) as unknown);
  }
  await locked(async()=>{
    try{await load();}catch(e){
      if(!(e instanceof Error&&'code' in e&&e.code==='ENOENT'))throw e;
      // A persistent marker prevents a deleted store from silently resetting
      // enabled authentication to ingress mode after a CLI call or restart.
      try{await lstat(file+'.initialized');throw Error('ACCESS_STORE_MISSING');}
      catch(markerError){
        if(!(markerError instanceof Error&&'code' in markerError&&markerError.code==='ENOENT'))throw markerError;
      }
      await writeFile(file+'.initialized','1\n',{flag:'wx',mode:0o600});
      await save({version:1,mode:'ingress',credentials:[]});
    }
  });
  const ownerFile=file+'.owner-token';
  async function ownerToken(){
    return locked(async()=>{
      try{return (await readPrivate(ownerFile)).trim();}catch(e){
        if(!(e instanceof Error&&'code' in e&&e.code==='ENOENT'))throw e;
        const token=randomBytes(32).toString('hex');
        await writeFile(ownerFile,token+'\n',{flag:'wx',mode:0o600});return token;
      }
    });
  }
  async function authorized(token:unknown){
    if(typeof token!=='string'||! /^[a-f0-9]{64}$/.test(token))return false;
    try{return equal(token,(await readPrivate(ownerFile)).trim());}catch{return false;}
  }
  async function snapshot(){
    const data=await load();return {mode:data.mode,permission:'owner-default' as const,
      credentials:data.credentials.map(({digest:_,...c})=>({...c,status:c.revokedAt?'revoked':active(c)?'active':'expired'}))};
  }
  async function create(name:string,expiresAt:string|null=null){
    const secret='mgw_'+randomBytes(32).toString('base64url');
    const c=credential.parse({id:randomBytes(12).toString('hex'),name,digest:digest(secret),createdAt:new Date().toISOString(),
      expiresAt,revokedAt:null,lastUsedAt:null,permission:'owner-default'});
    if(!active(c))throw Error('ACCESS_EXPIRY_MUST_BE_FUTURE');
    await locked(async()=>{const data=await load();data.credentials.push(c);await save(data);});
    return {id:c.id,name:c.name,key:secret,permission:c.permission};
  }
  async function setMode(mode:'ingress'|'api-key'){
    await locked(async()=>{const data=await load();
      if(mode==='api-key'&&!data.credentials.some(active))throw Error('ACCESS_ACTIVE_KEY_REQUIRED');
      data.mode=mode;await save(data);});
  }
  async function revoke(id:string){
    await locked(async()=>{const data=await load();const c=data.credentials.find(c=>c.id===id);
      if(!c)throw Error('ACCESS_CREDENTIAL_NOT_FOUND');c.revokedAt??=new Date().toISOString();await save(data);});
  }
  async function authenticate(header:string|undefined):Promise<RequestContext['identity']>{
    const data=await load();
    if(data.mode==='ingress')return {kind:'unverified-local'};
    if(!header||!/^Bearer mgw_[A-Za-z0-9_-]{43}$/i.test(header))throw Error('ACCESS_UNAUTHORIZED');
    const hash=digest(header.slice(7));const c=data.credentials.find(c=>equal(c.digest,hash)&&active(c));
    if(!c)throw Error('ACCESS_UNAUTHORIZED');
    // Recheck under the mutation lock: revocation cannot be lost to a usage update.
    await locked(async()=>{const current=await load();const found=current.credentials.find(v=>v.id===c.id);
      if(current.mode!=='api-key'||!found||!active(found))throw Error('ACCESS_UNAUTHORIZED');
      found.lastUsedAt=new Date().toISOString();await save(current);});
    return {kind:'verified-api-key',credentialId:c.id,permission:'owner-default'};
  }
  return {file,snapshot,create,setMode,revoke,authenticate,ownerToken,authorized};
}
export type AccessControl=Awaited<ReturnType<typeof createAccessControl>>;
