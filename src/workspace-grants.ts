import { grantsSchema } from "./config-schemas.js";
import type { AuditSink,GrantsConfig } from "./contracts.js";
import { GatewayError,currentUid,errorCode,parseJSON,record } from "./validation.js";
// Owner-managed multi-root grants. Separate from MCP tool authorization;
// a remotely controlled tool cannot modify this file or learn the admin secret.
import { randomBytes,timingSafeEqual } from "node:crypto";
import { lstat,mkdir,readFile,realpath,rename,rm,writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function deny(s: string): never {const e=new GatewayError(s);throw e;};
export const defaultGrantsPath=(home=os.homedir())=>
  path.join(home,".config","mac-mcp-gateway","workspace-grants-v1.json");
const expected=new Set(["version","homeRead","outsideRead","custom"]);
export const isInside=(p: string,r: string)=>p===r||p.startsWith(r+path.sep);
async function safeStat(file: string,{directory=false,missing=false}={}){
  const st=await lstat(file).catch(e=>errorCode(e)==="ENOENT"&&missing?null:Promise.reject(e));
  if(!st)return null;
  if(st.isSymbolicLink()||(directory?!st.isDirectory():!st.isFile())||
    st.uid!==currentUid()||(!directory&&st.nlink!==1)||
    (st.mode&0o077)!==0)deny("GRANTS_UNSAFE_OWNERSHIP");
  return st;
}
async function privateFolder(folder: string){
  await mkdir(folder,{recursive:true,mode:0o700});
  await safeStat(folder,{directory:true});
}
async function writePrivate(file: string,body: string){
  const temp=path.join(path.dirname(file),"."+path.basename(file)+"."+randomBytes(8).toString("hex"));
  try{
    await writeFile(temp,body,{flag:"wx",mode:0o600});
    await rename(temp,file);
  }finally{await rm(temp,{force:true});}
}
async function checkCustom(raw: unknown,home: string){
  if(typeof raw!=="string"||!path.isAbsolute(raw)||raw.length>1024||
    raw.includes("\0")||raw.split(path.sep).includes(".."))deny("GRANT_PATH_INVALID");
  const canon=await realpath(raw);
  const st=await lstat(canon);
  if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==currentUid())
    deny("GRANT_ROOT_UNSAFE");
  if(canon==="/"||canon===home||canon==="/Users"||canon==="/Volumes")
    deny("GRANT_ROOT_TOO_BROAD");
  const sensitive=new Set([".ssh",".aws",".gnupg",".config","keychains",
    "secrets","credentials"]);
  if(canon.split(path.sep).some(part=>sensitive.has(part.toLowerCase())))
    deny("GRANT_SENSITIVE_ROOT_DENIED");
  return canon;
}
function validate(value: unknown): GrantsConfig {
  const data=record(value,"GRANTS_CONFIG_INVALID");
  if(!data||typeof data!=="object"||Array.isArray(data)||
    Object.keys(data).length!==expected.size||
    Object.keys(data).some(k=>!expected.has(k))||data.version!==1||
    typeof data.homeRead!=="boolean"||typeof data.outsideRead!=="boolean"||
    !Array.isArray(data.custom)||data.custom.length>12)
    deny("GRANTS_CONFIG_INVALID");
  const seen=new Set();
  for(const value of data.custom){
    const item=record(value,"GRANTS_CUSTOM_INVALID");
    if(!item||typeof item.path!=="string"||!path.isAbsolute(item.path)||
      item.path.length>1024||!["read-only","read-write"].includes(String(item.mode))||
      Object.keys(item).sort().join()!=="mode,path"||seen.has(item.path))
      deny("GRANTS_CUSTOM_INVALID");
    seen.add(item.path);
  }
  return grantsSchema.parse(data);
}
const defaults=(): GrantsConfig=>({version:1,homeRead:false,outsideRead:false,custom:[]});
export async function createWorkspaceGrants({file=defaultGrantsPath(),home=os.homedir(),audit=()=>{}}: {file?: string; home?: string; audit?: AuditSink}={}){
  if(typeof file!=="string"||!path.isAbsolute(file)||path.basename(file).length>160)
    deny("GRANTS_FILE_ABSOLUTE_REQUIRED");
  const canonicalHome=await realpath(home);
  await privateFolder(path.dirname(file));
  const existing=await safeStat(file,{missing:true});
  if(!existing)await writePrivate(file,JSON.stringify(defaults(),null,2)+"\n");
  const tokenFile=file+".owner-token";
  if(!await safeStat(tokenFile,{missing:true}))
    await writePrivate(tokenFile,randomBytes(32).toString("hex")+"\n");
  let queue: Promise<unknown>=Promise.resolve();
  async function snapshot({validatePaths=true}={}){
    const st=await safeStat(file);
    if(st!.size>16384)deny("GRANTS_CONFIG_TOO_LARGE");
    const config=validate(parseJSON(await readFile(file,"utf8")));
    if(validatePaths)for(const item of config.custom){
      const canon=await checkCustom(item.path,canonicalHome);
      if(canon!==item.path)deny("GRANTS_ROOT_CHANGED");
    }
    return config;
  }
  async function authorized(token: unknown){
    const st=await safeStat(tokenFile);
    if(st!.size>256||typeof token!=="string"||!/^[a-f0-9]{64}$/.test(token))
      return false;
    const actual=(await readFile(tokenFile,"utf8")).trim();
    if(!/^[a-f0-9]{64}$/.test(actual))deny("GRANTS_TOKEN_INVALID");
    return timingSafeEqual(Buffer.from(token),Buffer.from(actual));
  }
  async function update(op: string,{target,mode}: {target?: unknown; mode?: unknown}={}){
    const step=async()=>{
      const data=await snapshot({validatePaths:false});
      if(op==="home-enable")data.homeRead=true;
      else if(op==="home-disable")data.homeRead=false;
      else if(op==="outside-enable")data.outsideRead=true;
      else if(op==="outside-disable")data.outsideRead=false;
      else if(["add","revoke"].includes(op)){
        // Revocation must work even when an external drive has been unplugged.
        const canonical=op==="revoke"?target:
          await checkCustom(target,canonicalHome);
        if(typeof canonical!=="string"||!path.isAbsolute(canonical)||
           path.normalize(canonical)!==canonical)deny("GRANT_PATH_INVALID");
        const index=data.custom.findIndex(x=>x.path===canonical);
        if(op==="revoke"){
          if(index<0)deny("GRANT_NOT_FOUND");
          data.custom.splice(index,1);
        }else{
          if(mode!=="read-only"&&mode!=="read-write")deny("GRANT_MODE_INVALID");
          if(index<0)data.custom.push({path:canonical,mode});
          else data.custom[index]!.mode=mode;
        }
      }else deny("GRANT_OPERATION_INVALID");
      validate(data);
      await writePrivate(file,JSON.stringify(data,null,2)+"\n");
      audit({event:"WORKSPACE_GRANT_UPDATED",action:op,scope:op.startsWith("home")?"home":
        op.startsWith("outside")?"outside":"custom",mode:mode||"toggle"});
      return await snapshot({validatePaths:false});
    };
    const pending=queue.then(step);
    queue=pending.catch(()=>{});
    return pending;
  }
  await snapshot({validatePaths:false});
  return Object.freeze({file,tokenFile,home:canonicalHome,snapshot,authorized,update});
}
