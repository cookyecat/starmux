#!/usr/bin/env node
import { errorCode,errorMessage } from "../validation.js";
// Run on the owner's Mac terminal only. Never send this token to an MCP client.
import { readFile } from "node:fs/promises";
import { createWorkspaceGrants,defaultGrantsPath } from "../workspace-grants.js";
try{
  const store=await createWorkspaceGrants({
    file:process.env.MAC_MCP_GRANTS_FILE||defaultGrantsPath()
  });
  if(process.argv[2]==="token"){
    const token=(await readFile(store.tokenFile,"utf8")).trim();
    process.stdout.write("Owner-only Dashboard key (do not send to AI): "+token+"\n");
  }else if(process.argv[2]==="status"){
    const {homeRead,outsideRead,custom}=await store.snapshot();
    process.stdout.write(JSON.stringify({homeRead,outsideRead,custom})+"\n");
  }else{
    process.stdout.write("Usage: node bin/permissions-owner.mjs token|status\n");
    process.exitCode=2;
  }
}catch(e){
  process.stderr.write("PERMISSIONS_FAILED "+String(errorCode(e)||errorMessage(e)).slice(0,90)+"\n");
  process.exitCode=1;
}
