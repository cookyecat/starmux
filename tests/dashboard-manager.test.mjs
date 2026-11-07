import test from 'node:test';
import {request as httpRequest} from 'node:http';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fork,execFileSync} from 'node:child_process';

test('independent manager authenticates, preserves revisions, and manages stopped instances',{timeout:60000},async t=>{
 const home=await realpath(await mkdtemp(path.join(tmpdir(),'starmux-dashboard-')));const project=path.join(home,'project');await mkdir(project);
 const child=fork(new URL('../dist/src/cli/dashboard-worker.js',import.meta.url),[],{env:{...process.env,HOME:home,USERPROFILE:home},stdio:['ignore','pipe','pipe','ipc']});let errors='';child.stderr.on('data',x=>errors+=x);
 let instanceId; t.after(async()=>{if(instanceId)try{execFileSync(process.execPath,[new URL('../bin/starmux.mjs',import.meta.url).pathname,'down','-i',instanceId],{env:{...process.env,HOME:home,USERPROFILE:home},stdio:'ignore',timeout:15000});}catch{}child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));await rm(home,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Manager timeout '+errors)),10000);child.once('message',()=>{clearTimeout(timer);resolve();});child.once('exit',()=>{clearTimeout(timer);reject(Error(errors));});});
 const record=JSON.parse(await readFile(path.join(home,'.config/starmux/dashboard/manager.json'),'utf8'));const base=`http://127.0.0.1:${record.port}`;
 const request=(route,b,headers={})=>fetch(base+'/api/v1/'+route,{headers:{authorization:'Bearer '+record.token,...(b?{origin:base,'content-type':'application/json'}:{}),...headers},...(b?{method:'POST',body:JSON.stringify(b)}:{})});
 assert.equal((await fetch(base+'/api/v1/instances')).status,401);
 assert.equal(await new Promise((resolve,reject)=>{const req=httpRequest(base+'/api/v1/instances',{headers:{host:'evil.example',authorization:'Bearer '+record.token}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();}),403);
 assert.equal((await request('instances',{}, {origin:'https://evil.example'})).status,403);
 assert.equal((await fetch(base)).status,200);
 assert.match(await (await fetch(base+'/app.js')).text(),/starmux-manager-token/);
 const created=await request('instances',{name:'Test <instance>',config:{schemaVersion:1,projectRoot:project,port:19876}});assert.equal(created.status,200);const i=await created.json();instanceId=i.id;
 const config=await (await request(`instances/${i.id}/config`)).json();assert.ok(config.revision,JSON.stringify(config));
 const validated=await (await request(`instances/${i.id}/config`,{text:config.text,patch:{port:19877},validate:true})).json();assert.equal(validated.config.port,19877);assert.match(validated.text,/\$schema/);
 assert.equal((await request(`instances/${i.id}/config`,{text:validated.text,revision:'stale'})).status,409);
 assert.equal((await request(`instances/${i.id}/config`,{text:validated.text,revision:config.revision})).status,200);
 const key=await (await request(`instances/${i.id}/access`,{op:'create',name:'Browser test'})).json();assert.ok(key.created.key.startsWith('smx_'));
 assert.equal((await request('instances',undefined,{authorization:'Bearer '+key.created.key})).status,401);
 const snapshot=await (await request(`instances/${i.id}/access`)).json();assert.equal(snapshot.created,undefined);assert.ok(!JSON.stringify(snapshot).includes(key.created.key));
 assert.equal((await request(`instances/${i.id}/logs?kind=../../secret`)).status,400);
 assert.equal((await request(`instances/${i.id}/config`,{unexpected:1})).status,400);
 assert.equal((await request(`instances/${i.id}/permissions`)).status,410);
 const list=await (await request('instances')).json();assert.equal(list.instances[0].phase,'stopped');
 const action=async(action,extra={})=>{const r=await request(`instances/${i.id}/actions`,{action,...extra});assert.equal(r.status,202);const operation=await r.json();for(let n=0;n<120;n++){const status=await (await request('operations/'+operation.id)).json();if(status.state==='error')throw Error(status.error);if(status.state==='complete')return;await new Promise(r=>setTimeout(r,100));}throw Error('operation timeout');};
 await action('start');assert.equal((await (await request(`instances/${i.id}/status`)).json()).phase,'running');
 await action('stop');assert.equal((await (await request(`instances/${i.id}/status`)).json()).phase,'stopped');
 assert.equal((await fetch(base)).status,200,'manager survives stopping instance');
 await action('start');await action('stop');await action('archive');await action('restore');

});
