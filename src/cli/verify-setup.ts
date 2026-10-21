#!/usr/bin/env node
import { errorCode,errorMessage,isRecord,record } from "../validation.js";
// Operator-initiated local verification only. Does not claim ChatGPT reached Mac.
import { loadSetupConfig } from "../release1-onboarding.js";
async function main(){
  const profile=await loadSetupConfig(process.env.MAC_MCP_SETUP_FILE);
  const endpoint="http://127.0.0.1:"+profile.port;
  const opts={signal:AbortSignal.timeout(4000)};
  const health=await fetch(endpoint+"/healthz",opts);
  if(!health.ok)throw Error("LOCAL_GATEWAY_NOT_READY");
  async function request(method: string,params: Record<string,unknown>={}){
    const response=await fetch(endpoint+"/mcp",{
      method:"POST",
      headers:{"content-type":"application/json",accept:"application/json, text/event-stream",...(process.env.MAC_MCP_API_KEY?{authorization:"Bearer "+process.env.MAC_MCP_API_KEY}:{})},
      body:JSON.stringify({jsonrpc:"2.0",id:19,method,params}),
      signal:AbortSignal.timeout(10000)
    });
    if(response.status===401)throw Error("GATEWAY_KEY_REQUIRED_SET_MAC_MCP_API_KEY");
    if(!response.ok)throw Error("LOCAL_MCP_HTTP_FAILURE");
    const json=record(await response.json());
    if(json.error)throw Error("LOCAL_MCP_RPC_FAILURE");
    return record(json.result);
  }
  const list=await request("tools/list");
  if(!Array.isArray(list.tools)||!list.tools.some((t: unknown)=>isRecord(t)&&t.name==="read_file"))
    throw Error("LOCAL_DC_TOOLS_MISSING");
  const read=await request("tools/call",{
    name:"list_directory",arguments:{path:".",depth:0}
  });
  if(read.isError)throw Error("LOCAL_APPROVED_WORKSPACE_READ_DENIED");
  process.stdout.write(JSON.stringify({
    event:"SETUP_LOCAL_VERIFICATION",result:"PASS",
    toolCount:list.tools.length,remoteClientVerified:false,
    ingressConfigured:false,profile:profile.mode,
    next:"Complete remote ChatGPT connection and invoke a tool from that client"
  })+"\n");
}
try{await main();}
catch(error){
  process.stderr.write("SETUP_LOCAL_VERIFY_FAIL "+
    String(errorCode(error)||errorMessage(error)||"UNKNOWN").slice(0,100)+"\n");
  if(errorMessage(error)==="fetch failed")
    process.stderr.write("Start the setup Core with mac-mcp-gateway run in another terminal, keep it running, then retry mac-mcp-gateway verify. Setup and doctor do not start an HTTP listener.\n");
  process.exitCode=1;
}
