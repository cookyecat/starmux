import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export async function checkReadOnlyGrants(page){
 const home=await mkdtemp(path.join(await realpath(tmpdir()),'starmux-web-grants-'));
 const cli=async(...args)=>JSON.parse((await promisify(execFile)(process.execPath,[path.resolve('bin/starmux.mjs'),...args,'--json'],
   {env:{...process.env,HOME:home,USERPROFILE:home},timeout:40000})).stdout);
 const client=new Client({name:'web-grants-smoke',version:'1'});
 const query=()=>client.callTool({name:'reports__query',arguments:{status:'active'}});
 async function checkShell(){
   assert.ok(!(await client.listTools()).tools.some(tool=>tool.name==='start_process'));
   const shell=await client.callTool({name:'start_process',arguments:{command:'echo shell-probe',timeout_ms:1000}});
   assert.equal(shell.isError,true);
   assert.match(shell.content[0].text,/READ_ONLY_MODE/);
 }
 try{
   const portProbe=createServer();
   await new Promise((resolve,reject)=>{portProbe.once('error',reject);portProbe.listen(0,'127.0.0.1',resolve);});
   const port=portProbe.address().port;await new Promise(resolve=>portProbe.close(resolve));
   const status=await cli('up',home,'--read','--port',String(port));
   const def={id:'reports',command:process.execPath,args:[path.resolve('tests/fixtures/report-query.mjs')],allowTools:['query','list_all']};
   assert.equal((await cli('server','add',JSON.stringify(def))).application,'applied');
   const transport=new StreamableHTTPClientTransport(new URL(status.localEndpoint));
   await client.connect(transport);
   const sessionId=transport.sessionId;
   assert.ok(sessionId);
   assert.equal((await query()).isError,true);
   await checkShell();

   await page.goto((await cli('dashboard','--page','servers','--no-open')).url);
   const selector='input[data-read-grant="reports"][value="query"]';
   async function toggle(selector,enabled){
     await page.waitForSelector(selector);
     assert.equal(await page.$eval(selector,field=>field.checked),!enabled);
     const revision=await page.$eval(selector,field=>field.dataset.revision);
     await page.click(selector);
     await page.waitForFunction(({selector,revision,enabled})=>{
       const field=document.querySelector(selector);
       return field&&!field.disabled&&field.checked===enabled&&field.dataset.revision!==revision;
     },{selector,revision,enabled});
   }
   const listAll=()=>client.callTool({name:'reports__list_all',arguments:{}});
   await toggle(selector,true);
   assert.ok((await client.listTools()).tools.some(tool=>tool.name==='reports__query'));
   assert.deepEqual(JSON.parse((await query()).content[0].text),{count:7});
   assert.equal((await listAll()).isError,true);
   await checkShell();
   // Clear the saved grant separately, then revoke the still-live permission from the console.
   const granted=await cli('status');
   const upstream=granted.saved.config.upstreams[0];
   delete upstream.allowToolsInReadOnly;
   const cleared=await cli('config','patch','--revision',granted.revision,'--patch',JSON.stringify({upstreams:[upstream]}));
   await page.reload();
   await page.waitForSelector(selector);
   assert.equal(await page.$eval(selector,field=>field.checked),true);
   await page.click(selector);
   await page.waitForFunction(selector=>{
     const field=document.querySelector(selector);
     return field&&!field.disabled&&!field.checked;
   },selector);
   assert.match((await query()).content[0].text,/READ_ONLY_MODE/);
   const reconciled=await cli('status');
   assert.equal(reconciled.revision,cleared.revision);
   assert.equal(reconciled.configState,'applied');
   await toggle(selector,true);
   await toggle('input[data-read-grant="reports"][value="list_all"]',true);

   await cli('init','--code','--yes');
   const pending=await cli('status');
   assert.equal(pending.configState,'pending');
   assert.equal(pending.saved.config.mode,'read-write');
   assert.equal(pending.active.config.mode,'read-only');
   assert.deepEqual(JSON.parse((await query()).content[0].text),{count:7});
   await checkShell();

   await page.reload();
   await toggle(selector,false);
   assert.match(await page.$eval('#notice',el=>el.textContent),/Other configuration changes are still pending|其他配置仍待应用/);
   const denied=await query();
   assert.equal(denied.isError,true);
   assert.match(denied.content[0].text,/READ_ONLY_MODE/);
   assert.ok(!(await client.listTools()).tools.some(tool=>tool.name==='reports__query'));
   assert.deepEqual(JSON.parse((await listAll()).content[0].text),[['active',7],['archived',3]]);
   await checkShell();
   const after=await cli('status');
   assert.equal(after.runtime.runId,status.runtime.runId);
   assert.equal(transport.sessionId,sessionId);
   assert.equal(after.configState,'pending');
   assert.equal(after.saved.config.mode,'read-write');
   assert.equal(after.saved.config.accessRole,'trusted');
   assert.equal(after.active.config.mode,'read-only');
   assert.equal(after.active.config.accessRole,'restricted');
   for(const snapshot of [after.saved,after.active,after.lastActive]){
     assert.deepEqual(snapshot.config.upstreams.find(server=>server.id==='reports').allowToolsInReadOnly,['list_all']);
   }
   await page.reload();
   await page.waitForSelector(selector);
   assert.equal(await page.$eval(selector,field=>field.checked),false);

   await toggle(selector,true);
   await page.reload();
   await page.waitForSelector(selector);
   assert.match(await page.$eval(selector,field=>field.parentElement.textContent),/Grant pending|授权待生效/);
   assert.match((await query()).content[0].text,/READ_ONLY_MODE/);
   await toggle(selector,false);

   // A saved service removal can also leave a live grant that still needs revocation.
   await cli('config','patch','--revision',(await cli('status')).revision,'--patch',JSON.stringify({upstreams:[]}));
   await page.reload();
   const remaining='input[data-read-grant="reports"][value="list_all"]';
   await page.waitForSelector(remaining);
   assert.equal(await page.$eval(remaining,field=>field.checked),true);
   await page.click(remaining);
   await page.waitForFunction(selector=>!document.querySelector(selector),remaining);
   assert.match((await listAll()).content[0].text,/READ_ONLY_MODE/);
   assert.equal((await cli('status')).configState,'pending');
   assert.equal(transport.sessionId,sessionId);
   await checkShell();
 }finally{
   await client.close();
   try{await cli('dashboard','stop');await cli('down');}finally{await rm(home,{recursive:true,force:true});}
 }
}
