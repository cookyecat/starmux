import { cliEntry } from "./runtime-paths.js";
import { GatewayError,currentUid,errorCode,isSafeInteger } from "./validation.js";
// Per-user macOS launchd service, explicitly installed by the operator.
// Does not touch legacy production launch agents, root services or public ports.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstat,mkdir,rename,rm,unlink,writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { defaultSetupPath,loadSetupConfig } from "./release1-onboarding.js";

export const SERVICE_LABEL="com.mac-mcp-gateway.release1";
const exec=promisify(execFile);
function fault(code: string): never{const e=new GatewayError(code);throw e;}
const xml=(s: unknown)=>String(s).replace(/[&<>"']/g,c=>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]!));
export function launchAgentPaths(home=os.homedir()){
  return Object.freeze({
    plist:path.join(home,"Library","LaunchAgents",SERVICE_LABEL+".plist"),
    logs:path.join(home,"Library","Logs","Mac-MCP-Gateway-Release1")
  });
}
export function renderLaunchAgent({nodeBinary,entry,configFile,logFolder}: {nodeBinary: string; entry: string; configFile: string; logFolder: string}){
  for(const str of [nodeBinary,entry,configFile,logFolder])
    if(typeof str!=="string"||!path.isAbsolute(str)||str.includes("\0"))
      fault("SERVICE_PATH_INVALID");
  const arg=[nodeBinary,entry,"start-setup"];
  return '<?xml version="1.0" encoding="UTF-8"?>\n'+
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '+
    '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'+
    '<plist version="1.0"><dict>\n'+
    '  <key>Label</key><string>'+xml(SERVICE_LABEL)+'</string>\n'+
    '  <key>ProgramArguments</key><array>'+
    arg.map(x=>'<string>'+xml(x)+'</string>').join('')+'</array>\n'+
    '  <key>EnvironmentVariables</key><dict><key>MAC_MCP_SETUP_FILE</key><string>'+
    xml(configFile)+'</string></dict>\n'+
    '  <key>RunAtLoad</key><true/>\n'+
    '  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>\n'+
    '  <key>ThrottleInterval</key><integer>15</integer>\n'+
    '  <key>StandardOutPath</key><string>'+xml(path.join(logFolder,"out.log"))+'</string>\n'+
    '  <key>StandardErrorPath</key><string>'+xml(path.join(logFolder,"err.log"))+'</string>\n'+
    '</dict></plist>\n';
}
async function safeFolder(folder: string){
  await mkdir(folder,{recursive:true,mode:0o700});
  const stat=await lstat(folder);
  if(!stat.isDirectory()||stat.isSymbolicLink()||
    (process.getuid&&stat.uid!==currentUid())||(stat.mode&0o022)!==0)
    fault("SERVICE_DIRECTORY_UNSAFE");
}
async function installedFile(file: string){
  const st=await lstat(file).catch(e=>errorCode(e)==="ENOENT"?null:Promise.reject(e));
  if(st&&(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||
     (process.getuid&&st.uid!==currentUid())))
    fault("SERVICE_PLIST_UNSAFE");
  return Boolean(st);
}
async function launch(...args: string[]){
  const uid=process.getuid?.();
  if(!isSafeInteger(uid))fault("SERVICE_MAC_UID_REQUIRED");
  return exec("/bin/launchctl",args,{timeout:7000,maxBuffer:12000});
}
export async function serviceCommand(action: string,{home=os.homedir(),
  configFile=defaultSetupPath(home),entry=cliEntry()}: {home?: string; configFile?: string|undefined; entry?: string}={}){
  if(process.platform!=="darwin")fault("SERVICE_REQUIRES_MACOS");
  if(process.getuid?.()===0)fault("SERVICE_MUST_RUN_AS_NORMAL_USER");
  const {plist,logs}=launchAgentPaths(home);
  const domain="gui/"+currentUid();
  // A profile must be safe even for a test-only dry run.
  await loadSetupConfig(configFile);
  if(action==="plan"){
    return {result:"PLAN_ONLY",label:SERVICE_LABEL,plist,portPlan:"loopback-only",
      automaticStart:false};
  }
  if(action==="install"){
    if(await installedFile(plist))fault("SERVICE_ALREADY_INSTALLED");
    await safeFolder(path.dirname(plist));
    await safeFolder(logs);
    const payload=renderLaunchAgent({nodeBinary:process.execPath,entry,configFile,
      logFolder:logs});
    const staging=plist+"."+randomBytes(6).toString("hex")+".tmp";
    try{
      await writeFile(staging,payload,{flag:"wx",mode:0o600});
      await rename(staging,plist);
    }finally{await rm(staging,{force:true});}
    return {result:"INSTALLED_NOT_STARTED",label:SERVICE_LABEL};
  }
  if(!await installedFile(plist))fault("SERVICE_NOT_INSTALLED");
  if(action==="start"){
    await launch("bootstrap",domain,plist);
    return {result:"START_REQUESTED",label:SERVICE_LABEL};
  }
  if(action==="stop"){
    await launch("bootout",domain,plist);
    return {result:"STOP_REQUESTED",label:SERVICE_LABEL};
  }
  if(action==="status"){
    try{await launch("print",domain+"/"+SERVICE_LABEL);
      return {result:"SERVICE_REGISTERED",label:SERVICE_LABEL};
    }catch{return {result:"SERVICE_NOT_ACTIVE",label:SERVICE_LABEL};}
  }
  if(action==="uninstall"){
    try{await launch("bootout",domain,plist);}
    catch{
      let registered=false;
      try{await launch("print",domain+"/"+SERVICE_LABEL);registered=true;}
      catch{ /* not registered */ }
      if(registered)fault("SERVICE_STOP_FIRST");
    }
    await unlink(plist);
    return {result:"UNINSTALLED_PROFILE_PRESERVED",label:SERVICE_LABEL};
  }
  fault("SERVICE_ACTION_INVALID");
}
