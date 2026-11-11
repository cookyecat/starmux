import path from 'node:path';
import {homedir} from 'node:os';
import * as store from './instance-store.js';
import {middlewareConfigSchema} from './middleware-config.js';
import {MiddlewareEngine} from './middleware-engine.js';
import type {MiddlewareTrace} from './middleware-engine.js';
import type {Tool,ToolInvocation} from './contracts.js';
import {toolResult} from './mcp-results.js';
export class MiddlewareManagement {
 constructor(private readonly home=homedir()){}
 async list(instance:store.Instance){const c=await store.loadInstanceConfig(instance);return {middlewares:c.config.middlewares??[],revision:c.revision};}
 async update(instance:store.Instance,op:string,revision:string,input:unknown){
  const saved=await this.list(instance);let entries=saved.middlewares;
  if(op==='add'||op==='configure'){
   const config=middlewareConfigSchema.parse(input);const exists=entries.some(e=>e.id===config.id);
   if(op==='add'&&exists)throw Error('MIDDLEWARE_ID_CONFLICT');if(op==='configure'&&!exists)throw Error('MIDDLEWARE_NOT_FOUND');
   entries=exists?entries.map(e=>e.id===config.id?config:e):[...entries,config];
  }else if(op==='order'){
   if(!Array.isArray(input)||input.length!==entries.length||new Set(input).size!==entries.length||input.some(id=>!entries.some(e=>e.id===id)))throw Error('MIDDLEWARE_ORDER_INVALID');
   entries=input.map(id=>entries.find(e=>e.id===id)!);
  }else if(['enable','disable','remove'].includes(op)){
   if(!entries.some(e=>e.id===input))throw Error('MIDDLEWARE_NOT_FOUND');
   entries=op==='remove'?entries.filter(e=>e.id!==input):entries.map(e=>e.id===input?{...e,enabled:op==='enable'}:e);
  }else throw Error('MIDDLEWARE_ACTION_INVALID');
  return store.patchInstanceConfig(instance,{middlewares:entries},revision,this.home);
 }
 async test(instance:store.Instance,input:{request:ToolInvocation;result:unknown;tool:Tool;serverId?:string;toolName?:string}){
  const saved=await this.list(instance);const trace:MiddlewareTrace[]=[];
  const engine=await MiddlewareEngine.create(saved.middlewares,[{tool:input.tool,target:{serverId:input.serverId??'sample',toolName:input.toolName??input.tool.name}}],path.dirname(instance.source.path),e=>trace.push(e));
  try{return {sampleOnly:true,catalog:engine.catalog,result:await engine.invoke(input.request,async()=>{},async()=>toolResult(input.result)),trace};}finally{await engine.close();}
 }
}
