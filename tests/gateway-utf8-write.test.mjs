import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {request} from 'node:http';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createGatewayRuntime} from '../dist/src/dc-workspace-http.js';

// Send separate writes with a gap so the HTTP reader encounters an incomplete
// UTF-8 sequence. setImmediate alone can let both writes coalesce on loopback.
function sendSplitRequest(url,sessionId,body,split){
 return new Promise((resolve,reject)=>{
  let timer;
  const req=request(url,{method:'POST',headers:{
   'content-type':'application/json',accept:'application/json, text/event-stream',
   'mcp-session-id':sessionId,'mcp-protocol-version':'2025-03-26',
   ...body.headers
  }},res=>{
   const chunks=[];
   res.on('data',chunk=>chunks.push(chunk));
   res.on('error',reject);
   res.on('end',()=>resolve({status:res.statusCode,text:Buffer.concat(chunks).toString('utf8')}));
  });
  req.on('error',reject);
  req.on('close',()=>clearTimeout(timer));
  req.setTimeout(5000,()=>req.destroy(new Error('Split HTTP request timed out')));
  req.write(body.bytes.subarray(0,split));
  timer=setTimeout(()=>req.end(body.bytes.subarray(split)),50);
 });
}

test('write_file preserves UTF-8 on disk across HTTP byte boundaries',{timeout:30000},async t=>{
 await mkdir('.internal',{recursive:true});
 const root=await mkdtemp(path.resolve('.internal/gateway-utf8-write-'));
 const home=path.join(root,'home');await mkdir(home,{mode:0o700});
 const previousHome=process.env.HOME,previousUserProfile=process.env.USERPROFILE;
 process.env.HOME=home;process.env.USERPROFILE=home;
 const runtime=createGatewayRuntime({env:{
  STARMUX_PROJECT_ROOT:root,STARMUX_PROJECT_PORT:'0',STARMUX_PERMISSION_MODE:'global',
  STARMUX_WORKSPACE_MODE:'read-write',STARMUX_DEV_COMMANDS:'trusted-project',
  STARMUX_DC_ACCESS_MODE:'native',STARMUX_ACCESS_FILE:path.join(root,'access.json')
 },audit:()=>{}});
 const client=new Client({name:'utf8-write-regression',version:'1'},{capabilities:{}});
 try{
  await runtime.start();
  const url=new URL(`http://127.0.0.1:${runtime.port}/mcp`);
  const transport=new StreamableHTTPClientTransport(url);await client.connect(transport);
  let id=100;
  for(const chunked of [false,true])for(const mode of ['rewrite','append'])for(const long of [false,true]){
   for(const [character,boundary] of [['我',1],['我',2],['🙂',1],['🙂',2],['🙂',3]]){
    await t.test(`${chunked?'chunked':'Content-Length'} / ${mode} / ${long?'long':'short'} / ${character} byte ${boundary}`,async()=>{
     const file=path.join(root,'target.txt'),prefix='原有内容“保留”🙂\n';
     await writeFile(file,prefix);
     const content=(long?'中文长文本。'.repeat(4096):'')+'引号“我”和表情🙂，结束。\n';
     const callId=id++;
     const bytes=Buffer.from(JSON.stringify({jsonrpc:'2.0',id:callId,method:'tools/call',
      params:{name:'write_file',arguments:{path:file,content,mode}}}));
     const start=bytes.indexOf(Buffer.from(character));assert.ok(start>=0);
     const headers=chunked?{'transfer-encoding':'chunked'}:{'content-length':bytes.length};
     const response=await sendSplitRequest(url,transport.sessionId,{bytes,headers},start+boundary);
     assert.equal(response.status,200);
     const message=response.text.split(/\r?\n/).filter(line=>line.startsWith('data:'))
      .map(line=>JSON.parse(line.slice(5))).find(value=>value.id===callId);
     assert.ok(message,'MCP must return a response for this write');
     assert.equal(message.error,undefined);
     assert.ok(message.result);assert.notEqual(message.result.isError,true);
     // Inspect raw disk bytes, independently of Desktop Commander's read/output
     // paths. Successful tool status alone did not catch the original corruption.
     const actual=await readFile(file);
     const expected=Buffer.from((mode==='append'?prefix:'')+content);
     assert.equal(actual.includes(Buffer.from('\ufffd')),false,'File must not contain replacement characters');
     assert.deepEqual(actual,expected,'Written bytes must exactly match the requested content');
    });
   }
  }
 }finally{
  try{await client.close();}finally{
   try{await runtime.close();}finally{
    if(previousHome===undefined)delete process.env.HOME;else process.env.HOME=previousHome;
    if(previousUserProfile===undefined)delete process.env.USERPROFILE;else process.env.USERPROFILE=previousUserProfile;
    await rm(root,{recursive:true,force:true});
   }
  }
 }
});
