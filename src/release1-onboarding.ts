import { setupSchema,type GatewayConfig } from "./config-schemas.js";
import { GatewayError,errorCode,isSafeInteger,parseJSON,record } from "./validation.js";
// Release 1 guided local setup: operator opts in; never installs remote software,
// configures public ingress, starts a tunnel, or stores credentials.
import { randomBytes } from "node:crypto";
import { lstat,mkdir,readFile,rename,rm,writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProjectPolicy } from "./project-workspace-policy.js";

const CONFIG_NAME="onboarding-v1.json";
function denied(code: string): never{const error=new GatewayError(code);throw error;}
function own(st: import("node:fs").Stats){return st.uid===(process.getuid?.()??st.uid);}
function safeMode(st: import("node:fs").Stats){return (st.mode&0o077)===0;}
export function defaultSetupPath(home=os.homedir()){
  return path.join(home,".config","mac-mcp-gateway",CONFIG_NAME);
}
function exactly(value: unknown,expected: unknown[]){if(!expected.includes(value))denied("SETUP_INVALID_OPTION");}
function validateFields(value: unknown): GatewayConfig {
  const c=record(value,"SETUP_CONFIG_INVALID");
  if(!c||typeof c!=="object"||Array.isArray(c))denied("SETUP_CONFIG_INVALID");
  const legacy=["connection","mode","port","projectRoot","version"];
  const version2=[...legacy,"accessRole"];
  const v3=[...version2,"writeScope"];
  const fields=c.version===3?v3:c.version===2?version2:legacy;
  if(![1,2,3].includes(Number(c.version))||typeof c.version!=="number"||Object.keys(c).sort().join()!==fields.sort().join())
    denied("SETUP_CONFIG_INVALID");
  exactly(c.mode,["read-only","read-write"]);
  exactly(c.connection,["tunnel","https"]);
  if(typeof c.version==="number"&&c.version>=2){
    exactly(c.accessRole,["restricted","trusted"]);
    if((c.accessRole==="trusted"&&c.mode!=="read-write")||
       (c.accessRole==="restricted"&&c.mode!=="read-only"))
      denied("SETUP_ACCESS_ROLE_MISMATCH");
    if(c.version===3&&
       (c.accessRole!=="trusted"||c.writeScope!=="home-only"))
      denied("SETUP_WRITE_SCOPE_INVALID");
  }
  if(!isSafeInteger(c.port)||c.port<1024||c.port>65535)denied("SETUP_INVALID_PORT");
  if(typeof c.projectRoot!=="string"||!path.isAbsolute(c.projectRoot))denied("SETUP_INVALID_ROOT");
  return Object.freeze(setupSchema.parse(c));
}
export async function checkSetupValues(value: unknown){
  const c=validateFields(value);
  if(process.platform!=="darwin"||Number(process.versions.node.split(".")[0])<22)
    denied("REQUIRES_MACOS_NODE_22");
  const trusted=c.version!==1&&c.accessRole==="trusted";
  await createProjectPolicy({root:c.projectRoot,mode:c.mode,
    developerCommands:trusted?"trusted-project":"presets",
    allowTrustedHomeRoot:trusted});
  return c;
}
export async function saveSetupConfig(value: unknown,{file=defaultSetupPath(),replace=false}={}){
  const config=await checkSetupValues(value);
  if(!path.isAbsolute(file))denied("SETUP_CONFIG_PATH_ABSOLUTE_REQUIRED");
  const folder=path.dirname(file);
  await mkdir(folder,{recursive:true,mode:0o700});
  const st=await lstat(folder);
  if(!st.isDirectory()||st.isSymbolicLink()||!own(st)||!safeMode(st))
    denied("SETUP_CONFIG_DIRECTORY_UNSAFE");
  const previous=await lstat(file).catch(e=>errorCode(e)==="ENOENT"?null:Promise.reject(e));
  if(previous&&(!replace||!previous.isFile()||previous.isSymbolicLink()||
     previous.nlink!==1||!own(previous)||!safeMode(previous)))
    denied("SETUP_EXISTING_CONFIG_PROTECTED");
  const scratch=path.join(folder,"."+CONFIG_NAME+"."+process.pid+"."+randomBytes(8).toString("hex")+".tmp");
  try{
    await writeFile(scratch,JSON.stringify(config,null,2)+"\n",
      {flag:"wx",mode:0o600});
    const check=await lstat(scratch);
    if(!own(check)||!safeMode(check))denied("SETUP_TMP_UNSAFE");
    // Operator expressly opts into replacement; never overwrite an unknown file.
    await rename(scratch,file);
  }finally{await rm(scratch,{force:true});}
  return file;
}
export async function loadSetupConfig(file=defaultSetupPath()){
  if(!path.isAbsolute(file))denied("SETUP_CONFIG_PATH_ABSOLUTE_REQUIRED");
  const parent=await lstat(path.dirname(file));
  if(!parent.isDirectory()||parent.isSymbolicLink()||!own(parent)||!safeMode(parent))
    denied("SETUP_CONFIG_DIRECTORY_UNSAFE");
  const st=await lstat(file);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||!own(st)||
     !safeMode(st)||st.size>8192)denied("SETUP_CONFIG_FILE_UNSAFE");
  let obj;
  try{obj=parseJSON(await readFile(file,"utf8"));}
  catch{denied("SETUP_CONFIG_JSON_INVALID");}
  return await checkSetupValues(obj);
}
export function setupRuntimeEnv(value: unknown){
  const config=validateFields(value);
  // New trusted developer role is an EXPLICIT owner selection. Legacy
  // versions keep the original restricted Gateway admission policy.
  const trusted=config.version!==1&&config.accessRole==="trusted";
  return {
    MAC_MCP_PROJECT_ROOT:config.projectRoot,
    MAC_MCP_PROJECT_PORT:String(config.port),
    MAC_MCP_WORKSPACE_MODE:config.mode,
    MAC_MCP_DEV_COMMANDS:trusted?"trusted-project":"presets",
    MAC_MCP_DC_ACCESS_MODE:trusted?"native":"workspace",
    MAC_MCP_DC_WRITE_SCOPE:config.version===3?"home-only":"unrestricted",
    MAC_MCP_GIT_MODE:"off",
    MAC_MCP_WORKTREE_MODE:"off",
    // First-run owner console: no grants are active until explicitly enabled.
    MAC_MCP_GRANTS_FILE:path.join(path.dirname(defaultSetupPath()),
      "workspace-grants-v1.json"),
    MAC_MCP_DENY_FILE:path.join(path.dirname(defaultSetupPath()),
      "deny-rules-v1.json")
  };
}
