import {ownedByUser,createPrivateDirectory,controlRoot,windows} from "./platform.js";
import { ownerSchema } from "./config-schemas.js";
import { GatewayError,errorCode,isSafeInteger,parseJSON,record } from "./validation.js";
type ControlPaths=ReturnType<typeof controlPaths>;
type Owner=ReturnType<typeof ownerSchema.parse>;
interface ControlReply {result:string;runId:string;launcher:string}
// One Core / two equal frontends. Owner-only local supervisor control.
// The socket is never an MCP/public endpoint, and never signals a discovered PID.
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

function proof(token:string,value:string){return crypto.createHmac("sha256",token).update(value).digest("hex");}
function deny(reason: string): never {const e=new GatewayError(reason);throw e;};
const validPort=(p: unknown): p is number=>isSafeInteger(p)&&p>=1024&&p<=65535;
export function controlPaths(port: number,root=controlRoot()){
  if(!validPort(port))deny("CORE_INVALID_PORT");
  const lock=path.join(root,`core-${port}.lease`);
  return {root,lock,recovery:lock+".recovery",
    meta:path.join(lock,"owner.json"),socket:windows?`\\\\.\\pipe\\starmux-${crypto.createHash("sha256").update(path.resolve(lock).toLowerCase()).digest("hex").slice(0,32)}`:path.join(lock,"control.sock")};
}
function secureDir(p: string,create=false){
  if(create)createPrivateDirectory(p);
  const st=fs.lstatSync(p);
  if(!st.isDirectory()||st.isSymbolicLink()||!ownedByUser(p,st,true))deny("CORE_CONTROL_DIRECTORY_UNTRUSTED");
}
function secureFile(p: string,type: string){
  const st=fs.lstatSync(p);
  if(st.isSymbolicLink()||!ownedByUser(p,st,true)||
     !(type==="file"?st.isFile():st.isSocket()))
       deny("CORE_CONTROL_FILE_UNTRUSTED");
}
function readOwner(paths: ControlPaths){
  secureDir(paths.root);secureDir(paths.lock);
  secureFile(paths.meta,"file");
  const d=fs.readFileSync(paths.meta);
  if(d.length>1024)deny("CORE_CONTROL_METADATA_INVALID");
  const checked=ownerSchema.safeParse(parseJSON(d.toString("utf8")));
  if(!checked.success)deny("CORE_CONTROL_METADATA_INVALID");
  const owner=checked.data;
  if(owner.port!==Number(path.basename(paths.lock).match(/\d+/)?.[0])||
     !isSafeInteger(owner.pid)||owner.pid<2||
     !/^[a-f0-9]{48}$/.test(owner.token)||
     !["cli","app"].includes(owner.launcher)||
     !/^[a-f0-9]{32}$/.test(owner.runId))deny("CORE_CONTROL_METADATA_INVALID");
  return owner;
}
async function exchange(paths: ControlPaths,owner: Owner,method: "status"|"stop",timeoutMs=11500){
  if(!windows)secureFile(paths.socket,"socket");
  return await new Promise<ControlReply>((resolve,reject)=>{
    let body="",done=false;
    const client=net.createConnection(paths.socket);
    const nonce=crypto.randomBytes(24).toString("hex");
    const timer=setTimeout(()=>finish(Error("CORE_CONTROL_TIMEOUT")),timeoutMs);
    const finish=(error: unknown,result?: ControlReply)=>{
      if(done)return;done=true;clearTimeout(timer);client.destroy();
      if(error)reject(error);else resolve(result!);
    };
    client.once("connect",()=>client.write(JSON.stringify({
      version:1,...(windows?{nonce,proof:proof(owner.token,nonce+":"+owner.runId+":"+method)}:{token:owner.token}),runId:owner.runId,method})+"\n"));
    client.on("data",d=>{
      body+=d.toString("utf8");
      if(body.length>2048)return finish(Error("CORE_CONTROL_REPLY_TOO_LARGE"));
      if(!body.includes("\n"))return;
      try{
        const reply=record(parseJSON(body.split("\n")[0]!));
        if(windows&&reply.proof!==proof(owner.token,nonce+":"+String(reply.result)))throw Error("CORE_CONTROL_REPLY_UNAUTHENTICATED");
        if(reply.runId!==owner.runId||!["RUNNING","STARTING","STOPPED",
             "STOP_FAILED"].includes(String(reply.result)))throw Error("CORE_CONTROL_REPLY_INVALID");
        finish(null,{result:String(reply.result),runId:owner.runId,launcher:owner.launcher});
      }catch(e){finish(e);}
    });
    client.once("error",e=>finish(e));
    client.once("end",()=>{if(!done)finish(Error("CORE_CONTROL_EOF"));});
  });
}
function alive(pid: number){
  try{process.kill(pid,0);return true;}catch(e){return errorCode(e)==="EPERM";}
}
function cleanStale(paths: ControlPaths){
  try{fs.mkdirSync(paths.recovery,{mode:0o700});}
  catch(e){if(errorCode(e)==="EEXIST")deny("CORE_CONTROL_RECOVERY_BUSY");throw e;}
  try{
    secureDir(paths.root);secureDir(paths.recovery);secureDir(paths.lock);
    let owner;
    try{owner=readOwner(paths);}
    catch(e){
      // Only truly missing metadata is recoverable; malformed metadata is
      // untrusted and must never justify deleting another running owner.
      if(errorCode(e)!=="ENOENT")throw e;
      const age=Date.now()-fs.lstatSync(paths.lock).mtimeMs;
      if(age<2500)deny("CORE_CONTROL_STARTING");
    }
    if(owner&&alive(owner.pid))deny("CORE_CONTROL_OWNER_ACTIVE_OR_UNREACHABLE");
    const names=fs.readdirSync(paths.lock);
    if(names.some(n=>!["owner.json","control.sock"].includes(n)))
      deny("CORE_CONTROL_UNKNOWN_FILES");
    for(const n of names){
      const item=path.join(paths.lock,n);
      const st=fs.lstatSync(item);
      if(!ownedByUser(item,st,true)||st.isDirectory())
        deny("CORE_CONTROL_STALE_UNTRUSTED");
      fs.unlinkSync(item);
    }
    fs.rmdirSync(paths.lock);
  }finally{
    try{fs.rmdirSync(paths.recovery);}catch{}
  }
}
export async function connectOwner(port: number,{root}: {root?: string|undefined}={}){
  const paths=controlPaths(port,root);
  let owner;
  try{owner=readOwner(paths);}
  catch(e){
    if(["ENOENT"].includes(errorCode(e)||""))return null;
    throw e;
  }
  const result=await exchange(paths,owner,"status",1500);
  return {owner,result};
}
export async function globalStop(port: number,{root}: {root?: string|undefined}={}){
  const paths=controlPaths(port,root);
  let owner;
  try{owner=readOwner(paths);}catch(e){
    if(errorCode(e)==="ENOENT")return {result:"NO_CONTROL_OWNER"};
    throw e;
  }
  const result=await exchange(paths,owner,"stop");
  if(result.result!=="STOPPED")deny("CORE_STOP_UNVERIFIED");
  return {result:"STOPPED",launcher:owner.launcher,ownerPid:owner.pid};
}
export async function acquireControl(port: number,{root,launcher="cli"}: {root?: string|undefined; launcher?: "cli"|"app"}={}){
  if(!["cli","app"].includes(launcher))deny("CORE_LAUNCHER_INVALID");
  const paths=controlPaths(port,root);
  secureDir(paths.root,true);
  for(let attempt=0;attempt<12;attempt++){
    try{fs.mkdirSync(paths.lock,{mode:0o700});break;}
    catch(e){
      if(errorCode(e)!=="EEXIST")throw e;
      try{
        const live=await connectOwner(port,{root});
        if(live)deny("CORE_ALREADY_RUNNING");
      }catch(error){
        if(errorCode(error)==="CORE_ALREADY_RUNNING")throw error;
        const owner=(()=>{try{return readOwner(paths);}catch{return null;}})();
        if(owner&&alive(owner.pid))deny("CORE_CONTROL_OWNER_ACTIVE_OR_UNREACHABLE");
      }
      try{cleanStale(paths);}
      catch(e){
        if(!["CORE_CONTROL_STARTING","CORE_CONTROL_RECOVERY_BUSY"].includes(errorCode(e)||""))throw e;
        await delay(250);
      }
    }
    if(attempt===11)deny("CORE_CONTROL_CLAIM_TIMEOUT");
  }
  secureDir(paths.lock);
  const owner={version:1,port,pid:process.pid,launcher,
    token:crypto.randomBytes(24).toString("hex"),
    runId:crypto.randomBytes(16).toString("hex")};
  fs.writeFileSync(paths.meta,JSON.stringify(owner),{mode:0o600,flag:"wx"});
  let onStop: (()=>Promise<string>)|null=null,phase="STARTING";
  const clients=new Set<net.Socket>();
  const server=net.createServer(socket=>{
    clients.add(socket);socket.setTimeout(12000,()=>socket.destroy());
    socket.once("close",()=>clients.delete(socket));
    let raw="";
    socket.on("data",async chunk=>{
      raw+=chunk.toString("utf8");
      if(raw.length>2048){socket.destroy();return;}
      if(!raw.includes("\n"))return;
      const line=raw.split("\n")[0];raw="";
      let request;
      try{request=record(parseJSON(line!));}catch{socket.destroy();return;}
      if(request.version!==1||
         (windows?typeof request.nonce!=="string"||request.nonce.length!==48||request.proof!==proof(owner.token,request.nonce+":"+owner.runId+":"+String(request.method)):request.token!==owner.token)||
         request.runId!==owner.runId){socket.destroy();return;}
      let result="STOP_FAILED";
      if(request.method==="status")result=phase;
      else if(request.method==="stop"&&onStop){
        try{result=await onStop();}catch{result="STOP_FAILED";}
      }
      socket.end(JSON.stringify({result,runId:owner.runId,launcher:owner.launcher,...(windows?{proof:proof(owner.token,String(request.nonce)+":"+result)}:{})})+"\n");
    });
  });
  try{
    await new Promise<void>((resolve,reject)=>{
      server.once("error",reject);
      server.listen(paths.socket,()=>{server.removeListener("error",reject);resolve();});
    });
    if(!windows)fs.chmodSync(paths.socket,0o600);
    if(!windows)secureFile(paths.socket,"socket");
  }catch(e){
    server.close();
    try{fs.unlinkSync(paths.meta);}catch{}
    try{fs.unlinkSync(paths.socket);}catch{}
    try{fs.rmdirSync(paths.lock);}catch{}
    throw e;
  }
  let closing=false;
  return {
    owner,
    markRunning(){phase="RUNNING";},
    markStopped(){phase="STOPPED";},
    onStop(fn: ()=>Promise<string>){onStop=fn;},
    async release(){
      if(closing)return;closing=true;
      // Response sockets close before the lease disappears.
      await new Promise(resolve=>{
        server.close(resolve);
        setTimeout(()=>{for(const s of clients)s.destroy();},1200).unref();
      });
      if(readOwner(paths).runId!==owner.runId)
        deny("CORE_CONTROL_LEASE_CHANGED");
      // node:net automatically unlinks a Unix socket on server.close().
      // A second unlink is not required and must not abort lease cleanup.
      try{if(!windows)fs.unlinkSync(paths.socket);}
      catch(e){if(errorCode(e)!=="ENOENT")throw e;}
      fs.unlinkSync(paths.meta);
      fs.rmdirSync(paths.lock);
    }
  };
}

// Private worker handoff for the setup profile. This is a same-UID
// supervisor identity check, not an OS boundary against the local owner.
export function verifyInternalSetupWorker({port,ownerPid,runId,token}: {port:number; ownerPid:unknown; runId:unknown; token:unknown}){
  const paths=controlPaths(port);
  const owner=readOwner(paths);
  if(!isSafeInteger(ownerPid)||ownerPid<2||
     process.ppid!==ownerPid||owner.pid!==ownerPid||
     owner.port!==port||owner.runId!==runId||owner.token!==token)
    deny("CORE_SETUP_WORKER_NOT_SUPERVISED");
  return true;
}
