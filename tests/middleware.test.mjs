import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {MiddlewareEngine} from '../dist/src/middleware-engine.js';
import {MiddlewareProcess} from '../dist/src/middleware-process.js';
const plugin=path.resolve('tests/fixtures/middleware-plugin.mjs');
const catalog=[{target:{serverId:'alpha',toolName:'read'},tool:{name:'alpha__read',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path']}}},
 {target:{serverId:'beta',toolName:'write'},tool:{name:'beta__write',inputSchema:{type:'object'}}}];
const request={name:'alpha__read',arguments:{path:'file'}};
const result={content:[{type:'text',text:'upstream'}],_meta:{retained:true},extension:{keep:true}};
const permit=async()=>{};
test('empty chain preserves invocation, result extensions, and executes once',async()=>{
 const engine=await MiddlewareEngine.create([],catalog,process.cwd());let count=0;
 try{assert.deepEqual(await engine.invoke(request,permit,async p=>{count++;assert.deepEqual(p,request);return result;}),result);assert.equal(count,1);}finally{await engine.close();}
});
test('first route wins, target hooks execute once, responses unwind in reverse order',async()=>{
 const engine=await MiddlewareEngine.create([
  {id:'route',builtin:'route',options:{target:{serverId:'beta',toolName:'write'}}},
  {id:'second',builtin:'route',options:{target:{serverId:'alpha',toolName:'read'}}},
  {id:'global',module:plugin,options:{tag:'global'}},
  {id:'target',module:plugin,match:{servers:['beta']},options:{tag:'target'}}],catalog,process.cwd());
 const checks=[];try{const output=await engine.invoke(request,async p=>{checks.push(p.name);},async p=>{assert.equal(p.name,'beta__write');assert.equal(p.arguments.tag,'target');return result;});
 assert.deepEqual(checks,['alpha__read','beta__write']);assert.deepEqual(output.content.map(c=>c.text),['upstream','target','global']);assert.deepEqual(output.extension,{keep:true});}finally{await engine.close();}
});
test('synthetic response still passes target policy; conflicting responses fail before execution',async()=>{
 const config={id:'mock',module:plugin,options:{respond:true}};
 const engine=await MiddlewareEngine.create([config],catalog,process.cwd());let calls=0,checks=0;
 try{const output=await engine.invoke(request,async()=>{if(++checks===2)throw Error('denied');},async()=>{calls++;return result;});assert.equal(output.isError,true);assert.equal(calls,0);assert.equal(output._meta.starmux.upstreamExecution,'not_started');}finally{await engine.close();}
 const conflict=await MiddlewareEngine.create([config,{...config,id:'mock2'}],catalog,process.cwd());
 try{assert.equal((await conflict.invoke(request,permit,async()=>{calls++;return result;})).isError,true);assert.equal(calls,0);}finally{await conflict.close();}
});
test('response failure reports returned and never releases untransformed result',async()=>{
 const engine=await MiddlewareEngine.create([{id:'secret-mask',module:plugin,options:{failResponse:true}}],catalog,process.cwd());let calls=0;
 try{const output=await engine.invoke(request,permit,async()=>{calls++;return result;});assert.equal(output.isError,true);assert.equal(output._meta.starmux.upstreamExecution,'returned');assert.equal(output._meta.starmux.pluginId,'secret-mask');assert.equal(JSON.stringify(output).includes('upstream"'),false);assert.equal(calls,1);}finally{await engine.close();}
});
test('alias preserves canonical authorization and hidden catalog does not fabricate targets',async()=>{
 const engine=await MiddlewareEngine.create([{id:'alias',builtin:'catalog',match:{servers:['beta']},options:{alias:'read_file'}}],catalog,process.cwd());
 try{assert.equal(engine.canonical('read_file'),'beta__write');let checked;const denied=await engine.invoke({name:'read_file',arguments:{}},async p=>{checked=p.name;throw Error('READ_ONLY');},async()=>{throw Error('must not execute');});assert.equal(checked,'beta__write');assert.equal(denied.isError,true);}finally{await engine.close();}
});
test('plugin infinite loop times out and cannot hang other plugin configurations',async()=>{
 const bad=new MiddlewareProcess({id:'bad',module:plugin,options:{},timeoutMs:50},plugin);
 const good=new MiddlewareProcess({id:'good',module:plugin,options:{}},plugin);
 await Promise.all([bad.start(),good.start()]);
 try{await assert.rejects(bad.call('request',[{options:{loop:true}}]),e=>e.code==='MIDDLEWARE_TIMEOUT');assert.equal((await good.call('request',[{options:{},arguments:{}}])).action,'continue');}finally{await Promise.all([bad.close(),good.close()]);}
});
test('bounded queue fails explicitly, while already accepted calls complete',async()=>{
 const worker=new MiddlewareProcess({id:'queue',module:plugin,options:{},concurrency:1,queueLimit:0},plugin);await worker.start();
 try{const first=worker.call('request',[{options:{delay:60},arguments:{}}]);await assert.rejects(worker.call('request',[{}]),e=>e.code==='MIDDLEWARE_BUSY');await first;}finally{await worker.close();}
});
test('read cache requires explicit tools, isolates account scope, and does not cache errors',async()=>{
 const config={id:'cache',builtin:'cache',match:{tools:['read']},options:{ttlMs:1000,readOnly:true}};
 const engine=await MiddlewareEngine.create([config],catalog,process.cwd());let executions=0,checks=0;
 const invoke=(account='a')=>engine.invoke(request,async()=>{checks++;},async()=>{executions++;return result;},'call',async()=>account);
 try{
  await invoke();await invoke();assert.equal(executions,1);assert.equal(checks,4);
  await invoke('b');assert.equal(executions,2);
  const first=await engine.invoke({...request,arguments:{path:'error'}},permit,async()=>{executions++;return {...result,isError:true};},'call',async()=>'a');assert.equal(first.isError,true);
  await engine.invoke({...request,arguments:{path:'error'}},permit,async()=>{executions++;return result;},'call',async()=>'a');assert.equal(executions,4);
 }finally{await engine.close();}
});

test('worker recovery never substitutes a new response generation into an old call',async()=>{
 const engine=await MiddlewareEngine.create([{id:'recover',module:plugin,options:{crashAfterRequest:true}}],catalog,process.cwd());const initial=engine.diagnostics()[0].runtime.generation;let calls=0;
 try{const output=await engine.invoke(request,permit,async()=>{calls++;for(let n=0;n<100&&engine.diagnostics()[0].runtime.generation===initial;n++)await new Promise(r=>setTimeout(r,20));assert.notEqual(engine.diagnostics()[0].runtime.generation,initial);return result;});assert.equal(output.isError,true);assert.equal(output._meta.starmux.stage,'response');assert.equal(output._meta.starmux.upstreamExecution,'returned');assert.equal(calls,1);}finally{await engine.close();}
});
