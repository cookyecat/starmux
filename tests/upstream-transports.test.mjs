import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {ConfiguredUpstream,validateConfiguredUpstreams} from '../dist/src/configured-mcp-upstreams.js';
import {ServerRegistry} from '../dist/src/server-registry.js';
import {instanceConfigSchema,createInstance,prepareUpstreams,instancePaths,loadInstanceConfig} from '../dist/src/instance-store.js';
import {createMCPUpstreamRouter} from '../dist/src/mcp-upstream-router.js';
import {SSEServerTransport} from '@modelcontextprotocol/sdk/server/sse.js';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
const tool=name=>({name,inputSchema:{type:'object'}});
async function httpFixture(t,{repeat=false,fail=false,resourcesOnly=false}={}){
  const calls=[],cursors=[];
  const server=createServer(async(req,res)=>{
    if(req.headers.authorization!=='Bearer fixture-private'){res.writeHead(401).end();return;}
    if(fail){res.writeHead(503).end();return;}
    let raw='';for await(const chunk of req)raw+=chunk;
    if(!raw){res.writeHead(405).end();return;}
    const r=JSON.parse(raw);if(r.id===undefined){res.writeHead(202).end();return;}
    let result;
    if(r.method==='initialize')result={protocolVersion:r.params.protocolVersion,serverInfo:{name:'remote-test',version:'1'},capabilities:resourcesOnly?{resources:{}}:{tools:{}}};
    if(r.method==='resources/list')result={resources:[]};
    if(r.method==='resources/templates/list')result={resourceTemplates:[]};
    if(r.method==='tools/list'){
      cursors.push(r.params?.cursor??null);
      result=r.params?.cursor?{tools:[tool('second')],...(repeat?{nextCursor:'page-two'}:{})}:{tools:[tool('first')],nextCursor:'page-two'};
    }
    if(r.method==='tools/call'){calls.push(r.params);result={content:[{type:'text',text:r.params.name}]};}
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:r.id,result}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});
  return {url:`http://127.0.0.1:${server.address().port}/mcp`,calls,cursors};
}
const def=url=>({id:'remote',transport:'streamable-http',url,headers:{Authorization:'Bearer fixture-private'},allowTools:['second']});
test('HTTP discovers all pages and exposes only permitted tools',async t=>{
  const f=await httpFixture(t),upstream=new ConfiguredUpstream(def(f.url));t.after(()=>upstream.close());await upstream.connect();
  assert.deepEqual(f.cursors,[null,'page-two']);assert.equal(upstream.status.toolCount,2);assert.equal(upstream.status.allowedToolCount,1);
  assert.deepEqual(upstream.upstreamCatalog.map(t=>t.name),['second']);
  await assert.rejects(upstream.forwardWorkspaceInvocation({name:'first'}),e=>e.code==='UPSTREAM_TOOL_NOT_GRANTED');
  assert.equal((await upstream.forwardWorkspaceInvocation({name:'second',arguments:{}})).content[0].text,'second');
  const router=createMCPUpstreamRouter({routes:[{id:'desktop',upstream:{upstreamCatalog:[],forwardWorkspaceInvocation:async()=>({content:[]})}}, {id:'remote',upstream,authorize:(_n,args)=>args}]});
  assert.deepEqual(router.upstreamCatalog.map(t=>t.name),['remote__second']);assert.equal(f.calls.length,1);
});
test('repeated pagination cursor fails without publishing a partial catalog',async t=>{
  const f=await httpFixture(t,{repeat:true}),upstream=new ConfiguredUpstream(def(f.url));t.after(()=>upstream.close());
  await assert.rejects(upstream.connect(),e=>e.code==='UPSTREAM_CURSOR_REPEATED');assert.equal(upstream.upstreamCatalog.length,0);
});
test('failed and disabled services retain registered status without affecting healthy services',async t=>{
  const good=await httpFixture(t),bad=await httpFixture(t,{fail:true});
  const registry=new ServerRegistry({version:1,upstreams:[def(good.url),{...def(bad.url),id:'failed'},{...def(bad.url),id:'disabled',enabled:false}]});t.after(()=>registry.close());
  await registry.connectAll();assert.deepEqual(registry.status().map(s=>s.status),['READY','UNAVAILABLE','DISCONNECTED']);
  assert.equal(registry.status()[2].enabled,false);assert.equal(registry.routes().length,1);
  await registry.close();await assert.rejects(registry.connectAll(),e=>e.code==='UPSTREAM_CLOSED');
});
test('remote secret references resolve privately and never alter the saved configuration',async t=>{
  await mkdir('.internal',{recursive:true});const home=await mkdtemp(path.resolve('.internal/remote-config-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const config=instanceConfigSchema.parse({schemaVersion:1,projectRoot:home,port:18893,upstreams:[{id:'remote',transport:'streamable-http',url:'https://example.test/mcp',allowTools:['second'],headerRefs:{Authorization:'remote_key'}}]});
  const instance=await createInstance('remote-test',{config},home);
  await writeFile(path.join(instancePaths(instance,home).state,'secrets.json'),JSON.stringify({remote_key:'Bearer fixture-private'}),{mode:0o600});
  const resolved=await prepareUpstreams(instance,config,home);
  const {readConfiguredUpstreams}=await import('../dist/src/configured-mcp-upstreams.js');
  assert.equal((await readConfiguredUpstreams(resolved))[0].headers.Authorization,'Bearer fixture-private');
  assert.doesNotMatch((await loadInstanceConfig(instance)).text,/fixture-private/);
  assert.throws(()=>instanceConfigSchema.parse({...config,upstreams:[{...config.upstreams[0],headers:{Authorization:'raw-secret'}}]}));
  assert.throws(()=>validateConfiguredUpstreams({version:1,upstreams:[{...def('https://user:password@example.test/mcp')}]}));
});
test('explicit legacy SSE transport receives configured authentication and discovers tools',async t=>{
  let transport;const mcp=new Server({name:'sse-test',version:'1'},{capabilities:{tools:{}}});
  mcp.setRequestHandler(ListToolsRequestSchema,()=>({tools:[tool('second')]}));mcp.setRequestHandler(CallToolRequestSchema,()=>({content:[{type:'text',text:'legacy'}]}));
  const server=createServer(async(req,res)=>{
    if(req.headers.authorization!=='Bearer fixture-private'){res.writeHead(401).end();return;}
    if(req.url==='/sse'){transport=new SSEServerTransport('/messages',res);await mcp.connect(transport);}
    else if(transport&&req.method==='POST')await transport.handlePostMessage(req,res);
    else res.writeHead(404).end();
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await mcp.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
  const upstream=new ConfiguredUpstream({...def(`http://127.0.0.1:${server.address().port}/sse`),transport:'sse'});t.after(()=>upstream.close());
  await upstream.connect();assert.equal((await upstream.forwardWorkspaceInvocation({name:'second',arguments:{}})).content[0].text,'legacy');
});

test('upstream message bursts preserve notification microtasks before response handling',async()=>{
 const {orderedClientTransport}=await import('../dist/src/ordered-client-transport.js');
 const inner={async start(){},async close(){this.onclose?.();},async send(){}};const transport=orderedClientTransport(inner);const events=[];
 transport.onmessage=message=>{if(message.method)void Promise.resolve().then(()=>events.push('notification'));else events.push('response');};
 await transport.start();inner.onmessage({jsonrpc:'2.0',method:'notifications/progress',params:{progressToken:1,progress:1}});inner.onmessage({jsonrpc:'2.0',id:1,result:{}});
 await new Promise(r=>setImmediate(r));assert.deepEqual(events,['notification','response']);await transport.close();
});

test('resource-only MCP servers initialize without an unsupported tools/list request',async t=>{
 const f=await httpFixture(t,{resourcesOnly:true}),upstream=new ConfiguredUpstream({...def(f.url),allowTools:[]});t.after(()=>upstream.close());await upstream.connect();assert.equal(upstream.status.status,'READY');assert.deepEqual(f.cursors,[]);assert.deepEqual(await upstream.listNativeResources(),[]);
});

test('ambiguous public prompt names reject both discovery and invocation',async()=>{
 const base={upstreamCatalog:[],forwardWorkspaceInvocation:async()=>({content:[]})};let called=false;
 const withPrompt=name=>({...base,listNativePrompts:async()=>[{name}],getNativePrompt:async()=>{called=true;return {messages:[]};}});
 const router=createMCPUpstreamRouter({routes:[{id:'desktop',upstream:base},{id:'one',upstream:withPrompt('two__hello')},{id:'one__two',upstream:withPrompt('hello')}]});
 await assert.rejects(router.listPrompts(),e=>e.code==='GATEWAY_CATALOG_CONFLICT');await assert.rejects(router.getPrompt('one__two__hello'),e=>e.code==='GATEWAY_CATALOG_CONFLICT');assert.equal(called,false);
});
