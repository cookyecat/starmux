import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {createServer,createConnection,type Server} from 'node:net';
import {fork,type ChildProcess} from 'node:child_process';
import {mkdir,rm,rmdir} from 'node:fs/promises';
import {finished as streamFinished} from 'node:stream/promises';
import {createProcessLog} from './process-log.js';
import {setTimeout as pause} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {homedir} from 'node:os';
import type {z} from 'zod';
import {INSTANCE_CONTROL_VERSION,instanceOwnerSchema,activeConfigSchema,runtimeStateSchema,controlRequestSchema,controlReplySchema,checkInstanceProtocol,type ActiveConfig,type RuntimeState} from './instance-control-protocol.js';
export type {ActiveConfig,RuntimeState} from './instance-control-protocol.js';
import {controlRoot,controlSocket,controlSocketRoot,sameFile,createPrivateDirectory,childEnvKeys,windows} from './platform.js';
import {acquireControl,inspectControlOwner} from './global-core-control.js';
import {runtimeIdentity} from './runtime-identity.js';
import {atomicPrivate,changeRegistry,availablePort,ensureAccessReady,exists,instanceEnv,instancePaths,loadInstanceConfig,prepareUpstreams,prepareMiddlewares,readTrusted,resolveInstance,type Instance,type InstanceConfig} from './instance-store.js';

