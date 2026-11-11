import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createToolCallLog,callPreview} from '../dist/src/tool-call-log.js';
import {createInvocationPipeline} from '../dist/src/invocation.js';
import {GatewayError} from '../dist/src/validation.js';
import {createGatewayRuntime} from '../dist/src/dc-workspace-http.js';
import {createAccessControl} from '../dist/src/access-control.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const result=text=>({content:[{type:'text',text}]});

test('summary is default, pending calls are separate and concurrent completions stay associated',async()=>{
  let now=1000;const log=createToolCallLog({now:()=>now,routeFor:()=> 'desktop'}),resolvers={};
  const invoke=createInvocationPipeline({observer:log.observer,dispatch:inv=>new Promise(r=>resolvers[inv.name]=r)});
  const first=invoke({name:'first',arguments:{path:'private-file'}}),second=invoke({name:'second',arguments:{secret:'private-secret'}});
  assert.equal(log.snapshot().entries.filter(e=>e.status==='running').length,2);
  await Promise.resolve();
  now+=100;resolvers.second(result('private-result'));await second;
  now+=200;resolvers.first(result('other-result'));await first;
  const entries=log.snapshot().entries;
  assert.equal(entries[0].tool,'second');assert.equal(entries[0].durationMs,100);assert.equal(entries[1].durationMs,300);
  assert.doesNotMatch(JSON.stringify(entries),/private-file|private-secret|private-result|other-result/);
  assert.ok(entries.every(e=>e.details===undefined));
});

test('detail toggle never backfills summaries; disabling and clearing stop pending result capture',()=>{
  const log=createToolCallLog();const before=log.observer({name:'before',arguments:{path:'old'}});
  log.setDetailed(true);before(result('old-result'));assert.equal(log.snapshot().entries[0].details,undefined);
  const pending=log.observer({name:'pending',arguments:{path:'new'}});log.setDetailed(false);pending(result('late-secret'));
  assert.equal(log.snapshot().entries[0].details.result,undefined);
  log.setDetailed(true);const cleared=log.observer({name:'cleared'});log.clear();cleared(result('late'));assert.deepEqual(log.snapshot().entries,[]);
});

test('previews mask secret fields, preserve ordinary structured data and bound large output',()=>{
  const preview=callPreview({apiKey:'secret-key',nested:{password:'secret-password'},content:[{type:'image',data:'binary-string'},{type:'text',text:'Authorization: Bearer secret-bearer'}],data:[{name:'sql-row'}]});
  assert.doesNotMatch(preview,/secret-key|secret-password|binary-string|secret-bearer/);
  assert.match(preview,/sql-row/);assert.match(callPreview('x'.repeat(20000)),/truncated/);
  assert.ok(callPreview('x'.repeat(20000)).length<8300);
});

test('denials, returned errors, uncertain results and thrown failures are recorded without changing execution',async()=>{
  for(const [code,status,throws] of [['READ_ONLY_MODE','blocked',false],['UPSTREAM_CALL_UNCERTAIN','uncertain',false],['UPSTREAM_CLOSED','error',false],['TOOL_FAILURE','error',true]]){
    const log=createToolCallLog();log.setDetailed(true);
    const invoke=createInvocationPipeline({observer:log.observer,dispatch:async()=>{if(throws)throw new GatewayError(code);return {...result(code+': details'),isError:true};}});
    if(throws)await assert.rejects(invoke({name:'tool'}),e=>e.code===code);else assert.equal((await invoke({name:'tool'})).isError,true);
    assert.equal(log.snapshot().entries[0].status,status);assert.equal(log.snapshot().entries[0].code,code);
  }
  const log=createToolCallLog(),denied=createInvocationPipeline({observer:log.observer,denyRules:{check:async()=>{throw new GatewayError('TOOL_DENIED');}},dispatch:()=>assert.fail('denied dispatch')});
  assert.equal((await denied({name:'denied'})).isError,true);assert.equal(log.snapshot().entries[0].status,'blocked');
  for(const observer of [()=>{throw Error('observer');},()=>()=>{throw Error('observer');}]){
    const expected=result('unchanged');assert.equal(await createInvocationPipeline({observer,dispatch:async()=>expected})({name:'tool'}),expected);
  }
});

test('records expire, remain bounded, ignore health probes and reset on a new runtime',()=>{
  let now=1000;const log=createToolCallLog({now:()=>now});
  log.observer({name:'health_check'})(result('ok'));assert.equal(log.snapshot().entries.length,0);
  for(let i=0;i<250;i++)log.observer({name:'tool'+i})(result('ok'));
  assert.equal(log.snapshot().entries.length,200);assert.equal(log.snapshot().entries.at(-1).tool,'tool50');
  now+=30*60*1000;assert.equal(log.snapshot().entries.length,0);
  assert.equal(createToolCallLog().snapshot().detailed,false);
});

test('real MCP calls expose summary and opt-in details only through authenticated owner endpoint',{timeout:30000},async t=>{
  await mkdir('.internal',{recursive:true});const root=await mkdtemp(path.resolve('.internal/call-log-wire-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const file=path.join(root,'example.txt');await writeFile(file,'call-log-example');
  const accessFile=path.join(root,'access.json'),access=await createAccessControl(accessFile),owner=await access.ownerToken();
  const runtime=createGatewayRuntime({env:{STARMUX_PROJECT_ROOT:root,STARMUX_PROJECT_PORT:'0',STARMUX_PERMISSION_MODE:'global',STARMUX_ACCESS_FILE:accessFile,STARMUX_INSTANCE_ID:'call-log-test'},audit:()=>{}});
  t.after(()=>runtime.close());await runtime.start();
  const base=`http://127.0.0.1:${runtime.port}`,url=base+'/tool-calls.json?instanceId=call-log-test',headers={authorization:'Bearer '+owner};
  assert.equal((await fetch(url)).status,401);
  assert.equal((await fetch(url,{headers:{...headers,origin:'https://evil.test'}})).status,403);
  assert.equal((await fetch(base+'/tool-calls.json?instanceId=wrong',{headers})).status,409);
  const client=new Client({name:'log-test',version:'1'},{capabilities:{}});t.after(()=>client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp')));
  await client.callTool({name:'read_file',arguments:{path:file}});
  let snapshot=await fetch(url,{headers}).then(r=>r.json());assert.equal(snapshot.entries[0].tool,'read_file');assert.equal(snapshot.entries[0].details,undefined);
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({op:'details',enabled:true})})).status,200);
  await client.callTool({name:'read_file',arguments:{path:file}});
  snapshot=await fetch(url,{headers}).then(r=>r.json());assert.match(snapshot.entries[0].details.arguments,/example.txt/);assert.match(snapshot.entries[0].details.result,/call-log-example/);
  await fetch(url,{method:'POST',headers,body:JSON.stringify({op:'clear'})});assert.equal((await fetch(url,{headers}).then(r=>r.json())).entries.length,0);
});
