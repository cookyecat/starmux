import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CallToolResult,McpUpstream,Tool,WorkspacePolicy } from '../src/contracts.js';
import { createDesktopCommanderBridge } from '../src/desktop-commander-facade.js';
import { authorizeInvocation,createInvocationExecutor,createInvocationPipeline } from '../src/invocation.js';
import { toolResult } from '../src/mcp-results.js';
import { createMCPUpstreamRouter } from '../src/mcp-upstream-router.js';
import { GatewayError } from '../src/validation.js';

const result: CallToolResult = {
  content: [{type:'text',text:'ok',annotations:{audience:['assistant']}},
    {type:'image',data:'aGVsbG8=',mimeType:'image/png'},
    {type:'resource',resource:{uri:'file:///example',text:'body',_meta:{custom:true}}}],
  structuredContent:{answer:42},_meta:{trace:'original'},vendorExtension:{preserved:true}
};
const tool: Tool & {vendorExtension:string} = {name:'read_file',inputSchema:{type:'object',properties:{path:{type:'string'}}},
  annotations:{readOnlyHint:true},_meta:{ui:{resourceUri:'ui://example'}},vendorExtension:'yes'};

test('middleware checks before execution; read-only observers cannot mutate or mask the original result',async()=>{
  const events: string[]=[];
  const invoke=createInvocationPipeline({
    denyRules:{check:async()=>{events.push('deny');}},
    middleware:[{beforeCall:context=>{
      events.push('before');
      assert.equal(context.request.identity.kind,'unverified-local');
      assert.equal(Reflect.set(context.invocation.arguments!,'path','/escape'),false);
    },afterCall:(_ctx,observed)=>{
      events.push('after');assert.deepEqual(observed,result);throw Error('observer failed');
    }},{afterCall:()=>{events.push('second observer');}}],
    dispatch:async invocation=>{events.push('execute');assert.equal(invocation.arguments?.path,'/safe');return result;},
    audit:()=>{events.push('audit');throw Error('sink failed');}
  });
  assert.equal(await invoke({name:'read_file',arguments:{path:'/safe'}}),result);
  assert.deepEqual(events,['deny','before','execute','after','audit','second observer']);
});
test('denied checks never execute, including hook rejection',async()=>{
  let calls=0;
  for(const denyRules of [undefined,{check:async()=>{throw new GatewayError('DENIED');}}]){
    const invoke=createInvocationPipeline({...(denyRules?{denyRules}:{}),
      middleware:[{beforeCall:()=>{throw new GatewayError('HOOK_DENIED');}}],
      dispatch:async()=>{calls++;return result;}});
    assert.equal((await invoke({name:'read_file'})).isError,true);
  }
  assert.equal(calls,0);
});
test('authorized invocation is consumed before an uncertain result; never replayed',async()=>{
  let calls=0;
  const execute=createInvocationExecutor({upstreamCatalog:[],forwardWorkspaceInvocation:async()=>{
    calls++;throw new GatewayError('UPSTREAM_CALL_UNCERTAIN');
  }});
  const authorized=authorizeInvocation({name:'write_file'});
  await assert.rejects(execute(authorized),/UPSTREAM_CALL_UNCERTAIN/);
  await assert.rejects(execute(authorized),/CONSUMED/);
  assert.equal(calls,1);
});
test('MCP route preserves schema, compound results, extensions and default resource metadata',async()=>{
  const resource={uri:'ui://example',name:'example',_meta:{custom:'meta'}};
  const read={contents:[{uri:'ui://example',text:'hello',mimeType:'text/html',_meta:{nested:true}}],_meta:{top:true}};
  const upstream={upstreamCatalog:[tool],forwardWorkspaceInvocation:async()=>result,
    listNativeResources:async()=>[resource],readNativeResource:async()=>read};
  const router=createMCPUpstreamRouter({routes:[{id:'desktop',upstream,exposeNativeNames:true}]});
  assert.deepEqual(router.upstreamCatalog,[tool]);
  assert.equal(await router.forwardWorkspaceInvocation({name:'read_file'}),result);
  assert.equal(toolResult(result),result);
  assert.deepEqual(await router.listResources!(),[resource]);
  assert.equal(await router.readResource!('ui://example'),read);
});
test('facade list filtering and calls enforce the same deny rules; policy observers cannot mask results',async()=>{
  let calls=0;
  const upstream: McpUpstream={upstreamCatalog:[tool],forwardWorkspaceInvocation:async()=>{calls++;return result;}};
  const policy: WorkspacePolicy={root:'/workspace',mode:'read-only',developerCommands:'off',
    validateGitPath:async()=>'/workspace',prepare:async(name,args)=>({name,arguments:args||{}}),
    observe:()=>{throw Error('observer');}};
  // Use the actual private deny store for runtime behavior rather than a casted mock.
  const {mkdtemp,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {createDenyRules}=await import('../src/explicit-deny-rules.js');
  const dir=await mkdtemp(join(tmpdir(),'gateway-deny-test-'));
  const deny=await createDenyRules({file:join(dir,'deny.json')});
  const server=createDesktopCommanderBridge(upstream,()=>{throw Error('audit');},{workspacePolicy:policy,denyRules:deny});
  const client=new Client({name:'test',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair();
  try{
    await server.connect(a);await client.connect(b);
    assert.deepEqual(await client.callTool({name:'read_file',arguments:{path:'/workspace/a'}}),result);
    assert.equal(calls,1);
    await deny.update('disable-tool','read_file');
    assert.equal((await client.listTools()).tools.some(x=>x.name==='read_file'),false);
    assert.equal((await client.callTool({name:'read_file'})).isError,true);
    assert.equal(calls,1);
  }finally{await client.close();await server.close();await rm(dir,{recursive:true,force:true});}
});

test('extension authorization precedes native passthrough; unknown names and Gateway configuration cannot bypass policy',async()=>{
  const {createToolDispatcher}=await import('../src/tool-dispatch.js');
  let calls=0;
  const upstream: McpUpstream={upstreamCatalog:[tool],forwardWorkspaceInvocation:async()=>{calls++;return result;}};
  const router=createMCPUpstreamRouter({routes:[{id:'desktop',upstream,exposeNativeNames:true},
    {id:'extension',upstream,authorize:()=>{throw new GatewayError('NOT_GRANTED');}}]});
  const context={requestId:'test',identity:{kind:'unverified-local' as const}};
  const dispatch=createToolDispatcher(router,()=>{},{upstreamRouter:router,nativePassthrough:true});
  assert.match(JSON.stringify(await dispatch({name:'extension__read_file'},context)),/ROUTE_DENIED/);
  assert.equal((await dispatch({name:'nonexistent'},context)).isError,true);
  assert.equal(calls,0);
  assert.equal(await dispatch({name:'read_file'},context),result);assert.equal(calls,1);
  const policy: WorkspacePolicy={root:'/workspace',mode:'read-only',developerCommands:'presets',
    validateGitPath:async()=>'/workspace',prepare:async()=>{throw Error('no tools');}};
  const restricted=createToolDispatcher(upstream,()=>{},{workspacePolicy:policy});
  assert.match(JSON.stringify(await restricted({name:'set_config_value'},context)),/OWNER_ONLY_CONFIG/);
  assert.match(JSON.stringify(await restricted({name:'get_config'},context)),/effective-workspace-summary/);
  assert.equal(calls,1);
});
