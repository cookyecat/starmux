import {ownedByUser,supportedHost,windows,childEnvKeys} from "./platform.js";
import { privateAgentSchema,type PrivateAgent } from "./config-schemas.js";
import type { GatewayStatus } from "./contracts.js";
import { cliEntry,packageRoot } from "./runtime-paths.js";
import { runtimeIdentity,formatStartup } from "./runtime-identity.js";
import { GatewayError,errorCode,errorMessage,errorStderr,isInteger,isSafeInteger,parseJSON,record } from "./validation.js";
export interface CliOptions {home?:string;profile?:string;entry?:string;port?:number;controlRoot?:string;appParentPid?:number;json?:boolean;all?:boolean;target?:string;lines?:number}
type ServiceInfo={label:string;plist:string;installed:boolean;files:string[]} & ({kind:"live";agent:PrivateAgent}|{kind:"setup"});
interface LifecycleOperations {registered:boolean;portBusy:boolean;disable:()=>Promise<unknown>;enable:()=>Promise<unknown>;bootout:()=>Promise<unknown>;bootstrap:()=>Promise<unknown>;waitPortFree:()=>Promise<boolean>;waitHealthy:()=>Promise<boolean>;port:number}
export type CliResult = GatewayStatus | {event:"GATEWAY_LOGS";output:string} | {event:"GATEWAY_RUN_EXIT";code:number} | {event:"GATEWAY_CORE";result:string;port:number;launcher?:string;ownerPid?:number} | Awaited<ReturnType<typeof import('./privacy-diagnostics.js').privacyReport>>;
// Operator-facing foreground CLI and explicit, per-user launchd lifecycle.
// Adopt existing private service without overwriting its checked plist.
import { execFile as execFileCallback,spawn } from "node:child_process";
import { access,lstat,readFile } from "node:fs/promises";
import net from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { acquireControl,connectOwner,globalStop } from "./global-core-control.js";
import { defaultSetupPath,loadSetupConfig,setupRuntimeEnv } from "./release1-onboarding.js";
import { SERVICE_LABEL,launchAgentPaths,serviceCommand } from "./release1-service.js";
const execFile=promisify(execFileCallback);
const PRIVATE_LABEL="ai.home.mac-mcp-project-workspace";
function failure(x: string): never {const e=new GatewayError(x);throw e;};
const goodPort=(n: unknown): n is number=>isSafeInteger(n)&&n>=1024&&n<=65535;
export function classifyServiceRuntime({registered=false,portBusy=false,healthy=false,ownedPid=false}={}){
  if(registered)return healthy?"service-healthy":"service-unhealthy";
  if(!portBusy)return "stopped";
  if(healthy&&ownedPid)return "foreground";
  return "unknown-listener";
}
export function serviceActionDecision(action: string,{registered=false,portBusy=false}={}){
  if(action==="start"){
    if(registered)return "ALREADY_RUNNING";
    return portBusy?"PORT_IN_USE":"START";
  }
  if(action==="restart"){
    if(!registered&&portBusy)return "FOREGROUND_IN_USE";
    return registered?"RESTART":"START";
  }
  if(action==="stop")return registered?"STOP":"ALREADY_STOPPED";
  throw Error("INVALID_SERVICE_ACTION");
}
const privatePlist=(home: string)=>path.join(home,"Library","LaunchAgents",PRIVATE_LABEL+".plist");
async function owned(p: string,uid: number,required=false){
  let st;
  try{st=await lstat(p);}catch(e){
    if(errorCode(e)==="ENOENT"&&!required)return false;
    throw e;
  }
  if(st.isSymbolicLink()||!st.isFile()||st.nlink!==1||!ownedByUser(p,st)||(process.platform!=="win32"&&(st.mode&0o022)))failure("UNTRUSTED_OWNER_FILE");
  return true;
}
async function parsePlist(p: string){
  const {stdout}=await execFile("/usr/bin/plutil",["-convert","json","-o","-",p],
    {timeout:5000,maxBuffer:20000});
  let a;try{a=parseJSON(stdout);}catch{failure("PLIST_INVALID");}
  return a;
}
function validatePrivate(value: unknown,home: string){
  const parsed=privateAgentSchema.safeParse(value);
  if(!parsed.success)failure("PRIVATE_RUNTIME_UNRECOGNIZED");
  const a=parsed.data;
  const files=a?.ProgramArguments;
  const env=a?.EnvironmentVariables;
  if(a?.Label!==PRIVATE_LABEL||!Array.isArray(files)||files.length!==2||
    typeof files[0]!=="string"||typeof files[1]!=="string"||
    !files[1].startsWith(path.join(home,"Library","Application Support",
      "Mac-MCP-Gateway","releases")+path.sep)||
    path.basename(files[1])!=="dc-workspace-http.mjs"||
    a.WorkingDirectory!==path.dirname(path.dirname(files[1]))||
    !env||env.MAC_MCP_PROJECT_PORT!=="8793")
      failure("PRIVATE_RUNTIME_UNRECOGNIZED");
  return a;
}
async function locate(home: string,uid: number,profile="auto"): Promise<ServiceInfo>{
  if(!["live","setup","auto"].includes(profile))failure("INVALID_PROFILE");
  if(process.platform!=="darwin"){
    if(profile==="live")failure("LEGACY_PROFILE_MACOS_ONLY");
    return {kind:"setup",label:SERVICE_LABEL,plist:"",installed:false,files:[]};
  }
  const privateFile=privatePlist(home);
  const hasSetup=profile==="auto"&&await owned(defaultSetupPath(home),uid);
  if(profile==="live"||(profile==="auto"&&!hasSetup&&await owned(privateFile,uid))){
    await owned(privateFile,uid,true);
    const a=validatePrivate(await parsePlist(privateFile),home);
    return {kind:"live",label:PRIVATE_LABEL,plist:privateFile,agent:a,installed:true,
      files:[a.StandardOutPath,a.StandardErrorPath].filter((value):value is string=>typeof value==="string" && value.length>0)};
  }
  const pl=launchAgentPaths(home);
  return {kind:"setup",label:SERVICE_LABEL,plist:pl.plist,
    installed:await owned(pl.plist,uid),
    files:[path.join(pl.logs,"out.log"),path.join(pl.logs,"err.log")]};
}
async function registered(label: string,uid: number){
  if(process.platform!=="darwin")return false;
  try{await execFile("/bin/launchctl",["print","gui/"+uid+"/"+label],
    {timeout:5000,maxBuffer:10000});return true;}catch{return false;}
}
async function launch(command: string,uid: number,plist: string){
  try{await execFile("/bin/launchctl",[command,"gui/"+uid,plist],
    {timeout:12000,maxBuffer:20000});}
  catch(e){failure("LAUNCHCTL_"+command.toUpperCase()+"_FAILED "+
    String(errorStderr(e)||errorMessage(e)).slice(0,120));}
}
async function available(port: number): Promise<boolean>{
  return new Promise(resolve=>{
    const server=net.createServer();
    server.once("error",()=>resolve(false));
    server.listen(port,"127.0.0.1",()=>server.close(()=>resolve(true)));
  });
}
async function disabledFlag(label: string,uid: number){
  if(process.platform!=="darwin")return true;
  try{
    const {stdout}=await execFile("/bin/launchctl",["print-disabled","gui/"+uid],
      {timeout:5000,maxBuffer:120000});
    const line=stdout.split("\n").find(s=>s.includes('"'+label+'" =>'));
    if(!line)return null;
    return line.includes("=> disabled");
  }catch{return null;}
}
async function setAutostart(label: string,uid: number,enabled: boolean){
  try{
    await execFile("/bin/launchctl",[enabled?"enable":"disable",
      "gui/"+uid+"/"+label],{timeout:7000,maxBuffer:15000});
  }catch(e){failure("LAUNCHCTL_AUTOSTART_CHANGE_FAILED "+
    String(errorStderr(e)||errorMessage(e)).slice(0,90));}
}
async function listenerOwner(port: number,expectedEntry: string){
  if(process.platform!=="darwin")return null;
  try{
    const {stdout}=await execFile("/usr/sbin/lsof",[
      "-nP","-t","-iTCP:"+port,"-sTCP:LISTEN"],{timeout:4000});
    const pid=Number(stdout.trim().split("\n")[0]);
    if(!isSafeInteger(pid)||pid<2)return null;
    const info=await execFile("/bin/ps",["-p",String(pid),"-o","command="],
      {timeout:4000});
    return {pid,matchingEntry:info.stdout.trim().includes(expectedEntry)};
  }catch{return null;}
}
async function waitForHealthy(port: number,attempts=24){
  for(let i=0;i<attempts;i++){
    try{
      const r=await fetch("http://127.0.0.1:"+port+"/healthz",{
        signal:AbortSignal.timeout(700)});
      if(r.ok&&record(await r.json()).status==="ok")return true;
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  return false;
}
async function waitUntilFree(port: number,attempts=24){
  for(let i=0;i<attempts;i++){
    if(await available(port))return true;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  return false;
}
async function envFor(info: ServiceInfo,home: string): Promise<NodeJS.ProcessEnv>{
  return info.kind==="live"?{...info.agent.EnvironmentVariables}:
    setupRuntimeEnv(await loadSetupConfig(defaultSetupPath(home)));
}
async function currentStatus(info: ServiceInfo,uid: number,home: string,portOverride?:number): Promise<Omit<GatewayStatus,"event"|"coreControl"|"coreLauncher"|"coreOwnerPid">>{
  const active=await registered(info.label,uid);
  // First-run setup is a user-owned 0600 profile, NOT an installed
  // launchd Service. Inspect it directly to discover the Core port.
  let env: NodeJS.ProcessEnv|null=info.kind==="live"?info.agent.EnvironmentVariables:null;
  if(info.kind==="setup"){
    try{env=await envFor(info,home);}
    catch(e){
      if(!["ENOENT","SETUP_CONFIG_MISSING"].includes(errorCode(e)||""))throw e;
    }
  }
  const port=portOverride??(env?Number(env.MAC_MCP_PROJECT_PORT):null);
  const portBusy=goodPort(port)?!(await available(port)):false;
  let health=portBusy?"unreachable":"not-running";
  let workspaceMode=null;
  let writeScope=null;
  let accessMode: GatewayStatus["accessMode"]=null;
  if(portBusy&&port!==null){
    try{
      const r=await fetch("http://127.0.0.1:"+port+"/healthz",{
        signal:AbortSignal.timeout(2000)});
      const data=record(await r.json());
      if(data.accessMode==="ingress"||data.accessMode==="api-key"||data.accessMode==="unavailable")accessMode=data.accessMode;
      if(r.ok&&data.status==="ok"&&typeof data.mode==="string"&&["read-only","read-write"].includes(data.mode))
        workspaceMode=data.mode;
      if(r.ok&&data.status==="ok"&&typeof data.writeScope==="string"&&["home-only","unrestricted"].includes(data.writeScope))
        writeScope=data.writeScope;
      health=r.ok&&data.status==="ok"&&
        data.service==="dc-project-workspace"?"ok":"unrecognized";
    }catch{health="unreachable";}
  }
  const owner=portBusy&&port!==null?await listenerOwner(port,
    info.kind==="live"?info.agent.ProgramArguments[1]:"dc-workspace-http.mjs"):null;
  let trustedControl=false;
  if(portBusy&&goodPort(port)){
    try{
      const lease=await connectOwner(port);
      trustedControl=lease?.result.result==="RUNNING";
    }catch{/* Do not trust a malformed/unresponsive owner lease. */}
  }
  const executionMode=classifyServiceRuntime({
    registered:active,portBusy,healthy:health==="ok",
    ownedPid:trustedControl||owner?.matchingEntry===true
  });
  const autostart=await disabledFlag(info.label,uid);
  return {profile:info.kind,installed:info.installed,registered:active,
    label:info.label,port,health,workspaceMode,writeScope,accessMode,executionMode,listenerPid:owner?.pid??null,
    loginAutostart:autostart===null?((info.kind==="live"?info.agent.RunAtLoad:undefined)===true?"default-enabled":"unknown"):autostart?"disabled":"enabled",
    tcc:process.platform==="darwin"?"Foreground Termius vs background launchd may have different macOS privacy access":"Access follows the current OS account permissions"};
}
export async function executeServiceLifecycle(action: string,{
  registered:running,portBusy:busy,disable,enable,bootout,bootstrap,
  waitPortFree,waitHealthy,port
}: LifecycleOperations){
  const decision=serviceActionDecision(action,{registered:running,portBusy:busy});
  if(decision==="PORT_IN_USE"||decision==="FOREGROUND_IN_USE")
    failure("FOREGROUND_OR_OTHER_LISTENER_ACTIVE: port "+port+
      " already in use; refusing to start competing service");
  if(action==="stop"){
    if(running)await bootout();
    await disable();
    const freed=running?await waitPortFree():!busy;
    return {result:decision==="STOP"?"STOPPED":"ALREADY_STOPPED",
      loginAutostart:"disabled",portReleased:freed,
      foregroundInstanceUntouched:!running&&busy};
  }
  if(decision==="ALREADY_RUNNING")return {result:decision};
  if(decision==="RESTART"){
    await bootout();
    if(!await waitPortFree()){
      await disable();
      failure("SERVICE_RESTART_PORT_NOT_RELEASED");
    }
  }
  await enable();
  try{await bootstrap();}catch(e){
    await disable();throw e;
  }
  if(!await waitHealthy()){
    try{await bootout();}catch{ /* job may already have exited */ }
    await disable();
    failure("SERVICE_START_HEALTH_TIMEOUT_ROLLED_BACK");
  }
  return {result:decision==="RESTART"?"RESTARTED":"STARTED",
    loginAutostart:"enabled",health:"ok"};
}
async function manage(info: ServiceInfo,action: string,uid: number,home: string,entry: string){
  if(process.platform!=="darwin")failure("BACKGROUND_SERVICE_UNSUPPORTED_USE_RUN");
  if(action==="install"){
    if(info.kind==="live")failure("ALREADY_INSTALLED_NO_OVERWRITE");
    const created=await serviceCommand("install",{
      home,entry,configFile:defaultSetupPath(home)});
    // An installed LaunchAgent does not start again at login until the
    // owner explicitly invokes start; install is not implicit consent.
    await setAutostart(info.label,uid,false);
    return {...created,loginAutostart:"disabled"};
  }
  if(!info.installed)failure("SERVICE_NOT_INSTALLED");
  const running=await registered(info.label,uid);
  const env=await envFor(info,home);
  const port=Number(env.MAC_MCP_PROJECT_PORT);
  if(!goodPort(port))failure("INVALID_SERVICE_PORT");
  const busy=!(await available(port));
  const result=await executeServiceLifecycle(action,{
    registered:running,portBusy:busy,port,
    disable:()=>setAutostart(info.label,uid,false),
    enable:()=>setAutostart(info.label,uid,true),
    bootout:()=>launch("bootout",uid,info.plist),
    bootstrap:()=>launch("bootstrap",uid,info.plist),
    waitPortFree:()=>waitUntilFree(port),
    waitHealthy:()=>waitForHealthy(port)
  });
  if(result.result==="ALREADY_RUNNING")
    return {...result,health:(await currentStatus(info,uid,home)).health};
  return result;
}
async function logs(info: ServiceInfo,lines: number,uid: number){
  if(!isSafeInteger(lines)||lines<1||lines>200)failure("INVALID_LINES");
  let output="";
  for(const p of info.files){
    if(typeof p!=="string"||!path.isAbsolute(p))continue;
    if(!await owned(p,uid))continue;
    const stdout=(await readFile(p,"utf8")).split("\n").slice(-lines-1).join("\n");
    // Only print to the owner's own terminal; no remote log upload.
    output+="== "+p+" ==\n"+stdout;
  }
  return output||"No logs yet.\n";
}
async function runForeground(info: ServiceInfo,options: CliOptions,home: string,entry: string,uid: number): Promise<number>{
  // App-managed foreground is still this exact CLI/Core, not a second
  // execution engine. Bind the run to its *actual* immediate GUI parent.
  const appParent=options.appParentPid;
  if(appParent!==undefined&&(
      !isSafeInteger(appParent)||appParent<=1||
      process.ppid!==appParent))failure("APP_PARENT_IDENTITY_MISMATCH");
  const env=await envFor(info,home);
  const configuredPort=Number(env.MAC_MCP_PROJECT_PORT);
  const port=options.port??configuredPort;
  if(!goodPort(port))failure("INVALID_PORT");
  // Setup is the user's durable 0600 product configuration. An ad hoc
  // --port must never make App status/topology disagree with the real Core.
  if(info.kind==="setup"&&port!==configuredPort)
    failure("SETUP_PORT_OVERRIDE_DENIED_RECONFIGURE");
  // The atomic owner lease arbitrates CLI vs App, not the local 8793
  // listener. No second Gateway is ever spawned while the lease is held.
  const control=await acquireControl(port,{
    launcher:appParent===undefined?"cli":"app",root:options.controlRoot
  });
  try {
  if(!await available(port))
    failure("PORT_IN_USE: a Gateway or unknown local listener already uses this port");
  env.MAC_MCP_PROJECT_PORT=String(port);
  if(info.kind==="setup"){
    env.MAC_MCP_INTERNAL_SETUP_OWNER_PID=String(process.pid);
    env.MAC_MCP_INTERNAL_SETUP_RUN_ID=control.owner.runId;
    env.MAC_MCP_INTERNAL_SETUP_TOKEN=control.owner.token;
  }
  // Legacy configuration supplies settings only, never a different executable.
  const args=info.kind==="live"?[process.execPath,path.join(packageRoot,"src","dc-workspace-http.mjs")]:[
    process.execPath,entry,"start-setup"];
  const cwd=packageRoot;
  await owned(args[1]!, uid,true);
  await access(cwd);
  const identity=await runtimeIdentity();
  const details={...identity,configSource:info.kind==="live"?info.plist:defaultSetupPath(home),port};
  const structured=options.json===true||appParent!==undefined;
  process.stdout.write(structured?JSON.stringify({event:"GATEWAY_FOREGROUND_START",
    ...details,mode:info.kind,stop:"Ctrl+C",existingService:"untouched"})+"\n":formatStartup(details));
  // Do not pass unrelated credentials from the operator's shell.
  const inherited: NodeJS.ProcessEnv={};
  for(const key of childEnvKeys){
    if(typeof process.env[key]==="string")inherited[key]=process.env[key]!;
  }
  if(process.env.MAC_MCP_ACCESS_FILE)env.MAC_MCP_ACCESS_FILE=process.env.MAC_MCP_ACCESS_FILE;
  const child=spawn(args[0]!,args.slice(1),{
    cwd,env:{...inherited,...env},stdio:windows?["inherit","inherit","inherit","ipc"]:"inherit"});
  const stopChild=(signal:NodeJS.Signals)=>{
    if(child.exitCode!==null)return;
    if(windows&&child.connected)child.send({type:"gateway-stop"},()=>{});
    else child.kill(signal);
  };
  const exited=new Promise(resolve=>child.once("exit",()=>resolve(true)));
  control.onStop(async()=>{
    stopChild("SIGTERM");
    const ended=await Promise.race([
      exited,new Promise(resolve=>{setTimeout(()=>resolve(false),8000).unref();})
    ]);
    if(!ended)return "STOP_FAILED";
    return await waitUntilFree(port,14)?"STOPPED":"STOP_FAILED";
  });
  control.markRunning();
  return await new Promise<number>((resolve,reject)=>{
    const interrupt=()=>{stopChild("SIGINT");};
    const terminate=()=>{stopChild("SIGTERM");};
    process.on("SIGINT",interrupt);process.on("SIGTERM",terminate);
    // A force-quit/crash of the menu-bar App must not orphan the owned Core.
    // Never monitor, signal or adopt any external listener. This check is
    // activated only by --app-parent-pid; manual CLI Ctrl+C is unchanged.
    const parentWatch=appParent===undefined?null:setInterval(()=>{
      if(process.ppid!==appParent){terminate();}
    },400);
    parentWatch?.unref();
    const cleanup=()=>{
      process.off("SIGINT",interrupt);process.off("SIGTERM",terminate);
      if(parentWatch)clearInterval(parentWatch);
    };
    child.once("error",e=>{cleanup();reject(e);});
    child.once("exit",(code,signal)=>{
      cleanup();
      process.stdout.write(structured?JSON.stringify({event:"GATEWAY_FOREGROUND_STOP",code,signal})+"\n":
        `\n  Core exited (${signal??code??"unknown"}).\n`);
      control.markStopped();
      resolve(code===null?(signal==="SIGINT"?130:1):code);
    });
  });
  } finally {
    await control.release();
  }
}
export function parseArgs(argv: string[]){
  const action=argv[0]||"help";
  const options: CliOptions={};
  for(let i=1;i<argv.length;i++){
    const option=argv[i]!;
    if(option==="--json"&&["status","run"].includes(action)){
      if(options.json)failure("DUPLICATE_JSON_OPTION");
      options.json=true;continue;
    }
    if(option==="--all"&&action==="privacy"){
      options.all=true;continue;
    }
    const v=argv[++i];
    if(v===undefined)failure("MISSING_OPTION_VALUE");
    if(option==="--profile"&&["live","setup","auto"].includes(v)){
      options.profile=v;
    }else if(option==="--port"&&["run","stop","status"].includes(action)&&goodPort(Number(v))){
      options.port=Number(v);
    }else if(option==="--app-parent-pid"&&action==="run"&&
        /^[1-9][0-9]*$/.test(v)&&isSafeInteger(Number(v))){
      options.appParentPid=Number(v);
    }else if(option==="--target"&&action==="privacy"&&path.isAbsolute(v)&&
        !v.includes("\0")){
      options.target=v;
    }else if(option==="--lines"&&action==="logs"&&
        isInteger(Number(v))&&Number(v)>=1&&Number(v)<=200){
      options.lines=Number(v);
    }else failure("INVALID_OPTION");
  }
  return {action,options};
}
export async function operatorCommand(action: string,options: CliOptions={}): Promise<CliResult>{
  supportedHost();
  if(process.getuid?.()===0)failure("DO_NOT_RUN_AS_ROOT");
  const home=options.home||homedir(),uid=process.getuid?.()??0;
  const info=await locate(home,uid,options.profile||"auto");
  const entry=options.entry??cliEntry();
  if(action==="status"){
    const result=await currentStatus(info,uid,home,options.port);
    const port=options.port??result.port??8793;
    let controller=null;
    try{controller=await connectOwner(port,{root:options.controlRoot});}
    catch { /* An unrecognized or stale local owner never grants stop rights. */ }
    return {event:"GATEWAY_STATUS",...result,
      coreControl:controller?.result.result??"unavailable",
      coreLauncher:controller?.owner.launcher??"unknown",
      coreOwnerPid:controller?.owner.pid??null};
  }
  if(action==="logs")return {event:"GATEWAY_LOGS",
    output:await logs(info,options.lines??60,uid)};
  if(action==="privacy"){
    if(process.platform!=="darwin")failure("PRIVACY_DIAGNOSTICS_MACOS_ONLY");
    const env=await envFor(info,home);
    const {privacyReport}=await import("./privacy-diagnostics.js");
    return privacyReport({port:Number(env.MAC_MCP_PROJECT_PORT),home,
      all:options.all===true,target:options.target??null});
  }
  if(action==="run")return {event:"GATEWAY_RUN_EXIT",
    code:await runForeground(info,options,home,entry,uid)};
  if(action==="stop"){
    const status=await currentStatus(info,uid,home,options.port);
    const port=options.port??status.port??8793;
    const control=await globalStop(port,{root:options.controlRoot});
    if(control.result==="NO_CONTROL_OWNER"){
      if(!await available(port))failure("CORE_STOP_REFUSED_UNKNOWN_LISTENER");
      return {event:"GATEWAY_CORE",result:"ALREADY_STOPPED",port};
    }
    if(!await waitUntilFree(port,12))
      failure("CORE_STOP_UNVERIFIED_PORT_STILL_OCCUPIED");
    return {event:"GATEWAY_CORE",...control,port};
  }
  if(["install","start","restart"].includes(action))
    failure("SERVICE_MODE_DEFERRED");
  failure("INVALID_ACTION");
}
