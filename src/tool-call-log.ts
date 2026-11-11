import {randomUUID} from 'node:crypto';
import type {CallToolResult,ToolInvocation} from './contracts.js';
import type {InvocationObserver} from './invocation.js';

const LIMIT=200, TTL=30*60*1000, PREVIEW_LIMIT=8192;
const sensitive=/authorization|cookie|password|passwd|secret|token|api[_-]?key|private[_-]?key/i;
// Best-effort redaction, not a guarantee for secrets embedded in arbitrary text.
function redactText(value:string){
  return value.replace(/Bearer\s+[^\s"']+/gi,'Bearer [REDACTED]')
    .replace(/((?:password|secret|token|api[_-]?key)\s*[=:]\s*)[^\s,;"']+/gi,'$1[REDACTED]');
}
export function callPreview(value:unknown):string{
  let nodes=0;
  function visit(v:unknown,depth=0):unknown{
    if(++nodes>300||depth>6)return '[omitted: preview limit]';
    if(typeof v==='string')return redactText(v.slice(0,PREVIEW_LIMIT))+(v.length>PREVIEW_LIMIT?' [truncated]':'');
    if(Array.isArray(v))return [...v.slice(0,40).map(x=>visit(x,depth+1)),...(v.length>40?['[remaining items omitted]']:[])];
    if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).slice(0,60).map(([key,item])=>[
      key,sensitive.test(key)?'[REDACTED]':typeof item==='string'&&(key==='blob'||key==='data'&&['image','audio'].includes(String((v as {type?:string}).type)))?'[binary content omitted]':visit(item,depth+1)
    ]));
    return v;
  }
  const text=JSON.stringify(visit(value),null,2)??'null';
  return text.length>PREVIEW_LIMIT?text.slice(0,PREVIEW_LIMIT)+'\n[truncated]':text;
}
type Entry={id:string;at:string;tool:string;route:string;status:'running'|'complete'|'error'|'blocked'|'uncertain';durationMs:number|null;code?:string;upstreamExecution?:'not_started'|'returned'|'uncertain';middleware?:unknown[];details?:{arguments:string;clientRequest?:string;result?:string;upstreamRequest?:string;upstreamResponse?:string}};
export function createToolCallLog({now=()=>Date.now(),routeFor=()=>null}:{now?:()=>number;routeFor?:(name:string)=>string|null}={}){
  let entries:Entry[]=[],detailed=false,epoch=0;const recordingEpoch=new WeakMap<Entry,number>();
  const prune=()=>{entries=entries.filter(e=>now()-Date.parse(e.at)<TTL).slice(-LIMIT);};
  const observer:InvocationObserver=(invocation:ToolInvocation,requestId?:string)=>{
    if(invocation.name==='health_check')return ()=>{};
    prune();const start=now(),captureEpoch=epoch;
    const entry:Entry={id:requestId??randomUUID(),upstreamExecution:'not_started',at:new Date(start).toISOString(),tool:invocation.name.slice(0,256),route:routeFor(invocation.name)??'gateway',status:'running',durationMs:null,
      ...(detailed?{details:{arguments:callPreview(invocation.arguments??{}),clientRequest:callPreview(invocation)}}:{})};
    recordingEpoch.set(entry,epoch);entries.push(entry);prune();
    return (result?:CallToolResult,failure?:string)=>{
      const first=result?.content.find(c=>c.type==='text');
      const rawCode=failure??(result?.isError&&first?.type==='text'?first.text.match(/^([A-Z][A-Z0-9_]{2,80})(?=:|\s|$)/)?.[1]:undefined);
      const code=rawCode&&/^[A-Z][A-Z0-9_]{2,80}$/.test(rawCode)?rawCode:undefined;
      entry.durationMs=Math.max(0,now()-start);
      entry.status=code==='UPSTREAM_CALL_UNCERTAIN'?'uncertain':code&&/DENIED|READ_ONLY|NOT_GRANTED/.test(code)?'blocked':failure||result?.isError?'error':'complete';
      if(code)entry.code=code;
      if(code==='UPSTREAM_CALL_UNCERTAIN')entry.upstreamExecution='uncertain';
      if(entry.details&&detailed&&captureEpoch===epoch)entry.details.result=callPreview(result??{error:failure});
    };
  };
  return {observer,
    stage(id:string,stage:'upstreamRequest'|'upstreamResponse',value:unknown){prune();const entry=entries.find(e=>e.id===id);if(!entry)return;if(stage==='upstreamRequest'&&value&&typeof value==='object'&&'serverId' in value)entry.route=String(value.serverId).slice(0,40);entry.upstreamExecution=stage==='upstreamRequest'?'uncertain':'returned';if(entry.details&&detailed&&recordingEpoch.get(entry)===epoch)entry.details[stage]=callPreview(value);},
    middlewareTrace(event:{callId:string;pluginId:string;stage:string;durationMs:number;outcome:string}){prune();const entry=entries.find(e=>e.id===event.callId);if(entry){entry.middleware??=[];if(entry.middleware.length<128)entry.middleware.push({...event});}},
    setDetailed(value:boolean){detailed=value;epoch++;},clear(){entries=[];epoch++;},
    snapshot(){prune();return {detailed,limit:LIMIT,retentionMinutes:TTL/60000,storage:'memory',entries:structuredClone(entries).reverse()};}};
}
