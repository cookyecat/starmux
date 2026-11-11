import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {CreateMessageRequestSchema,ToolListChangedNotificationSchema,ListRootsRequestSchema,ElicitRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {createGatewayRuntime} from '../dist/src/dc-workspace-http.js';
import {createAccessControl} from '../dist/src/access-control.js';
import {namespaceUri,resolveNamespacedUri} from '../dist/src/resource-namespace.js';
async function fixture(t){
 await mkdir('.internal',{recursive:true});const root=await mkdtemp(path.resolve('.internal/gateway-upgrade-wire-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const upstreamFile=path.join(root,'upstreams.json'),middlewareFile=path.join(root,'middlewares.json'),accessFile=path.join(root,'access.json');
 const definition={id:'fixture',transport:'stdio',command:process.execPath,args:[path.resolve('tests/fixtures/gateway-upstream.mjs'),'first'],allowTools:['echo','wait','ask','progress']};
 const save=async(def=definition,middlewares=[])=>{await writeFile(upstreamFile,JSON.stringify({version:1,upstreams:[def]}),{mode:0o600});await writeFile(middlewareFile,JSON.stringify(middlewares),{mode:0o600});};
 await save();await createAccessControl(accessFile);
 const runtime=createGatewayRuntime({env:{STARMUX_PROJECT_ROOT:root,STARMUX_PROJECT_PORT:'0',STARMUX_PERMISSION_MODE:'global',STARMUX_WORKSPACE_MODE:'read-write',STARMUX_DEV_COMMANDS:'trusted-project',STARMUX_DC_ACCESS_MODE:'native',STARMUX_UPSTREAMS_FILE:upstreamFile,STARMUX_ACCESS_FILE:accessFile},audit:()=>{}});
 t.after(()=>runtime.close());await runtime.start();
 const connect=async(name,capabilities={})=>{const client=new Client({name,version:'1'},{capabilities});const transport=new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${runtime.port}/mcp`));t.after(()=>client.close());return {client,transport,start:()=>client.connect(transport)};};
 return {runtime,root,definition,save,upstreamFile,middlewareFile,connect};
}
test('live replacement pins old calls, updates existing sessions, and preserves old version on candidate failure',{timeout:30000},async t=>{
 const f=await fixture(t),{client,start}=await f.connect('lifecycle');await start();let changed=0;client.setNotificationHandler(ToolListChangedNotificationSchema,()=>{changed++;});
 const pending=client.callTool({name:'fixture__wait',arguments:{delay:300}});await new Promise(r=>setTimeout(r,40));
 await f.save({...f.definition,args:[f.definition.args[0],'second']});await f.runtime.apply(f.upstreamFile,f.middlewareFile);
 assert.equal((await pending).content[0].text,'first');assert.equal((await client.callTool({name:'fixture__echo'})).content[0].text,'second');
 assert.ok(changed>=1);
 await f.save({...f.definition,command:path.join(f.root,'missing')});await assert.rejects(f.runtime.apply(f.upstreamFile,f.middlewareFile));
 assert.equal((await client.callTool({name:'fixture__echo'})).content[0].text,'second');
});
test('resources, templates, prompts and app URI ownership survive namespacing',{timeout:30000},async t=>{
 const f=await fixture(t),{client,start}=await f.connect('resources');await start();
 const tools=await client.listTools();assert.equal(tools.tools.find(t=>t.name==='fixture__echo')._meta.ui.resourceUri,namespaceUri('fixture','ui://fixture/app.html'));
 const resources=await client.listResources();const owned=resources.resources.find(r=>r.uri.startsWith('starmux://fixture/'));assert.ok(owned);
 assert.equal((await client.readResource({uri:owned.uri})).contents[0].uri,owned.uri);
 const templates=await client.listResourceTemplates();assert.ok(templates.resourceTemplates.some(t=>t.uriTemplate===namespaceUri('fixture','fixture://docs/{name}')));
 assert.equal((await client.readResource({uri:namespaceUri('fixture','fixture://docs/readme')})).contents[0].text,'first');
 assert.ok((await client.listPrompts()).prompts.some(p=>p.name==='fixture__hello'));
 assert.equal((await client.getPrompt({name:'fixture__hello'})).messages[0].content.text,'first');
 assert.deepEqual(resolveNamespacedUri(namespaceUri('fixture','file:///a%20b?q=1#x')),{serverId:'fixture',uri:'file:///a%20b?q=1#x'});
});
test('sampling is isolated to the originating client; progress and cancellation are forwarded',{timeout:30000},async t=>{
 const f=await fixture(t);const clients=[];
 for(const name of ['client-a','client-b']){const c=await f.connect(name,{sampling:{},roots:{},elicitation:{form:{}}});c.client.setRequestHandler(CreateMessageRequestSchema,async()=>({model:'fixture',role:'assistant',content:{type:'text',text:name}}));c.client.setRequestHandler(ListRootsRequestSchema,async()=>({roots:[{uri:'file:///'+name}]}));c.client.setRequestHandler(ElicitRequestSchema,async()=>({action:'accept',content:{answer:name}}));await c.start();clients.push(c.client);}
 const outputs=await Promise.all(clients.map(c=>c.callTool({name:'fixture__ask'})));assert.deepEqual(outputs.map(o=>o.content[0].text),['client-a','client-b']);
 for(const kind of ['roots','elicitation']){const answers=await Promise.all(clients.map(c=>c.callTool({name:'fixture__ask',arguments:{kind}})));assert.deepEqual(answers.map(r=>r.content[0].text),kind==='roots'?['file:///client-a','file:///client-b']:['client-a','client-b']);}
 const progress=[];await clients[0].callTool({name:'fixture__progress'},undefined,{onprogress:p=>progress.push(p)});assert.equal(progress[0].progress,1);
 const controller=new AbortController();const pending=clients[0].callTool({name:'fixture__wait',arguments:{delay:5000}},undefined,{signal:controller.signal});setTimeout(()=>controller.abort(),50);await assert.rejects(pending);
 assert.equal((await clients[1].callTool({name:'fixture__echo'})).content[0].text,'first');
});
test('plugin replacement preserves the old response chain for an in-flight call',{timeout:30000},async t=>{
 const f=await fixture(t);const module=path.resolve('tests/fixtures/middleware-plugin.mjs');
 await f.save(f.definition,[{id:'version',module,options:{tag:'old'}}]);await f.runtime.apply(f.upstreamFile,f.middlewareFile);
 const {client,start}=await f.connect('hot-plugin');await start();
 const pending=client.callTool({name:'fixture__wait',arguments:{delay:250}});await new Promise(r=>setTimeout(r,40));
 await f.save(f.definition,[{id:'version',module,options:{tag:'new'}}]);await f.runtime.apply(f.upstreamFile,f.middlewareFile);
 assert.equal((await pending).content.at(-1).text,'old');assert.equal((await client.callTool({name:'fixture__echo'})).content.at(-1).text,'new');
});

test('changing one service preserves unchanged plugin worker state',{timeout:30000},async t=>{
 const f=await fixture(t),module=path.resolve('tests/fixtures/middleware-plugin.mjs');const middleware=[{id:'counter',module,options:{counter:true}}];
 await f.save(f.definition,middleware);await f.runtime.apply(f.upstreamFile,f.middlewareFile);
 const {client,start}=await f.connect('unchanged-plugin');await start();assert.equal((await client.callTool({name:'fixture__echo'})).structuredContent.args.sequence,1);
 await f.save({...f.definition,args:[f.definition.args[0],'changed']},middleware);await f.runtime.apply(f.upstreamFile,f.middlewareFile);
 assert.equal((await client.callTool({name:'fixture__echo'})).structuredContent.args.sequence,2);
});

test('HTTP body byte limit is identical for Content-Length and chunked requests, with UTF-8 intact',{timeout:30000},async t=>{
 const {request}=await import('node:http');
 const f=await fixture(t),{client,transport,start}=await f.connect('body-limits');await start();
 const limit=1024*1024;
 const send=(body,chunked,split=body.length)=>new Promise((resolve,reject)=>{
  const req=request(`http://127.0.0.1:${f.runtime.port}/mcp`,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-session-id':transport.sessionId,...(chunked?{'transfer-encoding':'chunked'}:{'content-length':body.length})}},res=>{let text='';res.on('data',d=>text+=d);res.on('end',()=>resolve({status:res.statusCode,text}));});
  req.on('error',reject);req.write(body.subarray(0,split));setImmediate(()=>req.end(body.subarray(split)));
 });
 const raw=Buffer.from(JSON.stringify({jsonrpc:'2.0',id:999,method:'tools/call',params:{name:'fixture__echo',arguments:{text:'你好🙂'}}}));
 for(const chunked of [false,true]){
  for(const size of [65537,limit,limit+1]){
   const response=await send(Buffer.concat([raw,Buffer.alloc(size-raw.length,32)]),chunked,raw.indexOf(Buffer.from('你'))+1);
   assert.equal(response.status,size>limit?413:200,JSON.stringify({chunked,size,response}));
   if(size<=limit)assert.ok(response.text.includes('你好🙂'),'multibyte UTF-8 split across chunks must survive');
  }
 }
 assert.equal((await client.callTool({name:'fixture__echo'})).isError,undefined);
});
