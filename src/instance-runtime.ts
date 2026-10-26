import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {createServer,createConnection,type Server} from 'node:net';
import {fork,type ChildProcess} from 'node:child_process';
import {mkdir,rm,readFile,open,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {homedir} from 'node:os';
import {z} from 'zod';
import {controlRoot,createPrivateDirectory,childEnvKeys,windows} from './platform.js';
import {acquireControl} from './global-core-control.js';
import {runtimeIdentity} from './runtime-identity.js';
import {atomicPrivate,changeRegistry,availablePort,ensureAccessReady,exists,instanceEnv,instancePaths,loadInstanceConfig,prepareUpstreams,readTrusted,resolveInstance,type Instance,type InstanceConfig} from './instance-store.js';

const metadataSchema=z.object({instanceId:z.string().uuid(),runId:z.string().regex(/^[a-f0-9]{32}$/),pid:z.number().int().min(2),token:z.string().regex(/^[a-f0-9]{64}$/),launcher:z.enum(['cli','app']),appParentPid:z.number().int().nullable()}).strict();
type Owner=z.infer<typeof metadataSchema>;
export type ActiveConfig={config:InstanceConfig;revision:string;effectiveRevision:string;sourcePath:string};
export type RuntimeState={instanceId:string;runId:string;pid:number;launcher:'cli'|'app';appParentPid:number|null;executionMode?:'foreground'|'background';
  phase:'starting'|'running'|'stopping'|'stopped'|'error';port:number|null;active:ActiveConfig|null;problem:string|null;coreProgram:string;buildVersion:string};
function runtimePaths(id:string){
  const root=path.join(controlRoot(),'i-'+id);const socket=windows?'\\\\.\\pipe\\gateway-instance-'+createHash('sha256').update(root).digest('hex').slice(0,28):path.join(root,'control.sock');
  return {root,socket,meta:path.join(root,'owner.json')};
}
const signature=(key:string,message:string)=>createHmac('sha256',key).update(message).digest('hex');
function equal(a:unknown,b:string){return typeof a==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
function alive(pid:number){try{process.kill(pid,0);return true;}catch(e){return (e as NodeJS.ErrnoException).code!=='ESRCH';}}
async function ownerFor(instance:Instance){
  const p=runtimePaths(instance.id);if(!await exists(p.root))return null;
  const owner=metadataSchema.parse(JSON.parse(await readTrusted(p.meta)) as unknown);
  if(owner.instanceId!==instance.id)throw Error('INSTANCE_CONTROL_IDENTITY_INVALID');return owner;
}
export async function instanceRequest(instance:Instance,method:'status'|'stop'|'apply',revision?:string):Promise<RuntimeState|null>{
  const owner=await ownerFor(instance);if(!owner||!alive(owner.pid))return null;
  const nonce=randomBytes(24).toString('hex');const body=JSON.stringify({method,revision:revision??null,runId:owner.runId,nonce});
  return new Promise((resolve,reject)=>{
    const socket=createConnection(runtimePaths(instance.id).socket);let raw='';
    socket.setTimeout(method==='status'?2000:65000,()=>socket.destroy(Error('INSTANCE_CONTROL_TIMEOUT')));
    socket.on('error',reject);socket.on('connect',()=>socket.end(JSON.stringify({body,proof:signature(owner.token,body)})+'\n'));
    socket.on('data',data=>{raw+=String(data);if(raw.length>524288)socket.destroy(Error('INSTANCE_CONTROL_REPLY_TOO_LARGE'));});
    socket.on('end',()=>{try{
      const reply=JSON.parse(raw) as {body:string;proof:string};
      if(!equal(reply.proof,signature(owner.token,nonce+reply.body)))throw Error('INSTANCE_CONTROL_REPLY_UNTRUSTED');
      const data=JSON.parse(reply.body) as {state:RuntimeState;error?:string};
      if(data.error)throw Error(data.error);
      if(data.state.instanceId!==instance.id||data.state.runId!==owner.runId)throw Error('INSTANCE_CONTROL_IDENTITY_CHANGED');
      resolve(data.state);
    }catch(e){reject(e);}});
  });
}
export async function instanceStatus(instance:Instance,home=homedir()){
  let runtime:RuntimeState|null=null;let runtimeProblem:string|null=null;
  try{runtime=await instanceRequest(instance,'status');}catch(e){runtimeProblem=(e as Error).message;}
  let saved:Awaited<ReturnType<typeof loadInstanceConfig>>|null=null;let configProblem:string|null=null;
  try{saved=await loadInstanceConfig(instance);}catch(e){configProblem=(e as Error).message;}
  let lastRuntime:RuntimeState|null=null;
  if(!runtime)try{lastRuntime=JSON.parse(await readTrusted(path.join(instancePaths(instance,home).snapshots,'last-runtime.json'))) as RuntimeState;}catch{}
  if(!runtime&&lastRuntime?.problem)runtimeProblem??=lastRuntime.problem;
  let health='not-running';let accessMode:string|null=null;let lastToolCallAt:string|null=null;
  if(runtime?.phase==='running'&&runtime.port){
    try{
      const response=await fetch(`http://127.0.0.1:${runtime.port}/healthz`,{signal:AbortSignal.timeout(1500)});
      const data=await response.json() as {status?:string;instanceId?:string;accessMode?:string};
      health=response.ok&&data.status==='ok'&&data.instanceId===instance.id?'ok':'unrecognized';accessMode=data.accessMode??null;
      const activity=await fetch(`http://127.0.0.1:${runtime.port}/activity.json`,{signal:AbortSignal.timeout(1000)}).then(r=>r.json()) as {lastToolCallAt?:string};
      lastToolCallAt=typeof activity.lastToolCallAt==='string'?activity.lastToolCallAt:null;
    }catch{health='unreachable';}
  }
  let active=runtime?.active??null;
  if(!active)try{active=JSON.parse(await readTrusted(path.join(instancePaths(instance,home).snapshots,'active.json'))) as ActiveConfig;}catch{}
  const configState=configProblem?(configProblem.includes('ENOENT')?'missing':'invalid'):runtime?.phase==='running'?(saved?.effectiveRevision===active?.effectiveRevision?'applied':'pending'):'on-next-start';
  return {schemaVersion:1,event:'GATEWAY_STATUS',instanceId:instance.id,name:instance.name,archived:instance.archived,source:instance.source,
    phase:runtime?.phase??(runtimeProblem?'error':'stopped'),configState,configProblem,runtimeProblem,runtime,
    port:runtime?.port??saved?.config.port??null,configuredPort:saved?.config.port??null,active,revision:saved?.revision??null,
    health,accessMode,lastToolCallAt,profile:instance.legacy??'setup',installed:false,registered:false,
    label:instance.name,workspaceMode:runtime?.active?.config.mode??saved?.config.mode??null,
    writeScope:runtime?.active?.config.writeScope??saved?.config.writeScope??null,coreControl:runtime?.phase==='running'?'RUNNING':'unavailable',
    coreLauncher:runtime?.launcher??'unknown',coreOwnerPid:runtime?.pid??null,listenerPid:runtime?.pid??null,
    executionMode:runtime?.phase==='running'?(runtime.executionMode==='background'?'background':'foreground-owned'):'stopped',loginAutostart:'disabled',
    connectionState:health==='ok'?(lastToolCallAt?'local-ready-activity-recorded':'local-ready-remote-unverified'):health,requiredAccess:instance.requiredAccess};
}
export async function runInstance(instance:Instance,options:{home?:string;appParentPid?:number;json?:boolean;background?:boolean;workerModule?:URL;onReady?:()=>Promise<void>}={}){
  const home=options.home??homedir();const parent=options.appParentPid;
  if(parent!==undefined&&(!Number.isSafeInteger(parent)||parent<2||process.ppid!==parent))throw Error('APP_PARENT_IDENTITY_MISMATCH');
  if(instance.archived)throw Error('INSTANCE_ARCHIVED');
  const initial=await loadInstanceConfig(instance);await ensureAccessReady(await resolveInstance(instance.id,home),home);
  const p=runtimePaths(instance.id);createPrivateDirectory(controlRoot());
  const owner:Owner={instanceId:instance.id,runId:randomBytes(16).toString('hex'),pid:process.pid,token:randomBytes(32).toString('hex'),launcher:parent?'app':'cli',appParentPid:parent??null};
  await changeRegistry(async registry=>{
    const registered=registry.instances.find(i=>i.id===instance.id);
    if(!registered||registered.archived)throw Error('INSTANCE_ARCHIVED_OR_REMOVED');
  try{await mkdir(p.root,{mode:0o700});}catch(e){
    if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
    const old=await ownerFor(instance);if(!old||alive(old.pid))throw Error('INSTANCE_ALREADY_RUNNING_OR_CONTROL_BUSY');
    // Serialise stale recovery independently; never remove a live owner's lease.
    const recovery=p.root+'.recovery';await mkdir(recovery,{mode:0o700});
    try{const check=await ownerFor(instance);if(!check||check.runId!==old.runId||alive(check.pid))throw Error('INSTANCE_CONTROL_CHANGED');
      await rm(p.root,{recursive:true});await mkdir(p.root,{mode:0o700});
    }finally{await rm(recovery,{recursive:true,force:true});}
  }
  await atomicPrivate(p.meta,JSON.stringify(owner));
  },home);
  const identity=await runtimeIdentity();
  const state:RuntimeState={instanceId:instance.id,runId:owner.runId,pid:process.pid,launcher:owner.launcher,appParentPid:parent??null,executionMode:options.background?'background':'foreground',phase:'starting',port:null,active:null,problem:null,...identity};
  let worker:ChildProcess|null=null;let portLease:Awaited<ReturnType<typeof acquireControl>>|null=null;let server:Server|null=null;
  let ending=false;let expectedWorkerExit=false;let sequence:Promise<unknown>=Promise.resolve();
  let finish!:()=>void;const finished=new Promise<void>(r=>{finish=r;});
  const serialize=<T>(fn:()=>Promise<T>):Promise<T>=>{const next=sequence.then(fn);sequence=next.catch(()=>{});return next;};
  function emit(event:string){
    if(options.json||!options.onReady)process.stdout.write(JSON.stringify({event,...state})+'\n');
    else if(event==='INSTANCE_ERROR'||event==='INSTANCE_APPLY_FAILED')process.stderr.write(`\n${instance.name}: ${state.problem}\nInspect logs: starmux logs -i ${instance.id}\n`);
    else if(event==='INSTANCE_STOPPED')process.stdout.write(`\nStopped ${instance.name}.\n`);
  }
  async function stopWorker(){
    const child=worker;if(!child)return;expectedWorkerExit=true;
    await new Promise<void>(resolve=>{
      if(child.exitCode!==null||child.signalCode!==null){resolve();return;}
      let forced=false;
      const timer=setTimeout(()=>{forced=true;child.kill('SIGKILL');},8000);
      child.once('exit',()=>{clearTimeout(timer);if(forced)state.problem='WORKER_STOP_FORCED';resolve();});
      if(child.connected)child.send({type:'gateway-stop'});else child.kill('SIGTERM');
    });worker=null;expectedWorkerExit=false;
  }
  async function shutdown(reason?:string){
    if(ending)return;ending=true;state.problem=reason??null;state.phase='stopping';await stopWorker();
    await portLease?.release();portLease=null;state.phase='stopped';state.port=null;emit('INSTANCE_STOPPED');finish();
  }
  async function startWorker(config:ActiveConfig,lease:Awaited<ReturnType<typeof acquireControl>>){
    await ensureAccessReady(await resolveInstance(instance.id,home),home);
    if(!await availablePort(config.config.port))throw Error('PORT_IN_USE: '+config.config.port);
    const env:NodeJS.ProcessEnv={};for(const key of childEnvKeys)if(process.env[key])env[key]=process.env[key]!;
    Object.assign(env,instanceEnv(instance,config.config,home),{MAC_MCP_INTERNAL_SETUP_OWNER_PID:String(process.pid),MAC_MCP_INTERNAL_SETUP_RUN_ID:lease.owner.runId,MAC_MCP_INTERNAL_SETUP_TOKEN:lease.owner.token});
    const upstreamFile=await prepareUpstreams(instance,config.config,home);if(upstreamFile)env.MAC_MCP_UPSTREAMS_FILE=upstreamFile;
    const log=path.join(instancePaths(instance,home).logs,'core.log');
    if(await exists(log))await readTrusted(log,true,32*1024*1024);
    const output=await open(log,'a',0o600);
    const child=fork(fileURLToPath(options.workerModule??new URL('./instance-worker.js',import.meta.url)),[],{env,stdio:['ignore',output.fd,output.fd,'ipc']});worker=child;await output.close();
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('INSTANCE_START_TIMEOUT')),20000);
      const ready=(message:unknown)=>{if(message&&typeof message==='object'&&'type' in message&&message.type==='gateway-ready'){clearTimeout(timer);child.off('exit',failed);child.off('error',failed);child.off('message',ready);resolve();}};
      const failed=()=>{clearTimeout(timer);child.off('message',ready);reject(Error('INSTANCE_START_FAILED: inspect instance logs'));};
      child.once('error',failed);child.once('exit',failed);child.on('message',ready);
    });
    state.active=config;state.port=config.config.port;state.phase='running';lease.markRunning();
    await atomicPrivate(path.join(instancePaths(instance,home).snapshots,'active.json'),JSON.stringify(config,null,2));
    child.once('exit',()=>{if(!expectedWorkerExit&&!ending){state.phase='error';state.problem='INSTANCE_WORKER_EXITED';emit('INSTANCE_ERROR');void serialize(()=>shutdown('INSTANCE_WORKER_EXITED'));}});
    emit('INSTANCE_RUNNING');
  }
  const active=(loaded:typeof initial):ActiveConfig=>({config:loaded.config,revision:loaded.revision,effectiveRevision:loaded.effectiveRevision,sourcePath:loaded.source.path});
  async function apply(revision:string|null){
    if(ending)throw Error('INSTANCE_STOPPING');
    const current=await resolveInstance(instance.id,home);const next=await loadInstanceConfig(current);
    if(!revision||next.revision!==revision)throw Error('CONFIG_CONFLICT: configuration changed before apply');
    await ensureAccessReady(await resolveInstance(instance.id,home),home);await prepareUpstreams(instance,next.config,home);
    const previous=state.active;if(!previous||!portLease)throw Error('INSTANCE_NOT_RUNNING');
    const oldLease=portLease;let candidateLease=oldLease;
    if(next.config.port!==previous.config.port){
      if(!await availablePort(next.config.port))throw Error('PORT_IN_USE: '+next.config.port);
      candidateLease=await acquireControl(next.config.port,{launcher:owner.launcher});candidateLease.onStop(async()=>{void serialize(shutdown);return 'STOPPED';});
    }
    state.phase='starting';await stopWorker();state.problem=null;
    try{
      await startWorker(active(next),candidateLease);portLease=candidateLease;
      if(candidateLease!==oldLease)await oldLease.release();
    }catch(error){
      await stopWorker();if(candidateLease!==oldLease)await candidateLease.release();portLease=oldLease;
      state.problem='APPLY_FAILED_RESTORED: '+(error as Error).message;
      try{await startWorker(previous,oldLease);}catch{
        await stopWorker();state.phase='error';state.problem='APPLY_AND_RESTORE_FAILED: inspect instance logs';
      }
      emit('INSTANCE_APPLY_FAILED');throw Error(state.problem!);
    }
  }
  const signal=()=>{void serialize(shutdown);};
  const parentTimer=parent?setInterval(()=>{if(process.ppid!==parent)signal();},400):null;
  parentTimer?.unref();process.on('SIGTERM',signal);process.on('SIGINT',signal);
  try{
    server=createServer({allowHalfOpen:true},socket=>{
      socket.setTimeout(65000,()=>socket.destroy());let raw='';let handled=false;
      socket.on('error',()=>{});socket.on('data',chunk=>{
        if(handled)return;raw+=String(chunk);if(raw.length>8192){socket.destroy();return;}if(!raw.includes('\n'))return;handled=true;
        void (async()=>{
          let nonce='';try{
            const envelope=JSON.parse(raw) as {body:string;proof:string};
            if(typeof envelope.body!=='string'||!equal(envelope.proof,signature(owner.token,envelope.body)))throw Error('CONTROL_DENIED');
            const req=JSON.parse(envelope.body) as {method:string;revision:string|null;runId:string;nonce:string};nonce=req.nonce;
            if(req.runId!==owner.runId||! /^[a-f0-9]{48}$/.test(nonce))throw Error('CONTROL_DENIED');
            if(req.method==='stop')await serialize(shutdown);
            else if(req.method==='apply')await serialize(()=>apply(req.revision));
            else if(req.method!=='status')throw Error('CONTROL_INVALID_METHOD');
            const body=JSON.stringify({state});socket.end(JSON.stringify({body,proof:signature(owner.token,nonce+body)})+'\n');
          }catch(error){const body=JSON.stringify({state,error:(error as Error).message});socket.end(JSON.stringify({body,proof:signature(owner.token,nonce+body)})+'\n');}
        })();
      });
    });
    await new Promise<void>((resolve,reject)=>{server!.once('error',reject);server!.listen(p.socket,()=>resolve());});
    portLease=await acquireControl(initial.config.port,{launcher:owner.launcher});
    portLease.onStop(async()=>{void serialize(shutdown);return 'STOPPED';});
    await serialize(()=>startWorker(active(initial),portLease!));
    if(options.onReady)await options.onReady();
    else if(!options.json)process.stderr.write(`\n${instance.name}: http://127.0.0.1:${state.port}/mcp\nConfig: ${instance.source.path}\nCtrl+C stops this instance.\n`);
    await finished;
  }catch(error){state.phase='error';state.problem=(error as Error).message;throw error;}finally{
    if(parentTimer)clearInterval(parentTimer);process.off('SIGTERM',signal);process.off('SIGINT',signal);
    await stopWorker();await portLease?.release();
    if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));
    await atomicPrivate(path.join(instancePaths(instance,home).snapshots,'last-runtime.json'),JSON.stringify(state));
    const current=await ownerFor(instance);if(current?.runId===owner.runId)await rm(p.root,{recursive:true,force:true});
  }
}
