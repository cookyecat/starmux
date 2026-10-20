import { errorCode } from "./validation.js";
// Read-only capability check from the *actual Gateway Core process*.
// Opening six well-known macOS protected directories is cheaper and safer
// than scanning contents with du, and does not inspect or retain filenames.
// This reports proven directory access, NOT the state of macOS's FDA toggle.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const protectedDirectories=Object.freeze([
  {id:"cloudDocs",label:"iCloud 文件",suffix:"Library/Application Support/CloudDocs"},
  {id:"mobileSync",label:"设备备份",suffix:"Library/Application Support/MobileSync"},
  {id:"tcc",label:"隐私数据库目录",suffix:"Library/Application Support/com.apple.TCC"},
  {id:"addressBook",label:"通讯录",suffix:"Library/Application Support/AddressBook"},
  {id:"faceTime",label:"FaceTime",suffix:"Library/Application Support/FaceTime"},
  {id:"knowledge",label:"系统知识库",suffix:"Library/Application Support/Knowledge"}
]);
export function classifyDirectoryAccess(error: unknown){
  if(!error)return "READ_OK";
  if(["EACCES","EPERM"].includes(errorCode(error)||""))return "OS_DENIED";
  if(errorCode(error)==="ENOENT")return "MISSING";
  return "INCONCLUSIVE";
}
export function summarizeDirectoryAccess(checks: readonly {state:string}[]){
  if(checks.length===0)return "unknown";
  if(checks.every(c=>c.state==="READ_OK"))return "verified";
  if(checks.some(c=>c.state==="OS_DENIED"))return "needs-attention";
  return "partial-or-unknown";
}
export async function probeCurrentDirectoryAccess({
  home=os.homedir(),openDirectory=(name: string)=>fs.opendir(name),now=()=>new Date()
}={}){
  const checks=[];
  for(const directory of protectedDirectories){
    let handle=null;let state="INCONCLUSIVE";
    try{
      handle=await openDirectory(path.join(home,directory.suffix));
      state="READ_OK";
    }catch(error){
      state=classifyDirectoryAccess(error);
    }finally{
      if(handle)try{await handle.close();}catch{state="INCONCLUSIVE";}
    }
    checks.push({id:directory.id,label:directory.label,state});
  }
  return {
    schemaVersion:1,context:"gateway-process",method:"open-directory-without-reading-entries",
    checkedAt:now().toISOString(),summary:summarizeDirectoryAccess(checks),
    checks
  };
}
