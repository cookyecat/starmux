import { revocationsSchema } from "./config-schemas.js";
import { GatewayError,currentUid,errorCode,parseJSON,record } from "./validation.js";
// P0-C owner-local revocations: read afresh per request. This is NOT an IdP
// revocation service, token introspection, or a cross-UID security boundary.
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat,mkdir,open,rename,rmdir,unlink } from "node:fs/promises";
import path from "node:path";

const MAX_BYTES=65536,MAX_ITEMS=2048;
function fail(code: string): never{const err=new GatewayError(code);throw err;}
function validateFilename(file: unknown) {
  if(typeof file!=="string"||!path.isAbsolute(file)||path.basename(file)!=="remote-revocations.json")
    fail("REVOCATION_PATH_MUST_BE_ABSOLUTE_PRIVATE_FILE");
  return file;
}
async function validateDirectory(file: string) {
  let s;
  try{s=await lstat(path.dirname(file));}catch{fail("REVOCATION_PARENT_UNAVAILABLE");}
  if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==currentUid()||
     (s.mode&0o077)!==0)fail("REVOCATION_PARENT_UNSAFE");
}
function normalized(value: unknown) {
  const state=record(value,"REVOCATION_STATE_INVALID");
  if(!state||typeof state!=="object"||Array.isArray(state)||
     Object.keys(state).sort().join(",")!=="revokedJtis,revokedSubjects,version"||
     state.version!==1)fail("REVOCATION_STATE_INVALID");
  for(const key of ["revokedSubjects","revokedJtis"]){
    const entries=state[key];
    if(!Array.isArray(entries)||entries.length>MAX_ITEMS||
       entries.some(x=>typeof x!=="string"||x.length<1||x.length>512||
         x.trim()!==x)||new Set(entries).size!==entries.length)
      fail("REVOCATION_STATE_INVALID");
  }
  return revocationsSchema.parse(state);
}
export async function readRemoteRevocations(value: unknown) {
  const file=validateFilename(value);
  await validateDirectory(file);
  let handle;
  try{
    handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const stat=await handle.stat();
    if(!stat.isFile()||stat.uid!==currentUid()||stat.nlink!==1||
       (stat.mode&0o777)!==0o600||stat.size>MAX_BYTES)
      fail("REVOCATION_FILE_UNSAFE");
    const text=await handle.readFile("utf8");
    return normalized(parseJSON(text));
  }catch(err){
    if(errorCode(err)?.startsWith("REVOCATION_"))throw err;
    fail("REVOCATION_STATE_UNAVAILABLE");
  }finally{await handle?.close();}
}
export async function initializeRemoteRevocations(value: unknown) {
  const file=validateFilename(value);
  await validateDirectory(file);
  let handle;
  try{
    handle=await open(file,constants.O_WRONLY|constants.O_CREAT|
      constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    await handle.writeFile(JSON.stringify({version:1,revokedSubjects:[],revokedJtis:[]})+"\n");
    await handle.sync();
  }catch(err){
    if(errorCode(err)==="EEXIST")fail("REVOCATION_ALREADY_INITIALIZED");
    fail("REVOCATION_INITIALIZATION_FAILED");
  }finally{await handle?.close();}
  return {initialized:true};
}
export async function revokeRemoteIdentity(file: string,{subject,jti}: {subject?: string|undefined; jti?: string|undefined}={}) {
  if(Boolean(subject)===Boolean(jti))fail("REVOCATION_SINGLE_TARGET_REQUIRED");
  const key=subject?"revokedSubjects":"revokedJtis";
  const value=subject||jti;
  if(typeof value!=="string"||value.length<1||value.length>512||value.trim()!==value)
    fail("REVOCATION_TARGET_INVALID");
  file=validateFilename(file);
  // Exclusive same-UID writer lock prevents losing a revocation to concurrent
  // owner CLI invocations. A stale lock intentionally blocks edits; readers
  // continue honoring the last committed state until the owner repairs it.
  const lock=file+".lock";
  await validateDirectory(file);
  try{await mkdir(lock,{mode:0o700});}
  catch{fail("REVOCATION_OWNER_UPDATE_LOCKED");}
  let tmp;
  let handle;
  try {
    const current=await readRemoteRevocations(file);
    if(current[key].includes(value))return {changed:false,revoked:true};
    const next=normalized({...current,[key]:[...current[key],value]});
    const suffix=randomBytes(12).toString("hex");
    tmp=path.join(path.dirname(file),".remote-revocations-"+suffix+".tmp");
    handle=await open(tmp,constants.O_WRONLY|constants.O_CREAT|
      constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    await handle.writeFile(JSON.stringify(next)+"\n");
    await handle.sync();await handle.close();handle=null;
    await rename(tmp,file);
    return {changed:true,revoked:true};
  }finally{
    await handle?.close();
    if(tmp)await unlink(tmp).catch(()=>{});
    await rmdir(lock).catch(()=>{});
  }
}
export function isRemoteIdentityRevoked(state: ReturnType<typeof normalized>,payload: import("jose").JWTPayload) {
  return (typeof payload.sub==="string"&&state.revokedSubjects.includes(payload.sub))||
    (typeof payload.jti==="string"&&state.revokedJtis.includes(payload.jti));
}
