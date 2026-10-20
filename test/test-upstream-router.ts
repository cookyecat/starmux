import {mkdtemp,rm,readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createProjectPolicy} from '../src/project-workspace-policy.js';
import assert from "node:assert/strict";
import path from "node:path";
import type { McpUpstream } from "../src/contracts.js";
import { LocalDesktopReadProbe } from "../src/local-desktop-read-probe.js";
import { createMCPUpstreamRouter } from "../src/mcp-upstream-router.js";
import { packageRoot } from "../src/runtime-paths.js";
const dc=new LocalDesktopReadProbe();
try{
  await dc.connect();
  const samples: McpUpstream={
    upstreamCatalog:[{name:"query",description:"In-memory example",inputSchema:{
      type:"object",properties:{q:{type:"string"}},additionalProperties:false
    }}],
    async forwardWorkspaceInvocation(arg){
      assert.equal(arg.name,"query");
      return {content:[{type:"text",text:"MOCK_QUERY_OK:"+arg.arguments?.q}]};
    }
  };
  const router=createMCPUpstreamRouter({routes:[
    {id:"desktop",upstream:dc,exposeNativeNames:true},
    {id:"example",upstream:samples}
  ]});
  assert.equal(router.upstreamCatalog.length,dc.upstreamCatalog.length+1);
  assert.deepEqual(router.upstreamCatalog.slice(0,-1),dc.upstreamCatalog);
  assert.equal(router.upstreamCatalog.at(-1)!.name,"example__query");
  const result=await router.forwardWorkspaceInvocation({
    name:"example__query",arguments:{q:"ping"}
  });
  const first=result.content[0];
  assert.ok(first?.type==="text"&&first.text.endsWith("ping"));
  const testFile=await router.forwardWorkspaceInvocation({
    name:"read_file",arguments:{path:path.join(packageRoot,"test/fixtures/p1-fixture.txt")}
  });
  assert.notEqual(testFile.isError,true);
  assert.ok(JSON.stringify(testFile).includes("P1"));
  await assert.rejects(()=>router.forwardWorkspaceInvocation({
    name:"nonexistent",arguments:{}
  }),{code:"NO_SUCH_ROUTED_TOOL"});
  assert.throws(()=>createMCPUpstreamRouter({routes:[
    {id:"desktop",upstream:dc,exposeNativeNames:true},
    {id:"clash",upstream:dc,exposeNativeNames:true}
  ]}),/ROUTED_TOOL_COLLISION/);
  assert.throws(()=>createMCPUpstreamRouter({routes:[
    {id:"desktop",upstream:dc,exposeNativeNames:true},
    {id:"desktop",upstream:samples}
  ]}),/INVALID_OR_DUPLICATE_ROUTE/);
  const writable=await realpath(await mkdtemp(path.join(tmpdir(),'gateway-real-write-')));
  try{
    const policy=await createProjectPolicy({root:writable,mode:'read-write'});
    const invocation=await policy.prepare('write_file',{path:'roundtrip.txt',content:'TS_REAL_DC_ROUNDTRIP'});
    const written=await router.forwardWorkspaceInvocation(invocation);
    assert.notEqual(written.isError,true);
    assert.equal(await readFile(path.join(writable,'roundtrip.txt'),'utf8'),'TS_REAL_DC_ROUNDTRIP');
    const read=await router.forwardWorkspaceInvocation(await policy.prepare('read_file',{path:'roundtrip.txt'}));
    assert.match(JSON.stringify(read),/TS_REAL_DC_ROUNDTRIP/);
  }finally{await rm(writable,{recursive:true,force:true});}
  console.log("MCP_ROUTER_UPSTREAM_NATIVE_CATALOG_PLUS_NAMESPACED_ROUTE_PASS");
  console.log("MCP_ROUTER वास्तविक_DC_READ_AND_MOCK_UPSTREAM_CALL_PASS");
}finally{await dc.close();}
