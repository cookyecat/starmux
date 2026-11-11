// Copied into a production-only consumer by scripts/verify-package.mjs.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {defineMiddleware} from 'starmux/middleware';
assert.equal(defineMiddleware({apiVersion:1}).apiVersion,1);
const execute=promisify(execFile),root=process.cwd(),home=path.join(root,'home'),project=path.join(home,'project'),temp=path.join(home,'tmp');
await mkdir(project,{recursive:true});await mkdir(temp,{recursive:true});await writeFile(path.join(project,'hello.txt'),'production-package-smoke');
const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const cli=path.join(root,'node_modules/starmux/bin/starmux.mjs');
const env={...process.env,HOME:home,USERPROFILE:home,TMPDIR:temp,TMP:temp,TEMP:temp};
const run=async(...args)=>JSON.parse((await execute(process.execPath,[cli,...args,'--json'],{env,timeout:90000})).stdout);
let client;
try{
 await run('init',project,'--read','--local','--port',String(port),'-y');
 await run('middleware','add',JSON.stringify({id:'production-plugin',module:path.join(root,'plugin.mjs'),options:{}}));
 await run('up');
 client=new Client({name:'package-acceptance',version:'1'},{capabilities:{}});await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
 let tools=[],cursor;do{const page=await client.listTools(cursor?{cursor}:undefined);tools.push(...page.tools);cursor=page.nextCursor;}while(cursor);
 assert.ok(tools.some(t=>t.name==='read_file'));assert.ok(tools.some(t=>t.name==='health_check'));assert.ok(!tools.some(t=>t.name==='start_process'));
 const result=await client.callTool({name:'read_file',arguments:{path:path.join(project,'hello.txt')}});assert.equal(result.isError,undefined);assert.ok(JSON.stringify(result).includes('production-package-smoke'));
 assert.equal(result._meta.packageMarker,'initial');
 const before=await run('status');
 const applied=await run('middleware','configure',JSON.stringify({id:'production-plugin',module:path.join(root,'plugin.mjs'),options:{marker:'live'}}));assert.equal(applied.application,'applied');
 const changed=await client.callTool({name:'read_file',arguments:{path:path.join(project,'hello.txt')}});assert.equal(changed._meta.packageMarker,'live');assert.equal((await run('status')).runtime.runId,before.runtime.runId);
 const upstreamFile=path.join(root,'upstream.mjs');await writeFile(upstreamFile,`import {Server} from '@modelcontextprotocol/sdk/server/index.js';import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';const server=new Server({name:'package-fixture',version:'1'},{capabilities:{tools:{}}});server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'inspect',inputSchema:{type:'object'}}]}));server.setRequestHandler(CallToolRequestSchema,async()=>({content:[{type:'text',text:'fixture'}]}));await server.connect(new StdioServerTransport());`);
 const added=await run('server','add',JSON.stringify({command:process.execPath,args:[upstreamFile]}),'--name','fixture');assert.equal(added.application,'applied');assert.equal((await run('server','list')).servers.length,1);
 assert.ok(!(await client.listTools()).tools.some(t=>t.name==='fixture__inspect'));assert.equal((await client.callTool({name:'fixture__inspect'})).isError,true);
 assert.equal((await run('server','disable','fixture')).application,'applied');assert.equal((await run('server','remove','fixture')).application,'applied');assert.equal((await run('status')).runtime.runId,before.runtime.runId);
 const denied=await client.callTool({name:'start_process',arguments:{command:'echo should-not-execute'}});assert.equal(denied.isError,true);
 await client.close();client=undefined;await run('down');
 assert.equal((await run('status')).phase,'stopped');
 console.log('PASS: production install, CLI start/stop, complete catalog, read-only call, plugin runtime and public export.');
}finally{await client?.close();await run('down').catch(()=>{});}
