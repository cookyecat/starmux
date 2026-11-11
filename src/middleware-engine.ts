import {isReadOnlyTool} from './account-access-policy.js';
import {mcpCallContext} from './mcp-call-context.js';
import {ReadCache} from './read-cache.js';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ToolSchema} from '@modelcontextprotocol/sdk/types.js';
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import type {JsonSchemaType} from '@modelcontextprotocol/sdk/validation/types.js';
import type {Tool,ToolInvocation,CallToolResult} from './contracts.js';
import type {CatalogEntry,MiddlewareContext,MiddlewareDefinition,MiddlewareStage,ToolTarget,RequestDecision} from './middleware.js';
import type {MiddlewareConfig} from './middleware-config.js';
import {MiddlewareError,MiddlewareProcess} from './middleware-process.js';
import {builtinMiddleware} from './middleware-builtins.js';
import {toolResult} from './mcp-results.js';
type Hook={generation?:()=>string;diagnostics?:()=>unknown;config:MiddlewareConfig;has(stage:MiddlewareStage):boolean;call(stage:MiddlewareStage,args:unknown[]):Promise<unknown>;close():Promise<void>};
export interface MiddlewareTrace {callId:string;pluginId:string;stage:MiddlewareStage;durationMs:number;outcome:string}
const hookOwners=new WeakMap<Hook,number>();
const key=(t:ToolTarget)=>JSON.stringify([t.serverId,t.toolName]);
const matches=(c:MiddlewareConfig,t:ToolTarget)=>!c.match||(!c.match.servers||c.match.servers.includes(t.serverId))&&(!c.match.tools||c.match.tools.includes(t.toolName));
export class MiddlewareEngine {
 readonly version=randomUUID();#closed=false;readonly #cache=new ReadCache<CallToolResult>();readonly #hooks:Hook[]=[];
 readonly #original=new Map<string,CatalogEntry>();readonly #published=new Map<string,CatalogEntry>();
 readonly #validator=new AjvJsonSchemaValidator();
 private constructor(private readonly trace:(event:MiddlewareTrace)=>void){}
 static async create(configs:MiddlewareConfig[],catalog:CatalogEntry[],base:string,trace:(event:MiddlewareTrace)=>void=()=>{},signal?:AbortSignal,previous?:MiddlewareEngine){
  const engine=new MiddlewareEngine(trace);const abort=()=>{void engine.close();};signal?.addEventListener('abort',abort,{once:true});
  try{
   if(signal?.aborted)throw Error('MIDDLEWARE_CANCELLED');
   for(const entry of catalog)engine.#original.set(key(entry.target),structuredClone(entry));
   for(const config of configs.filter(c=>c.enabled!==false)){
    if(signal?.aborted)throw Error('MIDDLEWARE_CANCELLED');
    const reused=previous?previous.#hooks.find(h=>JSON.stringify(h.config)===JSON.stringify(config)):undefined;if(reused){engine.own(reused);continue;}
    if(config.module){const worker=new MiddlewareProcess(config,path.resolve(base,config.module));engine.own({config,generation:()=>worker.generation,diagnostics:()=>worker.status,has:stage=>worker.hooks.has(stage),call:(stage,args)=>worker.call(stage,args),close:()=>worker.close()});await worker.start();}
    else {const plugin=builtinMiddleware(config);engine.own({config,has:stage=>typeof plugin[stage]==='function',async call(stage,args){return (plugin[stage] as (...args:unknown[])=>unknown)(...structuredClone(args));},close:async()=>{}});}
   }
   let entries=structuredClone(catalog);
   for(const hook of engine.#hooks){if(!hook.has('catalog'))continue;
    const chosen=entries.filter(e=>matches(hook.config,e.target));
    const output=await engine.run(hook,'catalog',[chosen,hook.config.options],'catalog');
    if(!Array.isArray(output))throw new MiddlewareError('MIDDLEWARE_INVALID_OUTPUT',hook.config.id,'catalog');
    const allowed=new Set(chosen.map(e=>key(e.target))),seen=new Set<string>();
    for(const entry of output as CatalogEntry[]){if(!entry?.target||!allowed.has(key(entry.target))||seen.has(key(entry.target))||!ToolSchema.safeParse(entry.tool).success)throw new MiddlewareError('MIDDLEWARE_INVALID_OUTPUT',hook.config.id,'catalog');seen.add(key(entry.target));}
    entries=[...entries.filter(e=>!allowed.has(key(e.target))),...output as CatalogEntry[]];
   }
   for(const entry of entries){
    if(engine.#published.has(entry.tool.name)||entry.tool.name==='health_check'||entry.tool.name.startsWith('gateway_'))throw new MiddlewareError('MIDDLEWARE_INVALID_OUTPUT','catalog','catalog');
    engine.validateSchema(entry.tool.inputSchema);if(entry.tool.outputSchema)engine.validateSchema(entry.tool.outputSchema);
    engine.#published.set(entry.tool.name,structuredClone(entry));
   }
   if(signal?.aborted)throw Error('MIDDLEWARE_CANCELLED');return engine;
  }catch(error){await engine.close();throw error;}finally{signal?.removeEventListener('abort',abort);}
 }
 private own(hook:Hook){if(this.#closed)throw Error('MIDDLEWARE_CLOSED');this.#hooks.push(hook);hookOwners.set(hook,(hookOwners.get(hook)??0)+1);}
 diagnostics(){return this.#hooks.map(h=>({id:h.config.id,type:h.config.builtin??'module',...(h.diagnostics?{runtime:h.diagnostics()}:{runtime:{state:'READY'}})}));}
 get catalog(){return [...this.#published.values()].map(e=>structuredClone(e.tool));}
 canonical(name:string){const entry=this.#published.get(name);return entry?this.#original.get(key(entry.target))?.tool.name:undefined;}
 private validateSchema(schema:unknown,value?:unknown){const validate=this.#validator.getValidator(schema as JsonSchemaType);if(arguments.length>1&&!validate(value).valid)throw Error('SCHEMA_VALIDATION_FAILED');}
 private async run(hook:Hook,stage:MiddlewareStage,args:unknown[],callId:string,expectedGeneration?:string){
  const start=Date.now();let outcome='complete';
  try{if(expectedGeneration!==undefined&&hook.generation?.()!==expectedGeneration)throw new MiddlewareError('MIDDLEWARE_FAILED',hook.config.id,stage,'not_started','PLUGIN_GENERATION_CHANGED');if(mcpCallContext.getStore()?.signal.aborted)throw Error('CALL_CANCELLED');const result=await hook.call(stage,args);if(stage==='request'&&result&&typeof result==='object'&&'action' in result)outcome=['continue','reject','respond'].includes(String(result.action))?String(result.action):'invalid';return result;}catch(error){outcome='error';throw error instanceof MiddlewareError?error:new MiddlewareError('MIDDLEWARE_FAILED',hook.config.id,stage);}
  finally{try{this.trace({callId,pluginId:hook.config.id,stage,durationMs:Date.now()-start,outcome});}catch{}}
 }
 async invoke(params:ToolInvocation,authorize:(invocation:ToolInvocation)=>Promise<void>,execute:(invocation:ToolInvocation)=>Promise<CallToolResult>,callId:string=randomUUID(),cacheScope:(target:ToolTarget)=>Promise<string>=async()=>callId):Promise<CallToolResult>{
  let execution:'not_started'|'returned'|'uncertain'='not_started';
  let stage:MiddlewareStage='request',pluginId='core';const generations=new Map(this.#hooks.map(h=>[h,h.generation?.()]));
  try{
   const published=this.#published.get(params.name);if(!published)throw Error('TOOL_NOT_PUBLISHED');
   let target=published.target,args=structuredClone(params.arguments??{});
   const original=this.#original.get(key(target))!;
   this.validateSchema(published.tool.inputSchema,args);
   await authorize({...params,name:original.tool.name,arguments:args});
   const context=(hook:Hook):MiddlewareContext=>({callId,source:published.target,target,publicName:params.name,arguments:args,options:hook.config.options});
   stage='route';
   for(const hook of this.#hooks){if(!matches(hook.config,published.target)||!hook.has('route'))continue;pluginId=hook.config.id;
    const selected=await this.run(hook,'route',[context(hook)],callId,generations.get(hook));
    if(selected!==null&&selected!==undefined){if(!this.#original.has(key(selected as ToolTarget)))throw Error('ROUTE_TARGET_UNKNOWN');target=selected as ToolTarget;break;}
   }
   const chain=this.#hooks.filter(h=>matches(h.config,published.target)||matches(h.config,target));let synthetic:CallToolResult|undefined;
   stage='request';
   for(const hook of chain){if(!hook.has('request'))continue;pluginId=hook.config.id;
    const output=await this.run(hook,'request',[context(hook)],callId,generations.get(hook)) as RequestDecision;
    if(output?.action==='reject')throw new MiddlewareError('MIDDLEWARE_REJECTED',pluginId,stage,'not_started',typeof output.reason==='string'?output.reason:'Rejected by middleware');
    if(output?.action==='respond'){if(synthetic)throw Error('SYNTHETIC_RESULT_CONFLICT');synthetic=toolResult(output.result);}
    else if(output?.action==='continue'){if(Object.keys(output).some(k=>!['action','arguments'].includes(k)))throw Error('REQUEST_TARGET_IMMUTABLE');if(output.arguments!==undefined){if(!output.arguments||typeof output.arguments!=='object'||Array.isArray(output.arguments))throw Error('ARGUMENTS_INVALID');args=output.arguments;}}
    else throw Error('REQUEST_DECISION_INVALID');
   }
   const final=this.#original.get(key(target))!;pluginId='core';
   this.validateSchema(final.tool.inputSchema,args);
   const invocation={...params,name:final.tool.name,arguments:args};await authorize(invocation);if(mcpCallContext.getStore()?.signal.aborted)throw Error('CALL_CANCELLED');
   const caching=chain.find(h=>h.config.builtin==='cache');
   if(caching&&(caching.config.options.readOnly!==true||target.serverId==='desktop'&&!isReadOnlyTool(final.tool.name)))throw Error('CACHE_REQUIRES_READ_TOOL');
   const cacheKey=caching?JSON.stringify([this.version,[...generations.values()],key(target),args,await cacheScope(target)]):undefined;
   const cached=cacheKey?this.#cache.get(cacheKey):undefined;
   let result:CallToolResult,cacheable:CallToolResult|undefined;
   if(cached){result=cached;try{this.trace({callId,pluginId:caching!.config.id,stage:'request',durationMs:0,outcome:'cache_hit'});}catch{}}
   else if(synthetic)result=synthetic;else{execution='uncertain';result=await execute(invocation);execution='returned';if(cacheKey&&!result.isError)cacheable=structuredClone(result);}
   if(synthetic&&final.tool.outputSchema&&!synthetic.isError)this.validateSchema(final.tool.outputSchema,synthetic.structuredContent);
   stage='response';
   for(const hook of [...chain].reverse()){if(!hook.has('response'))continue;pluginId=hook.config.id;result=toolResult(await this.run(hook,'response',[context(hook),result],callId,generations.get(hook)));}
   pluginId='core';if(published.tool.outputSchema&&!result.isError)this.validateSchema(published.tool.outputSchema,result.structuredContent);
   if(cacheKey&&cacheable&&!result.isError)this.#cache.set(cacheKey,cacheable,Math.max(1,Math.min(300000,Number(caching?.config.options.ttlMs)||30000)));
   for(const hook of chain)if(hook.has('observe'))void this.run(hook,'observe',[{context:context(hook),stage,durationMs:0,outcome:result.isError?'error':'complete'}],callId,generations.get(hook)).catch(()=>{});
   return result;
  }catch(error){
   const problem=error instanceof MiddlewareError?new MiddlewareError(error.code,error.pluginId,error.stage,execution,error.reason):new MiddlewareError('MIDDLEWARE_INVALID_OUTPUT',pluginId,stage,execution,error instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:undefined);
   return {isError:true,content:[{type:'text',text:problem.message}],_meta:{starmux:{code:problem.code,pluginId:problem.pluginId,stage:problem.stage,upstreamExecution:execution}}};
  }
 }
 async close(){if(this.#closed)return;this.#closed=true;await Promise.allSettled(this.#hooks.map(h=>{const count=(hookOwners.get(h)??1)-1;if(count){hookOwners.set(h,count);return;}hookOwners.delete(h);return h.close();}));}
}
