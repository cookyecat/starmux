import { privateAgentSchema } from "./config-schemas.js";
import { currentUid,GatewayError,parseJSON } from "./validation.js";
// Only the local Mac owner may migrate an existing foreground "live" profile.
// This never creates a second Core, edits TCC, or alters upstream DC settings.
import { execFile } from "node:child_process";
import { chmod,lstat,open,rename,rm,writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
const exec=promisify(execFile);
const LABEL="ai.home.mac-mcp-project-workspace";
function fail(code: string): never {const e=new GatewayError(code);throw e;};

export function makeHomeScopedLiveProfile(value: unknown,home: string){
  const parsed=privateAgentSchema.safeParse(value);
  if(!parsed.success)fail("LIVE_PROFILE_UNRECOGNIZED");
  const data=parsed.data;
  if(typeof home!=="string"||!path.isAbsolute(home)||home==="/"||home==="/Users")
    fail("LIVE_HOME_INVALID");
  if(data?.Label!==LABEL||!Array.isArray(data.ProgramArguments)||
     data.ProgramArguments.length!==2||!data.EnvironmentVariables||
     data.EnvironmentVariables.MAC_MCP_PROJECT_PORT!=="8793"||
     data.EnvironmentVariables.MAC_MCP_DC_ACCESS_MODE!=="native"||
     data.EnvironmentVariables.MAC_MCP_DEV_COMMANDS!=="trusted-project"||
     data.EnvironmentVariables.MAC_MCP_WORKSPACE_MODE!=="read-write")
    fail("LIVE_PROFILE_UNRECOGNIZED");
  const env=data.EnvironmentVariables;
  if(env.MAC_MCP_UPSTREAMS_FILE||!(["off",undefined].includes(env.MAC_MCP_GIT_MODE)))
    fail("LIVE_HOME_SCOPE_EXTRA_EXECUTORS_UNSAFE");
  if(!data.ProgramArguments[1].startsWith(path.join(home,"Library","Application Support","Mac-MCP-Gateway","releases")+path.sep)||
     path.basename(data.ProgramArguments[1])!=="dc-workspace-http.mjs"||
     data.WorkingDirectory!==path.dirname(path.dirname(data.ProgramArguments[1])))
    fail("LIVE_RUNTIME_UNRECOGNIZED");
  return {...data,EnvironmentVariables:{
    ...env,MAC_MCP_PROJECT_ROOT:home,MAC_MCP_DC_WRITE_SCOPE:"home-only"
  }};
}
export async function applyLiveHomeScope({
 home, verifyStopped,
 plist=path.join(home,"Library/LaunchAgents",LABEL+".plist")
}: {home: string; verifyStopped: ()=>Promise<boolean>; plist?: string}){
  if(typeof verifyStopped!=="function")fail("LIVE_STOP_VERIFIER_REQUIRED");
  const original=await lstat(plist);
  if(!original.isFile()||original.isSymbolicLink()||original.nlink!==1||
     original.uid!==currentUid()||(original.mode&0o022)!==0)
    fail("LIVE_PLIST_UNTRUSTED");
  if(!await verifyStopped())fail("LIVE_CORE_MUST_BE_STOPPED");
  const {stdout}=await exec("/usr/bin/plutil",["-convert","json","-o","-",plist],
    {timeout:5000,maxBuffer:40000});
  const current=parseJSON(stdout);
  const updated=makeHomeScopedLiveProfile(current,home);
  const dir=path.dirname(plist);
  const tmp=path.join(dir,".mac-mcp-live-settings-"+process.pid+"-"+Date.now()+".plist");
  let handle;
  try {
    // plutil serializes the checked object, not user-provided XML.
    const raw=JSON.stringify(updated);
    const tmpJson=tmp+".json";
    await writeFile(tmpJson,raw,{flag:"wx",mode:0o600});
    try {
      await exec("/usr/bin/plutil",["-convert","xml1","-o",tmp,tmpJson],
        {timeout:5000,maxBuffer:12000});
    }finally{await rm(tmpJson,{force:true});}
    await chmod(tmp,original.mode&0o777);
    handle=await open(tmp,"r");await handle.sync();await handle.close();handle=null;
    // Verify the Core remains stopped at the moment of atomic replacement.
    if(!await verifyStopped())fail("LIVE_CORE_CHANGED_DURING_SAVE");
    await rename(tmp,plist);
    return {event:"LIVE_HOME_SCOPE_APPLIED",writeScope:"home-only"};
  }finally{
    await handle?.close().catch(()=>{});
    await rm(tmp,{force:true});
  }
}
