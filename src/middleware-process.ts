import {callPreview} from './tool-call-log.js';
import {mcpCallContext} from './mcp-call-context.js';
import {fork,type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import type {MiddlewareConfig} from './middleware-config.js';
import type {MiddlewareStage} from './middleware.js';
export class MiddlewareError extends Error {
 constructor(readonly code:string,readonly pluginId:string,readonly stage:string,readonly upstreamExecution:'not_started'|'returned'|'uncertain'='not_started',readonly reason?:string){super(`${code}: plugin=${pluginId}; stage=${stage}; upstream=${upstreamExecution}.${reason?' '+reason.slice(0,500)+'.':''} Do not automatically replay an uncertain or completed upstream call.`);}
}
/** Trusted local code isolated for failure containment, not an OS permission sandbox. */
export class MiddlewareProcess {
 generation=randomUUID();readonly hooks=new Set<string>();
 #child:ChildProcess|undefined;#dead=false;#disposed=false;#live=false;#restarts=0;#recovery:NodeJS.Timeout|undefined;#diagnostics='';
 #pending=new Map<string,{stage:string;resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();
 #queue:{stage:string;args:unknown[];resolve:(value:unknown)=>void;reject:(error:Error)=>void}[]=[];
 constructor(readonly config:MiddlewareConfig,readonly modulePath:string){}
 get diagnostics(){return this.#diagnostics;}
 get status(){return {generation:this.generation,state:this.#disposed?'CLOSED':this.#dead?'UNAVAILABLE':'READY',restarts:this.#restarts,pending:this.#pending.size,queued:this.#queue.length,diagnostics:callPreview(this.#diagnostics)};}
 async start(){
  this.#dead=false;this.generation=randomUUID();
  this.#child=fork(fileURLToPath(new URL('./middleware-worker.js',import.meta.url)),[this.modulePath,this.generation],{stdio:['ignore','pipe','pipe','ipc'],serialization:'json',execArgv:[],windowsHide:true});
  for(const stream of [this.#child.stdout,this.#child.stderr])stream?.on('data',chunk=>{this.#diagnostics=(this.#diagnostics+String(chunk)).slice(-16384);});
  const child=this.#child;
  this.#child.on('error',()=>{if(this.#child===child)this.fail('MIDDLEWARE_FAILED');});
  this.#child.on('exit',()=>{if(this.#child===child)this.fail('MIDDLEWARE_FAILED');});
  this.#child.on('message',(message:unknown)=>{
   if(!message||typeof message!=='object')return;const m=message as Record<string,unknown>;
   if(m.generation!==this.generation||typeof m.id!=='string')return;
   const pending=this.#pending.get(m.id);if(!pending||m.stage!==pending.stage)return;
   this.#pending.delete(m.id);clearTimeout(pending.timer);
   if(Buffer.byteLength(JSON.stringify(message))>262144)pending.reject(new MiddlewareError('MIDDLEWARE_INVALID_OUTPUT',this.config.id,pending.stage));
   else if(m.error)pending.reject(new MiddlewareError('MIDDLEWARE_FAILED',this.config.id,pending.stage));else pending.resolve(m.result);
   this.drain();
  });
  try{const hooks=await this.submit('initialize',[]);if(!Array.isArray(hooks))throw Error('MIDDLEWARE_INVALID_OUTPUT');this.hooks.clear();for(const hook of hooks)this.hooks.add(String(hook));this.#live=true;}catch(error){if(!this.#live)await this.close();throw error;}
 }
 call(stage:MiddlewareStage,args:unknown[]){return this.submit(stage,args,mcpCallContext.getStore()?.signal);}
 private submit(stage:string,args:unknown[],signal?:AbortSignal):Promise<unknown>{
  const cancelled=()=>new MiddlewareError('MIDDLEWARE_FAILED',this.config.id,stage,'not_started','CALL_CANCELLED');
  if(signal?.aborted)return Promise.reject(cancelled());
  if(this.#dead)return Promise.reject(new MiddlewareError('MIDDLEWARE_FAILED',this.config.id,stage));
  if(this.#pending.size>=(this.config.concurrency??16)&&this.#queue.length>=(this.config.queueLimit??64))return Promise.reject(new MiddlewareError('MIDDLEWARE_BUSY',this.config.id,stage));
  return new Promise((resolve,reject)=>{
   const cleanup=()=>signal?.removeEventListener('abort',abort);
   const item={stage,args,resolve:(value:unknown)=>{cleanup();resolve(value);},reject:(error:Error)=>{cleanup();reject(error);}};
   const abort=()=>{
    const index=this.#queue.indexOf(item);
    if(index>=0)this.#queue.splice(index,1);
    // A dispatched hook cannot be forcibly interrupted independently of its
    // shared worker. Ignore its result, but retain its slot and timeout until
    // completion so cancellation cannot bypass concurrency/resource limits.
    item.reject(cancelled());
   };
   signal?.addEventListener('abort',abort,{once:true});
   this.#queue.push(item);this.drain();
  });
 }
 private drain(){
  while(!this.#dead&&this.#pending.size<(this.config.concurrency??16)&&this.#queue.length){
   const item=this.#queue.shift()!,id=randomUUID();
   const timer=setTimeout(()=>this.fail('MIDDLEWARE_TIMEOUT'),item.stage==='initialize'?(this.config.initializationTimeoutMs??10000):(this.config.timeoutMs??2000));
   this.#pending.set(id,{...item,timer});
   this.#child?.send({id,generation:this.generation,stage:item.stage,args:item.args},error=>{if(error)this.fail('MIDDLEWARE_FAILED');});
  }
 }
 private fail(code:string){
  if(this.#dead)return;this.#dead=true;this.#child?.kill('SIGKILL');
  for(const item of this.#pending.values()){clearTimeout(item.timer);item.reject(new MiddlewareError(code,this.config.id,item.stage));}this.#pending.clear();
  for(const item of this.#queue)item.reject(new MiddlewareError(code,this.config.id,item.stage));this.#queue=[];
  if(this.#live&&!this.#disposed&&this.#restarts<3){const delay=[100,400,1600][this.#restarts++]!;this.#recovery=setTimeout(()=>{if(!this.#disposed)void this.start().catch(()=>{});},delay);this.#recovery.unref();}
 }
 async close(){this.#disposed=true;if(this.#recovery)clearTimeout(this.#recovery);this.fail('MIDDLEWARE_FAILED');const child=this.#child;if(child&&child.exitCode===null&&child.signalCode===null)await new Promise<void>(resolve=>child.once('exit',()=>resolve()));}
}
