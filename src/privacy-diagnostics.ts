import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "./contracts.js";
import { toolResult } from "./mcp-results.js";
import { errorCode,errorMessage,errorStderr,isSafeInteger,record } from "./validation.js";
// Read-only, operator-invoked macOS privacy parity probe.
// The gateway RPC is intentionally used to test the execution context that
// actually touches protected files; "node", UID or a successful /healthz
// cannot establish TCC access by themselves.
import { execFile as callback } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
const execFile=promisify(callback);
function failure(message: string): never {throw new Error(message);};
const protectedSuffixes=[
  "Library/Application Support/CloudDocs",
  "Library/Application Support/MobileSync",
  "Library/Application Support/com.apple.TCC",
  "Library/Application Support/AddressBook",
  "Library/Application Support/FaceTime",
  "Library/Application Support/Knowledge"
];
const validPort=(p: unknown): p is number=>isSafeInteger(p)&&p>=1024&&p<=65535;
const sizeMatch=/(?:^|\n)\s*(\d+)\s+(.+)(?:\n|$)/;
export function parseDuOutput(stdout="",stderr="",exitCode: unknown=0){
  const error=String(stderr||"");
  if(/Operation not permitted|Permission denied/i.test(error))
    return {state:"OS_DENIED",reason:"macOS filesystem access denied; TCC attribution not independently proven"};
  if(exitCode===null&&/Operation not permitted|Permission denied/i.test(stdout))
    return {state:"OS_DENIED",reason:"macOS filesystem access denied; TCC attribution not independently proven"};
  const m=String(stdout||"").match(sizeMatch);
  if(exitCode===0&&m)return {state:"READ_OK",kib:Number(m[1])};
  return {state:"INCONCLUSIVE",reason:exitCode===null?"No final process result":
    "du exited "+exitCode};
}
async function rpc(port: number,method: string,params: Record<string,unknown>={}){
  const response=await fetch("http://127.0.0.1:"+port+"/mcp",{
    method:"POST",
    headers:{"content-type":"application/json","accept":"application/json, text/event-stream"},
    body:JSON.stringify({jsonrpc:"2.0",id:44,method,params}),
    signal:AbortSignal.timeout(6000)
  });
  if(!response.ok)failure("MCP_HTTP_"+response.status);
  const value=record(await response.json());
  if(value.error)failure("MCP_JSONRPC_ERROR");
  if(!value.result||typeof value.result!=="object")failure("MCP_RESULT_MISSING");
  return record(value.result);
}
const extractText=(reply: CallToolResult)=>(reply.content||[]).filter(x=>x.type==="text")
  .map(x=>String(x.text)).join("\n");
export function parseMcpDu(reply: CallToolResult){
  const text=extractText(reply);
  if(/WORKSPACE_DENIED|TOOL_DISABLED_BY_OWNER|DIRECTORY_DISABLED_BY_OWNER/.test(text))
    return {state:"GATEWAY_DENIED",reason:"Owner Gateway policy denied invocation"};
  if(/Operation not permitted|Permission denied/i.test(text))
    return {state:"OS_DENIED",reason:"macOS filesystem access denied in Gateway execution context"};
  const match=text.match(sizeMatch);
  if(match)return {state:"READ_OK",kib:Number(match[1])};
  return {state:reply.isError?"UPSTREAM_ERROR":"INCONCLUSIVE",
    reason:"No terminal result captured; not proof of OS access"};
}
async function direct(target: string){
  try{
    const r=await execFile("/usr/bin/du",["-sk",target],{
      timeout:9000,maxBuffer:12000,encoding:"utf8"
    });
    return parseDuOutput(r.stdout,r.stderr,0);
  }catch(e){
    if(errorCode(e)==="ENOENT")return {state:"MISSING"};
    const details=record(e);
    if(details.killed)return {state:"TIMEOUT"};
    return parseDuOutput(typeof details.stdout==="string"?details.stdout:"",errorStderr(e)||"",details.code??1);
  }
}
async function throughGateway(port: number,target: string){
  try{
    const catalog=ListToolsResultSchema.parse(await rpc(port,"tools/list"));
    if(!catalog.tools?.some(x=>x.name==="start_process"))
      return {state:"TOOL_UNAVAILABLE",reason:"start_process is disabled or missing"};
    // Single-quote for shell arguments; no shell interpolation from target.
    const quoted="'"+target.replace(/'/g,"'\\''")+"'";
    let reply=toolResult(await rpc(port,"tools/call",{
      name:"start_process",
      arguments:{command:"/usr/bin/du -sk "+quoted,timeout_ms:3000}
    }));
    let result=parseMcpDu(reply);
    const message=extractText(reply);
    if(result.state==="INCONCLUSIVE"&&catalog.tools.some(x=>x.name==="read_process_output")){
      const match=message.match(/Process started with PID\s+(\d+)/);
      if(match){
        await new Promise(r=>setTimeout(r,150));
        try{
          reply=toolResult(await rpc(port,"tools/call",{name:"read_process_output",
            arguments:{pid:Number(match[1]),offset:0,length:100,timeout_ms:1000}}));
          result=parseMcpDu(reply);
        }catch{
          // A missed asynchronous output is inconclusive, not denied.
        }
      }
    }
    return result;
  }catch(e){
    return {state:"GATEWAY_UNAVAILABLE",reason:String(errorMessage(e)||e).slice(0,95)};
  }
}
export function classifyPrivacy(directState: string,gatewayState: string){
  if(directState==="READ_OK"&&gatewayState==="READ_OK")
    return "PARITY_OK";
  if(directState==="READ_OK"&&gatewayState==="OS_DENIED")
    return "EXECUTION_CONTEXT_MISMATCH";
  if(gatewayState==="GATEWAY_DENIED")
    return "GATEWAY_POLICY";
  if(directState==="OS_DENIED"&&gatewayState==="OS_DENIED")
    return "BOTH_DENIED";
  if(directState==="MISSING")return "DIRECTORY_NOT_FOUND";
  return "NEEDS_REVIEW";
}
export async function privacyReport({port,home=os.homedir(),all=false,target=null}: {port:number;home?:string;all?:boolean;target?:string|null}){
  if(!validPort(port))failure("PRIVACY_INVALID_PORT");
  if(target!==null&&(typeof target!=="string"||!path.isAbsolute(target)||
      target.includes("\0")||target.length>2048))failure("PRIVACY_TARGET_ABSOLUTE_REQUIRED");
  if(target&&all)failure("PRIVACY_TARGET_AND_ALL_CONFLICT");
  const paths=target?[target]:protectedSuffixes.slice(0,all?undefined:1)
    .map(s=>path.join(home,s));
  const entries=[];
  for(const p of paths){
    const d=await direct(p);
    const g=await throughGateway(port,p);
    entries.push({target:p,terminal:d,gateway:g,
      comparison:classifyPrivacy(d.state,g.state)});
  }
  return {
    event:"GATEWAY_PRIVACY_DIAGNOSIS" as const,
    timestamp:new Date().toISOString(),port,
    source:"actual /usr/bin/du -sk in terminal and loopback MCP Desktop Commander",
    readOnly:true,
    entries,
    note:"This tests actual directory access, not the TCC database or the responsible app identity. launchd and Termius may differ. No permission is changed."
  };
}