type Owner=z.infer<typeof instanceOwnerSchema>;
export function runtimePaths(id:string){
  const root=path.join(controlRoot(),'i-'+id);const socket=controlSocket(root);
  return {root,socket,meta:path.join(root,'owner.json')};
}
const signature=(key:string,message:string)=>createHmac('sha256',key).update(message).digest('hex');
function equal(a:unknown,b:string){return typeof a==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
function alive(pid:number){try{process.kill(pid,0);return true;}catch(e){return (e as NodeJS.ErrnoException).code!=='ESRCH';}}
async function ownerFor(instance:Instance){
  const p=runtimePaths(instance.id);if(!await exists(p.root))return null;
  const raw:unknown=JSON.parse(await readTrusted(p.meta));checkInstanceProtocol(raw);
  const owner=instanceOwnerSchema.parse(raw);
  if(owner.instanceId!==instance.id)throw Error('INSTANCE_CONTROL_IDENTITY_INVALID');return owner;
}
async function exchange(instance:Instance,owner:Owner,method:'status'|'stop'|'apply',revision?:string,timeoutMs=method==='apply'?65000:2000,forceId?:string){
  const nonce=randomBytes(24).toString('hex');
  const body=JSON.stringify({protocolVersion:INSTANCE_CONTROL_VERSION,method,revision:revision??null,...(forceId?{forceId}:{}),runId:owner.runId,nonce});
  return new Promise<z.infer<typeof controlReplySchema>>((resolve,reject)=>{
    const socket=createConnection(runtimePaths(instance.id).socket);let raw='';
    const timer=setTimeout(()=>socket.destroy(Error('INSTANCE_CONTROL_TIMEOUT')),timeoutMs);
    socket.once('close',()=>clearTimeout(timer));
    socket.on('error',reject);socket.on('connect',()=>socket.end(JSON.stringify({body,proof:signature(owner.token,body)})+'\n'));
    socket.on('data',data=>{raw+=String(data);if(raw.length>524288)socket.destroy(Error('INSTANCE_CONTROL_REPLY_TOO_LARGE'));});
    socket.on('end',()=>{void (async()=>{try{
      const reply=JSON.parse(raw) as {body:string;proof:string};
      if(typeof reply.body!=='string'||!equal(reply.proof,signature(owner.token,nonce+reply.body)))throw Error('INSTANCE_CONTROL_REPLY_UNTRUSTED');
      const parsed:unknown=JSON.parse(reply.body);checkInstanceProtocol(parsed);
      const data=controlReplySchema.parse(parsed);
      if(data.error)throw Error(data.error);
      if(data.state.instanceId!==instance.id)throw Error('INSTANCE_CONTROL_IDENTITY_CHANGED');
      if(data.state.runId!==owner.runId){
        // Only a successful authenticated apply may advance the run generation.
        // Confirm it against the private owner record, never just a reply field.
        const current=method==='apply'?await ownerFor(instance):null;
        if(!current||current.runId!==data.state.runId||current.pid!==owner.pid||current.token!==owner.token)
          throw Error('INSTANCE_CONTROL_IDENTITY_CHANGED');
      }
      if(data.result!==(method==='stop'?'STOP_ACCEPTED':'STATE'))throw Error('INSTANCE_CONTROL_REPLY_INVALID');
      resolve(data);
    }catch(e){reject(e);}})();});
  });
}
export async function instanceRequest(instance:Instance,method:'status'|'apply',revision?:string,forceId?:string):Promise<RuntimeState|null>{
  const owner=await ownerFor(instance);if(!owner||!alive(owner.pid))return null;
  return (await exchange(instance,owner,method,revision,method==='apply'?65000:2000,forceId)).state;
}
async function snapshot<S extends z.ZodTypeAny>(file:string,schema:S):Promise<z.output<S>|null>{
  try{return schema.parse(JSON.parse(await readTrusted(file)));}catch{return null;}
}
export async function instanceStatus(instance:Instance,home=homedir()){
  let runtime:RuntimeState|null=null;let runtimeProblem:string|null=null;let owner:Owner|null=null;
  try{owner=await ownerFor(instance);if(owner&&alive(owner.pid))runtime=(await exchange(instance,owner,'status')).state;}
  catch(e){runtimeProblem=(e as Error).message;}
  let loaded:Awaited<ReturnType<typeof loadInstanceConfig>>|null=null;let configProblem:string|null=null;
  try{loaded=await loadInstanceConfig(instance);}catch(e){configProblem=(e as Error).message;}
  const saved:ActiveConfig|null=loaded?{config:loaded.config,revision:loaded.revision,effectiveRevision:loaded.effectiveRevision,sourcePath:loaded.source.path}:null;
  const snapshots=instancePaths(instance,home).snapshots;
  const lastRun=await snapshot(path.join(snapshots,'last-runtime.json'),runtimeStateSchema);
  const lastActive=await snapshot(path.join(snapshots,'active.json'),activeConfigSchema);
  let health='not-running';let accessMode:string|null=null;let lastToolCallAt:string|null=null;
  if(!runtime&&!runtimeProblem){
    // Historical ports are hints for detecting a lost control channel, never
    // authority to stop a process or claim a configuration is currently active.
    const ports=new Set([owner?.port,saved?.config.port,lastActive?.config.port].filter((p):p is number=>p!==undefined));
    for(const port of ports){
      const allowLan=[saved?.config,lastActive?.config].some(config=>config?.port===port&&config.allowLan);
      if(!await availablePort(port,allowLan?'0.0.0.0':'127.0.0.1')){runtimeProblem='INSTANCE_CONTROL_UNAVAILABLE: port '+port+' is in use; ownership is unconfirmed';break;}
      try{
        const lease=inspectControlOwner(port);
        if(lease&&alive(lease.pid)){runtimeProblem='INSTANCE_CONTROL_UNAVAILABLE: live port lease '+port;break;}
      }catch(e){runtimeProblem=(e as Error).message;break;}
    }
  }
  if(runtime?.phase==='running'&&runtime.port){
    try{
      const response=await fetch(`http://127.0.0.1:${runtime.port}/healthz`,{signal:AbortSignal.timeout(1500)});
      const data=await response.json() as {status?:string;instanceId?:string;accessMode?:string};
      health=response.ok&&data.status==='ok'&&data.instanceId===instance.id?'ok':'unrecognized';accessMode=data.accessMode??null;
      if(health==='ok')try{
        const activity=await fetch(`http://127.0.0.1:${runtime.port}/activity.json`,{signal:AbortSignal.timeout(1000)}).then(r=>r.json()) as {lastToolCallAt?:string};
        lastToolCallAt=typeof activity.lastToolCallAt==='string'?activity.lastToolCallAt:null;
      }catch{/* Activity is optional; it must not turn a healthy service into an outage. */}
    }catch{health='unreachable';}
  }
  const active=runtime?.active??null;
  const phase=runtime?.phase??(runtimeProblem?'unknown':'stopped');
  if(phase==='unknown')health='unknown';
  const configState=configProblem?(configProblem.includes('ENOENT')?'missing':'invalid'):runtime?.phase==='running'?(saved?.effectiveRevision===active?.effectiveRevision?'applied':'pending'):'on-next-start';
  return {schemaVersion:1,event:'GATEWAY_STATUS',instanceId:instance.id,name:instance.name,archived:instance.archived,source:instance.source,
    phase,configState,configProblem,runtimeProblem,runtime,saved,lastActive,lastRun,
    port:runtime?.port??saved?.config.port??null,configuredPort:saved?.config.port??null,active,revision:saved?.revision??null,
    health,accessMode,lastToolCallAt,profile:instance.legacy??'setup',installed:false,registered:false,
    label:instance.name,workspaceMode:active?.config.mode??(phase==='stopped'?saved?.config.mode:null)??null,
    writeScope:active?.config.writeScope??(phase==='stopped'?saved?.config.writeScope:null)??null,coreControl:runtime?.phase==='running'?'RUNNING':'unavailable',
    coreLauncher:runtime?.launcher??'unknown',coreOwnerPid:runtime?.pid??null,
    executionMode:runtime?(runtime.executionMode==='background'?'background':'foreground-owned'):phase==='stopped'?'stopped':'unknown',loginAutostart:'disabled',
    connectionState:health==='ok'?(lastToolCallAt?'local-ready-activity-recorded':'local-ready-remote-unverified'):health,requiredAccess:instance.requiredAccess};
}
export async function stopInstance(instance:Instance,home=homedir(),options:{timeoutMs?:number}={}){
  const timeoutMs=options.timeoutMs??65000;
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<=0)throw Error('INSTANCE_STOP_TIMEOUT_INVALID');
  const deadline=Date.now()+timeoutMs;
  const owner=await ownerFor(instance);
  if(!owner||!alive(owner.pid)){
    const status=await instanceStatus(instance,home);
    if(status.phase!=='stopped')throw Error(status.runtimeProblem??'INSTANCE_STOP_UNVERIFIED');
    return {result:'ALREADY_STOPPED' as const,instanceId:instance.id,runId:null,restarted:false};
  }
  await exchange(instance,owner,'stop',undefined,Math.max(1,Math.min(2000,deadline-Date.now())));
  const lastFile=path.join(instancePaths(instance,home).snapshots,'last-runtime.json');
  // The terminal snapshot is committed only after worker/lease/socket cleanup.
  // Do not use a free port or a dead PID alone as proof of successful shutdown.
  while(Date.now()<deadline){
    let current:Owner|null;
    try{current=await ownerFor(instance);}catch(e){
      if((e as NodeJS.ErrnoException).code==='ENOENT'){await pause(25);continue;}throw e;
    }
    const lastRun=await snapshot(lastFile,runtimeStateSchema);
    if(lastRun?.runId===owner.runId&&lastRun.phase==='stopped'&&current?.runId!==owner.runId){
      return {result:'STOPPED' as const,instanceId:instance.id,runId:owner.runId,restarted:current!==null};
    }
    if(lastRun?.runId===owner.runId&&lastRun.phase==='error')throw Error('INSTANCE_STOP_FAILED: '+lastRun.problem);
    await pause(Math.min(50,Math.max(1,deadline-Date.now())));
  }
  throw Error('INSTANCE_STOP_TIMEOUT: cleanup was not confirmed; run starmux doctor');
}
export async function runInstance(instance:Instance,options:{home?:string;appParentPid?:number;json?:boolean;background?:boolean;workerModule?:URL;onReady?:()=>Promise<void>}={}){
  const home=options.home??homedir();const parent=options.appParentPid;
  if(parent!==undefined&&(!Number.isSafeInteger(parent)||parent<2||process.ppid!==parent))throw Error('APP_PARENT_IDENTITY_MISMATCH');
  if(instance.archived)throw Error('INSTANCE_ARCHIVED');
  const initial=await loadInstanceConfig(instance);await ensureAccessReady(await resolveInstance(instance.id,home),home);
  const identity=await runtimeIdentity();
  const p=runtimePaths(instance.id);createPrivateDirectory(controlRoot());
  const owner:Owner={protocolVersion:INSTANCE_CONTROL_VERSION,port:initial.config.port,instanceId:instance.id,runId:randomBytes(16).toString('hex'),pid:process.pid,token:randomBytes(32).toString('hex'),launcher:parent?'app':'cli',appParentPid:parent??null};
  await changeRegistry(async registry=>{
    const registered=registry.instances.find(i=>i.id===instance.id);
    if(!registered||registered.archived)throw Error('INSTANCE_ARCHIVED_OR_REMOVED');
  try{await mkdir(p.root,{mode:0o700});}catch(e){
    if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
    const old=await ownerFor(instance);if(!old||alive(old.pid))throw Error('INSTANCE_ALREADY_RUNNING_OR_CONTROL_BUSY');
    // Serialise stale recovery independently; never remove a live owner's lease.
    const recovery=p.root+'.recovery';await mkdir(recovery,{mode:0o700});
    try{const check=await ownerFor(instance);if(!check||check.runId!==old.runId||alive(check.pid))throw Error('INSTANCE_CONTROL_CHANGED');
      if(!windows)await rm(p.socket,{force:true});
      await rm(p.root,{recursive:true});await mkdir(p.root,{mode:0o700});
    }finally{await rm(recovery,{recursive:true,force:true});}
  }
  await atomicPrivate(p.meta,JSON.stringify(owner));
  },home);
  const ownsDirectory=sameFile(p.root);
  let ownsMetadata=sameFile(p.meta);
  let updatingIdentity=false;
  let controlTimer:ReturnType<typeof setInterval>|undefined;
  const state:RuntimeState={protocolVersion:INSTANCE_CONTROL_VERSION,instanceId:instance.id,runId:owner.runId,pid:process.pid,launcher:owner.launcher,appParentPid:parent??null,executionMode:options.background?'background':'foreground',phase:'starting',port:null,active:null,problem:null,...identity};
  let worker:ChildProcess|null=null;let portLease:Awaited<ReturnType<typeof acquireControl>>|null=null;let server:Server|null=null;
  let workerLogDone:Promise<void>|null=null;
  let workerLogFailed=false;
  let ending=false;let expectedWorkerExit=false;let sequence:Promise<unknown>=Promise.resolve();
  let applying=false;
  let stopRequest:Promise<void>|null=null;
  const clients=new Set<import('node:net').Socket>();
  let finish!:()=>void;const finished=new Promise<void>(r=>{finish=r;});
  const serialize=<T>(fn:()=>Promise<T>):Promise<T>=>{const next=sequence.then(fn);sequence=next.catch(()=>{});return next;};
  function emit(event:string){
    if(options.json||!options.onReady)process.stdout.write(JSON.stringify({event,...state})+'\n');
    else if(event==='INSTANCE_ERROR'||event==='INSTANCE_APPLY_FAILED')process.stderr.write(`\n${instance.name}: ${state.problem}\nInspect logs: starmux logs -i ${instance.id}\n`);
    else if(event==='INSTANCE_STOPPED')process.stdout.write(`\nStopped ${instance.name}.\n`);
  }
  async function stopWorker(){
    const child=worker;if(!child)return;expectedWorkerExit=true;
    await new Promise<void>((resolve,reject)=>{
      if(child.exitCode!==null||child.signalCode!==null){resolve();return;}
      let forced=false;
      const finish=(error?:Error)=>{clearTimeout(grace);clearTimeout(deadline);child.off('close',exited);child.off('error',failed);error?reject(error):resolve();};
      const exited=()=>{if(forced)state.problem='WORKER_STOP_FORCED';finish();};
      const failed=(error:Error)=>finish(error);
      const grace=setTimeout(()=>{forced=true;try{child.kill('SIGKILL');}catch(e){finish(e as Error);}},8000);
      const deadline=setTimeout(()=>finish(Error('INSTANCE_WORKER_STOP_TIMEOUT')),12000);
      child.once('close',exited);child.once('error',failed);
      if(child.connected)child.send({type:'gateway-stop'},error=>{if(error&&child.exitCode===null&&child.signalCode===null)try{child.kill('SIGTERM');}catch(e){finish(e as Error);}});
      else child.kill('SIGTERM');
    });await workerLogDone;
    if(workerLogFailed)state.problem='INSTANCE_LOG_FAILED';
    workerLogDone=null;worker=null;expectedWorkerExit=false;state.active=null;state.port=null;
  }
  async function shutdown(reason?:string){
    if(ending)return;ending=true;state.problem=reason??null;state.phase='stopping';await stopWorker();
    await portLease?.release();portLease=null;state.port=null;finish();
  }
  function requestStop(reason?:string){
    if(!stopRequest){
      stopRequest=serialize(()=>shutdown(reason));
      void stopRequest.catch(async error=>{
        state.phase='error';state.problem='INSTANCE_STOP_FAILED: '+(error as Error).message;emit('INSTANCE_ERROR');
        try{await atomicPrivate(path.join(instancePaths(instance,home).snapshots,'last-runtime.json'),JSON.stringify(state));}catch{}
      });
    }
    return stopRequest;
  }
  let localApplySupported=false;
  async function startWorker(config:ActiveConfig,lease:Awaited<ReturnType<typeof acquireControl>>,announce=true){
    await ensureAccessReady(await resolveInstance(instance.id,home),home);
    if(!await availablePort(config.config.port,config.config.allowLan?'0.0.0.0':'127.0.0.1'))throw Error('PORT_IN_USE: '+config.config.port);
    const env:NodeJS.ProcessEnv={};for(const key of childEnvKeys)if(process.env[key])env[key]=process.env[key]!;
    Object.assign(env,instanceEnv(instance,config.config,home),{STARMUX_INTERNAL_SETUP_OWNER_PID:String(process.pid),STARMUX_INTERNAL_SETUP_RUN_ID:lease.owner.runId,STARMUX_INTERNAL_SETUP_TOKEN:lease.owner.token});
    const middlewareFile=await prepareMiddlewares(instance,config.config,home);if(middlewareFile)env.STARMUX_MIDDLEWARES_FILE=middlewareFile;
    const upstreamFile=await prepareUpstreams(instance,config.config,home);if(upstreamFile)env.STARMUX_UPSTREAMS_FILE=upstreamFile;
    const log=path.join(instancePaths(instance,home).logs,'core.log');
    const output=await createProcessLog(log);
    let child:ChildProcess;
    try{child=fork(fileURLToPath(options.workerModule??new URL('./instance-worker.js',import.meta.url)),[],{env,stdio:['ignore','pipe','pipe','ipc']});}
    catch(error){output.destroy();throw error;}
    worker=child;
    child.stdout!.pipe(output,{end:false});child.stderr!.pipe(output,{end:false});
    child.once('close',()=>output.end());
    workerLogFailed=false;
    // A log failure must not become an unhandled stream error or silently leave
    // a worker blocked behind an unread stdout pipe.
    workerLogDone=streamFinished(output).catch(()=>{
      workerLogFailed=true;
      void requestStop('INSTANCE_LOG_FAILED').catch(()=>{});
    });
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('INSTANCE_START_TIMEOUT')),20000);
      const ready=(message:unknown)=>{if(message&&typeof message==='object'&&'type' in message&&message.type==='gateway-ready'){localApplySupported='localApply' in message&&message.localApply===true;clearTimeout(timer);child.off('exit',failed);child.off('error',failed);child.off('message',ready);resolve();}};
      const failed=()=>{clearTimeout(timer);child.off('message',ready);reject(Error('INSTANCE_START_FAILED: inspect instance logs'));};
      child.once('error',failed);child.once('exit',failed);child.on('message',ready);
    });
    state.active=config;state.permissionMode=env.STARMUX_PERMISSION_MODE==='global'?'global':'workspace';state.port=config.config.port;state.phase='running';lease.markRunning();
    await atomicPrivate(path.join(instancePaths(instance,home).snapshots,'active.json'),JSON.stringify(config,null,2));
    child.once('exit',()=>{if(!expectedWorkerExit&&!ending){state.phase='error';state.problem='INSTANCE_WORKER_EXITED';emit('INSTANCE_ERROR');void requestStop('INSTANCE_WORKER_EXITED');}});
    if(announce)emit('INSTANCE_RUNNING');
  }
  const active=(loaded:typeof initial):ActiveConfig=>({config:loaded.config,revision:loaded.revision,effectiveRevision:loaded.effectiveRevision,sourcePath:loaded.source.path});
  async function apply(revision:string|null,forceId?:string){
    if(ending||stopRequest)throw Error('INSTANCE_STOPPING');
    const current=await resolveInstance(instance.id,home);const next=await loadInstanceConfig(current);
    if(!revision||next.revision!==revision)throw Error('CONFIG_CONFLICT: configuration changed before apply');
    await ensureAccessReady(await resolveInstance(instance.id,home),home);await prepareUpstreams(instance,next.config,home);
    const previous=state.active;if(!previous||!portLease)throw Error('INSTANCE_NOT_RUNNING');
    const stable=(config:InstanceConfig)=>{const {upstreams,middlewares,...rest}=config;return JSON.stringify(rest);};
    if(worker&&localApplySupported&&stable(previous.config)===stable(next.config)){
      const upstreamFile=await prepareUpstreams(instance,next.config,home),middlewareFile=await prepareMiddlewares(instance,next.config,home);
      const child=worker,id=randomBytes(16).toString('hex');
      await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>finish(Error('GATEWAY_APPLY_TIMEOUT: saved configuration remains pending')),60000);
        const reply=(value:unknown)=>{if(!value||typeof value!=='object')return;const m=value as Record<string,unknown>;if(m.type==='gateway-applied'&&m.id===id)finish(m.error?Error(String(m.error)):undefined);};
        const exited=()=>finish(Error('INSTANCE_WORKER_EXITED'));
        const finish=(error?:Error)=>{clearTimeout(timer);child.off('message',reply);child.off('exit',exited);error?reject(error):resolve();};
        child.on('message',reply);child.once('exit',exited);child.send({type:'gateway-apply',id,upstreamFile,middlewareFile,forceId,deadline:Date.now()+55000},error=>{if(error)finish(error);});
      });
      state.active=active(next);state.problem=null;await atomicPrivate(path.join(instancePaths(instance,home).snapshots,'active.json'),JSON.stringify(state.active,null,2));emit('INSTANCE_RUNNING');return;
    }
    const oldLease=portLease;let candidateLease=oldLease;
    if(next.config.port!==previous.config.port){
      if(!await availablePort(next.config.port,next.config.allowLan?'0.0.0.0':'127.0.0.1'))throw Error('PORT_IN_USE: '+next.config.port);
      candidateLease=await acquireControl(next.config.port,{launcher:owner.launcher});candidateLease.onStop(()=>requestStop());
    }
    state.phase='starting';await stopWorker();state.problem=null;
    try{
      await startWorker(active(next),candidateLease,false);portLease=candidateLease;
      if(candidateLease!==oldLease)await oldLease.release();
    }catch(error){
      await stopWorker();if(candidateLease!==oldLease)await candidateLease.release();portLease=oldLease;
      state.problem='APPLY_FAILED_RESTORED: '+(error as Error).message;
      try{await startWorker(previous,oldLease);}catch{
        await stopWorker();state.phase='error';state.problem='APPLY_AND_RESTORE_FAILED: inspect instance logs';
      }
      emit('INSTANCE_APPLY_FAILED');throw Error(state.problem!);
    }
    // A replacement worker is a new run. Keep the supervisor and port lease,
    // but invalidate stale instance-control requests from the previous run.
    updatingIdentity=true;
    try{
      if(!ownsDirectory()||!ownsMetadata())throw Error('INSTANCE_CONTROL_CHANGED');
      const nextOwner={...owner,port:next.config.port,runId:randomBytes(16).toString('hex')};
      await atomicPrivate(p.meta,JSON.stringify(nextOwner));
      Object.assign(owner,nextOwner);state.runId=owner.runId;ownsMetadata=sameFile(p.meta);
    }catch(error){
      void requestStop('INSTANCE_CONTROL_IDENTITY_UPDATE_FAILED');throw error;
    }finally{updatingIdentity=false;}
    emit('INSTANCE_RUNNING');
  }
  const signal=()=>{void requestStop();};
  const parentTimer=parent?setInterval(()=>{if(process.ppid!==parent)signal();},400):null;
  parentTimer?.unref();process.on('SIGTERM',signal);process.on('SIGINT',signal);
  try{
    server=createServer({allowHalfOpen:true},socket=>{
      clients.add(socket);socket.once('close',()=>clients.delete(socket));
      socket.setTimeout(65000,()=>socket.destroy());let raw='';let handled=false;
      socket.on('error',()=>{});socket.on('data',chunk=>{
        if(handled)return;raw+=String(chunk);if(raw.length>8192){socket.destroy();return;}if(!raw.includes('\n'))return;handled=true;
        void (async()=>{
          let nonce='';try{
            const envelope=JSON.parse(raw) as {body:string;proof:string};
            if(typeof envelope.body!=='string'||!equal(envelope.proof,signature(owner.token,envelope.body)))throw Error('CONTROL_DENIED');
            const parsed:unknown=JSON.parse(envelope.body);
            // Recover the nonce before validating the version so an authenticated
            // caller receives an explicit protocol error rather than a bad proof.
            if(parsed&&typeof parsed==='object'&&'nonce' in parsed&&typeof parsed.nonce==='string')nonce=parsed.nonce;
            checkInstanceProtocol(parsed);const req=controlRequestSchema.parse(parsed);
            if(req.runId!==owner.runId)throw Error('CONTROL_DENIED');
            if(req.method==='apply')await serialize(async()=>{
              // Another queued apply may already have replaced this run.
              if(req.runId!==owner.runId)throw Error('CONTROL_DENIED');
              applying=true;
              try{await apply(req.revision,req.forceId);}finally{applying=false;}
            });
            if(req.method==='stop'){
              if(applying)throw Error('INSTANCE_APPLY_IN_PROGRESS: retry stop after configuration applies');
              // Reserve shutdown before acknowledging so a subsequent apply
              // cannot replace the run that this stop request targets.
              void requestStop();
            }
            const body=JSON.stringify({protocolVersion:INSTANCE_CONTROL_VERSION,state,result:req.method==='stop'?'STOP_ACCEPTED':'STATE'});
            socket.end(JSON.stringify({body,proof:signature(owner.token,nonce+body)})+'\n');
          }catch(error){const body=JSON.stringify({protocolVersion:INSTANCE_CONTROL_VERSION,state,result:'STATE',error:(error as Error).message});socket.end(JSON.stringify({body,proof:signature(owner.token,nonce+body)})+'\n');}
        })();
      });
    });
    if(!windows)createPrivateDirectory(controlSocketRoot());
    await new Promise<void>((resolve,reject)=>{server!.once('error',reject);server!.listen(p.socket,()=>resolve());});
    const ownsSocket=windows?()=>true:sameFile(p.socket);
    portLease=await acquireControl(initial.config.port,{launcher:owner.launcher});
    portLease.onStop(()=>requestStop());
    await serialize(()=>startWorker(active(initial),portLease!));
    controlTimer=setInterval(()=>{
      if(!ending&&(!ownsDirectory()||!updatingIdentity&&!ownsMetadata()||!ownsSocket()||portLease&&!portLease.intact()))void requestStop('INSTANCE_CONTROL_FILES_LOST');
    },1000);
    controlTimer.unref();
    if(options.onReady)await options.onReady();
    else if(!options.json)process.stderr.write(`\n${instance.name}: http://127.0.0.1:${state.port}/mcp\nConfig: ${instance.source.path}\nCtrl+C stops this instance.\n`);
    await finished;
  }catch(error){state.phase='error';state.problem=(error as Error).message;throw error;}finally{
    if(controlTimer)clearInterval(controlTimer);
    if(parentTimer)clearInterval(parentTimer);process.off('SIGTERM',signal);process.off('SIGINT',signal);
    try{
      await stopWorker();await portLease?.release();
      if(server)await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>{for(const client of clients)client.destroy();},1500);
        server!.close(error=>{clearTimeout(timer);error?reject(error):resolve();});
      });
      if(ending)state.phase='stopped';
      // Commit completion last. A stop acknowledgement only means accepted;
      // readers require this snapshot AND release of this run's owner record.
      await atomicPrivate(path.join(instancePaths(instance,home).snapshots,'last-runtime.json'),JSON.stringify(state));
      if(await exists(p.root)){
        if(!ownsDirectory())throw Error('INSTANCE_CONTROL_CHANGED');
        try{const current=await ownerFor(instance);if(current&&current.runId!==owner.runId)throw Error('INSTANCE_CONTROL_CHANGED');}
        catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
        await rm(p.meta,{force:true});await rmdir(p.root);
      }
      if(state.phase==='stopped')emit('INSTANCE_STOPPED');
    }catch(error){
      state.phase='error';state.problem='INSTANCE_CLEANUP_FAILED: '+(error as Error).message;
      try{await atomicPrivate(path.join(instancePaths(instance,home).snapshots,'last-runtime.json'),JSON.stringify(state));}catch{}
      throw error;
    }
  }
}
