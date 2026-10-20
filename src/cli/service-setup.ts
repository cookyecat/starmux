#!/usr/bin/env node
import { serviceCommand } from "../release1-service.js";
import { cliEntry } from "../runtime-paths.js";
import { errorCode,errorMessage } from "../validation.js";
const action=process.argv[2]||"help";
const allowed=["plan","install","start","stop","status","uninstall"];
if(!allowed.includes(action)){
  process.stdout.write("Usage: service-setup.mjs "+allowed.join("|")+"\n");
  if(action!=="help")process.exitCode=2;
}else{
  try{
    const result=await serviceCommand(action,{
      entry:cliEntry(),
      configFile:process.env.MAC_MCP_SETUP_FILE
    });
    process.stdout.write(JSON.stringify({event:"RELEASE1_SERVICE",...result})+"\n");
  }catch(e){
    process.stderr.write("SERVICE_FAILED "+
      String(errorCode(e)||errorMessage(e)||"UNKNOWN").slice(0,80)+"\n");
    process.exitCode=1;
  }
}
