#!/usr/bin/env node
import { cliEntry } from "../runtime-paths.js";
import { errorCode,parseJSON,record } from "../validation.js";
// Executed only by the owner's installed App after global Core Stop.
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { applyLiveHomeScope } from "../live-profile-home-settings.js";
const exec=promisify(execFile);
const home=homedir();
const cli=cliEntry();
function emit(value: unknown){process.stdout.write(JSON.stringify(value)+"\n");}
async function stopped(){
  try{
    const {stdout}=await exec(process.execPath,[cli,"status","--profile","live","--json"],
      {timeout:10000,maxBuffer:20000,env:{...process.env,HOME:home}});
    const status=record(parseJSON(stdout));
    return status.profile==="live"&&status.health==="not-running"&&
      status.executionMode==="stopped"&&status.listenerPid===null&&
      status.coreControl==="unavailable";
  }catch{return false;}
}
try{
 if(process.argv.slice(2).join(" ")!=="--apply --confirm-home-write-scope")
   throw Error("LIVE_APPROVAL_REQUIRED");
 emit(await applyLiveHomeScope({home,verifyStopped:stopped}));
}catch(e){
 emit({event:"LIVE_HOME_SCOPE_FAILED",code:/^[A-Z0-9_]+$/.test(errorCode(e)||"")?
   errorCode(e):"LIVE_APPLY_FAILED"});
 process.exitCode=1;
}
