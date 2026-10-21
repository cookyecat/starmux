import {ownedByUser,createPrivateDirectory,within} from "./platform.js";
import { denySchema } from "./config-schemas.js";
import type { AuditSink,DenyConfig,ToolArguments } from "./contracts.js";
import { GatewayError,errorCode,parseJSON,record } from "./validation.js";
// Optional explicit-deny preferences. Never a sandbox; native tools and command
// semantics belong to upstream Desktop Commander and the macOS execution user.
// Reads the owner-only 0600 profile on EVERY discovery/call, so revocation applies
// to stale-client tool calls without restarting the Gateway.
import { randomBytes } from "node:crypto";
import { lstat,mkdir,readFile,realpath,rename,rm,writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

function issue(code: string): never {const e=new GatewayError(code);throw e;};
const toolName=/^[a-zA-Z_][a-zA-Z0-9_.:-]{0,127}$/;
const pathKeys=new Set(["path","file_path","paths","source","destination","outputPath"]);
const defaults=(): DenyConfig=>({version:1,deniedTools:[],deniedDirectories:[]});
export const defaultDenyRulesPath=(home=homedir())=>
  path.join(home,".config","mac-mcp-gateway","deny-rules-v1.json");
function verify(value: unknown): DenyConfig {
  const obj=record(value,"DENY_RULES_INVALID");
  if(!obj||typeof obj!=="object"||Array.isArray(obj)||
     Object.keys(obj).sort().join()!=="deniedDirectories,deniedTools,version"||
     obj.version!==1||!Array.isArray(obj.deniedTools)||
     !Array.isArray(obj.deniedDirectories)||
     obj.deniedTools.length>64||obj.deniedDirectories.length>24)
    issue("DENY_RULES_INVALID");
  if(obj.deniedTools.some(n=>typeof n!=="string"||!toolName.test(n))||
     new Set(obj.deniedTools).size!==obj.deniedTools.length)issue("DENY_TOOL_INVALID");
  if(obj.deniedDirectories.some(p=>typeof p!=="string"||!path.isAbsolute(p)||
     p.includes("\0")||p.length>1024||path.normalize(p)!==p)||
     new Set(obj.deniedDirectories).size!==obj.deniedDirectories.length)
    issue("DENY_DIRECTORY_INVALID");
  return denySchema.parse(obj);
}
async function secureFile(file: string,{optional=false,directory=false}={}){
  const st=await lstat(file).catch(e=>errorCode(e)==="ENOENT"&&optional?null:Promise.reject(e));
  if(!st)return null;
  if(st.isSymbolicLink()||!ownedByUser(file,st,true)||
     (directory?!st.isDirectory():(!st.isFile()||st.nlink!==1)))issue("DENY_FILE_UNSAFE");
  return st;
}
async function atomic(file: string,payload: string){
  const temp=path.join(path.dirname(file),"."+path.basename(file)+"."+randomBytes(8).toString("hex"));
  try{
    await writeFile(temp,payload,{flag:"wx",mode:0o600});
    await rename(temp,file);
  }finally{await rm(temp,{force:true});}
}
async function canonical(raw: unknown,{mustExist=false}={}){
  if(typeof raw!=="string"||!path.isAbsolute(raw)||raw.length>1024||
     raw.includes("\0")||raw.split(path.sep).includes("..")||path.normalize(raw)!==raw)
    issue("DENY_ABSOLUTE_DIRECTORY_REQUIRED");
  let at=raw,tail=[];
  while(true){
    try{
      const resolved=await realpath(at);
      const c=path.join(resolved,...tail.reverse());
      if(mustExist){
        const st=await lstat(c);
        if(!st.isDirectory())issue("DENY_DIRECTORY_NOT_FOUND");
      }
      return c;
    }catch(e){
      if(errorCode(e)!=="ENOENT")throw e;
      if(mustExist)issue("DENY_DIRECTORY_NOT_FOUND");
      const parent=path.dirname(at);
      if(parent===at)issue("DENY_ROOT_UNAVAILABLE");
      tail.push(path.basename(at));at=parent;
    }
  }
}
const isWithin=within;
function referencedPaths(name: string,args: ToolArguments){
  if(name==="start_process"||name==="interact_with_process"||name==="get_config"||
     name==="set_config_value")return [];
  if(!args||typeof args!=="object"||Array.isArray(args))return [];
  const values=[];
  for(const [key,val] of Object.entries(args)){
    if(!pathKeys.has(key))continue;
    if(typeof val==="string")values.push(val);
    else if(Array.isArray(val)&&val.every(x=>typeof x==="string"))
      values.push(...val);
  }
  return values;
}
export async function createDenyRules({file=defaultDenyRulesPath(),audit=()=>{}}: {file?: string; audit?: AuditSink}={}){
  if(typeof file!=="string"||!path.isAbsolute(file)||path.basename(file).length>160)
    issue("DENY_RULES_FILE_PATH_REQUIRED");
  const folder=path.dirname(file);
  createPrivateDirectory(folder);
  await secureFile(folder,{directory:true});
  if(!await secureFile(file,{optional:true}))
    await atomic(file,JSON.stringify(defaults(),null,2)+"\n");
  let sequence: Promise<unknown>=Promise.resolve();
  async function snapshot(){
    const st=await secureFile(file);
    if(st!.size>16384)issue("DENY_RULES_TOO_LARGE");
    return verify(parseJSON(await readFile(file,"utf8")));
  }
  async function update(op: string,value: unknown){
    async function change(){
      const state=await snapshot();
      if(op==="disable-tool"||op==="enable-tool"){
        if(typeof value!=="string"||!toolName.test(value))issue("DENY_TOOL_INVALID");
        if(op==="disable-tool"&&!state.deniedTools.includes(value))
          state.deniedTools.push(value);
        if(op==="enable-tool")state.deniedTools=state.deniedTools.filter(x=>x!==value);
      }else if(op==="deny-directory"||op==="allow-directory"){
        const canon=op==="deny-directory"?await canonical(value,{mustExist:true}):value;
        if(typeof canon!=="string"||!path.isAbsolute(canon)||
           canon.length>1024||path.normalize(canon)!==canon)issue("DENY_DIRECTORY_INVALID");
        if(op==="deny-directory"&&!state.deniedDirectories.includes(canon))
          state.deniedDirectories.push(canon);
        if(op==="allow-directory")state.deniedDirectories=
          state.deniedDirectories.filter(x=>x!==canon);
      }else issue("DENY_RULE_OPERATION_INVALID");
      verify(state);
      await atomic(file,JSON.stringify(state,null,2)+"\n");
      audit({event:"OWNER_DENY_RULE_CHANGED",action:op,
        ...(op.endsWith("tool")?{tool:value}:{ruleType:"directory"})});
      return state;
    }
    const next=sequence.then(change);
    sequence=next.catch(()=>{});
    return next;
  }
  async function check(name: string,args: ToolArguments){
    const s=await snapshot();
    if(s.deniedTools.includes(name))issue("TOOL_DISABLED_BY_OWNER");
    if(s.deniedDirectories.length===0)return;
    for(const candidate of referencedPaths(name,args)){
      // Relative path resolution may be upstream-specific. With explicit path
      // bans, fail closed instead of accidentally checking the wrong directory.
      if(!path.isAbsolute(candidate))issue("DENY_PATH_UNRESOLVED");
      const resolved=await canonical(candidate);
      if(s.deniedDirectories.some(root=>isWithin(resolved,root)))
        issue("DIRECTORY_DISABLED_BY_OWNER");
    }
  }
  await snapshot();
  return Object.freeze({file,snapshot,update,check});
}
