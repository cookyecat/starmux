import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createGatewayRuntime} from '../dist/src/dc-workspace-http.js';
import {ManagedStdioTransport} from '../dist/src/managed-stdio-transport.js';

async function waitUntil(predicate){
  const end=Date.now()+20000;
  while(!await predicate()){
    assert.ok(Date.now()<end,'Desktop Commander did not reach the expected state');
    await delay(25);
  }
}

test('a disconnected desktop engine reports degraded and resumes reads in the existing MCP session',async t=>{
  const home=await mkdtemp(path.join(tmpdir(),'starmux-desktop-home-'));
  const previous={HOME:process.env.HOME,USERPROFILE:process.env.USERPROFILE};
  process.env.HOME=process.env.USERPROFILE=home;
  t.after(async()=>{
    for(const [key,value] of Object.entries(previous)){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
    await rm(home,{recursive:true,force:true});
  });
  const start=ManagedStdioTransport.prototype.start;
  const children=[];
  t.mock.method(ManagedStdioTransport.prototype,'start',async function(){
    await start.call(this);
    children.push(this.pid);
  });
  const callTool=Client.prototype.callTool;
  let releaseProbe;
  const gate=new Promise(resolve=>{releaseProbe=resolve;});
  let verifyingReplacement=false;
  t.mock.method(Client.prototype,'callTool',async function(request,...options){
    if(children.length===2&&request.name==='get_file_info'){
      verifyingReplacement=true;
      await gate;
    }
    return callTool.call(this,request,...options);
  });
  const runtime=createGatewayRuntime({env:{STARMUX_PROJECT_ROOT:process.cwd(),STARMUX_PROJECT_PORT:'0',
    STARMUX_PERMISSION_MODE:'global',STARMUX_ACCESS_FILE:path.join(home,'access.json')},audit:()=>{}});
  const client=new Client({name:'desktop-recovery',version:'1'});
  try{
    await runtime.start();
    const base='http://127.0.0.1:'+runtime.port;
    const health=async()=>{const response=await fetch(base+'/healthz');return {http:response.status,...await response.json()};};
    assert.equal((await health()).desktopCommander,'ready');
    await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp')));
    assert.ok(children[0]>0);
    process.kill(children[0],'SIGKILL');
    await waitUntil(async()=>{const h=await health();return h.http===503&&h.status==='degraded'&&h.desktopCommander==='unavailable';});
    await waitUntil(()=>verifyingReplacement);
    assert.equal((await health()).http,503);
    assert.equal((await client.callTool({name:'health_check',arguments:{}})).isError,true);
    releaseProbe();
    await waitUntil(async()=>{const h=await health();return h.http===200&&h.desktopCommander==='ready';});
    assert.equal(children.length,2);
    const result=await client.callTool({name:'read_file',arguments:{path:path.resolve('LICENSE'),offset:0,length:3}});
    assert.ok(!result.isError);
    assert.match(JSON.stringify(result.content),/MIT License/i);
  }finally{releaseProbe();await client.close();await runtime.close();}
});
