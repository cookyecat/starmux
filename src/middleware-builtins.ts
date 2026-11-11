import type {MiddlewareDefinition,MiddlewareContext,ToolTarget} from './middleware.js';
import type {MiddlewareConfig} from './middleware-config.js';
import {toolResult} from './mcp-results.js';
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export function builtinMiddleware(config:MiddlewareConfig):MiddlewareDefinition {
 const o=config.options;
 switch(config.builtin){
  case 'cache':return {apiVersion:1};
  case 'arguments':return {apiVersion:1,request(ctx){const args={...object(o.defaults),...ctx.arguments};for(const key of Array.isArray(o.trim)?o.trim:[])if(typeof key==='string'&&typeof args[key]==='string')args[key]=args[key].trim();return {action:'continue',arguments:args};}};
  case 'catalog':return {apiVersion:1,catalog(entries){return o.hidden===true?[]:entries.map(entry=>({...entry,tool:{...entry.tool,...(typeof o.alias==='string'?{name:o.alias}:{}),...(typeof o.description==='string'?{description:o.description}:{}),...(o.inputSchema?{inputSchema:object(o.inputSchema) as typeof entry.tool.inputSchema}:{}),...(o.outputSchema?{outputSchema:object(o.outputSchema) as NonNullable<typeof entry.tool.outputSchema>}:{})}}));}};
  case 'route':return {apiVersion:1,route(ctx:MiddlewareContext){const when=object(o.when);return Object.entries(when).every(([k,v])=>JSON.stringify(ctx.arguments[k])===JSON.stringify(v))?object(o.target) as unknown as ToolTarget:null;}};
  case 'result':return {apiVersion:1,response(_ctx,result){const fields=Array.isArray(o.fields)?o.fields.filter((f):f is string=>typeof f==='string'):[];if(!result.structuredContent||!fields.length)return result;return {...result,structuredContent:Object.fromEntries(fields.filter(k=>k in result.structuredContent!).map(k=>[k,result.structuredContent![k]]))};}};
  case 'redact':return {apiVersion:1,response(_ctx,result){const fields=new Set(Array.isArray(o.fields)?o.fields:['token','password','secret','authorization','apiKey']);const visit=(v:unknown):unknown=>Array.isArray(v)?v.map(visit):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,v])=>[k,fields.has(k)?'[REDACTED]':visit(v)])):v;return toolResult(visit(result));}};
  default:throw Error('MIDDLEWARE_BUILTIN_UNKNOWN');
 }
}
