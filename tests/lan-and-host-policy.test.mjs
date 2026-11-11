import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {request} from 'node:http';
import {createServer,createConnection,Server} from 'node:net';
import {mkdtemp,mkdir,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {isAllowedGatewayHost,isClientFacingGatewayRoute,isLoopbackSocketAddress,isValidHttpHostAuthority} from '../dist/src/http-host-policy.js';
import {createGatewayRuntime} from '../dist/src/dc-workspace-http.js';
import {createAccessControl} from '../dist/src/access-control.js';
import {availablePort,createInstance,instanceConfigSchema,loadInstanceConfig,suggestPort} from '../dist/src/instance-store.js';
import {lanIpv4Addresses} from '../dist/src/cli/starmux-status.js';

const publicRoutes=['/mcp','/healthz','/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'];
const ownerRoutes=['/catalog.json','/access','/dashboard','/dashboard.json','/permissions','/filters','/activity.json','/tool-calls.json','/privacy/status','/unknown','/mcp/','/.well-known/oauth-protected-resource-evil'];
const validHosts=['127.0.0.1:18893','localhost:18893','localhost','192.168.1.50:18893','100.101.102.103:18893','[fd7a:115c:a1e0::1]:18893','[::ffff:192.168.1.1]','mcp.example.com','demo-tunnel.trycloudflare.com','mac.tail1234.ts.net:443','jetson.local'];
const invalidHosts=['','evil.com/path','user@evil.com','evil.com evil.org','evil.com,evil.org','evil.com\\path','x:70000','x:0','x:','x:-1','x:1.1','x:1:2','[bad:ip]','[:::]','[::1]tail','::1','[]','-evil.com','evil-.com','x..com','.x','x.','999.999.1.1','127.1','x#fragment','x?query','x\t','x\n','x\x00','a'.repeat(256)];
const hostRequest=host=>({headers:{host},rawHeaders:['Host',host]});

test('client authorities accept LAN and tunnel hosts; owner routes remain listener-specific',()=>{
  for(const route of publicRoutes){
    assert.equal(isClientFacingGatewayRoute(route),true);
    for(const host of validHosts)assert.equal(isAllowedGatewayHost(hostRequest(host),18893,route),true,`${route}: ${host}`);
  }
  for(const route of ownerRoutes){
    assert.equal(isClientFacingGatewayRoute(route),false);
    for(const host of ['127.0.0.1:18893','localhost:18893','LOCALHOST:18893'])assert.equal(isAllowedGatewayHost(hostRequest(host),18893,route),true);
    for(const host of ['192.168.1.50:18893','mcp.example.com','localhost','localhost:18894','127.0.0.1:018893'])assert.equal(isAllowedGatewayHost(hostRequest(host),18893,route),false);
  }
  for(const route of [...publicRoutes,...ownerRoutes]){
    for(const host of invalidHosts)assert.equal(isAllowedGatewayHost(hostRequest(host),18893,route),false,`${route}: ${JSON.stringify(host)}`);
    assert.equal(isAllowedGatewayHost({headers:{},rawHeaders:[]},18893,route),false);
    assert.equal(isAllowedGatewayHost({headers:{host:'localhost:18893'},rawHeaders:['Host','localhost:18893','hOsT','evil.com']},18893,route),false);
  }
  for(const port of [null,0,-1,65536,1.5,NaN])assert.equal(isAllowedGatewayHost(hostRequest('localhost'),port,'/mcp'),false);
  for(const host of invalidHosts)assert.equal(isValidHttpHostAuthority(host),false);
  assert.equal(isLoopbackSocketAddress('127.0.0.1'),true);
  assert.equal(isLoopbackSocketAddress('::ffff:127.0.0.1'),true);
  for(const address of [undefined,'192.168.1.20','100.64.0.2','127.0.0.2'])assert.equal(isLoopbackSocketAddress(address),false);
});

async function temporary(t){
  const home=await mkdtemp(path.join(await realpath(tmpdir()),'starmux-lan-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  return home;
}
async function gateway(t,allowLan){
  const home=await temporary(t);const project=path.join(home,'project');await mkdir(project);
  const accessFile=path.join(home,'access','access.json');const access=await createAccessControl(accessFile);
  const audits=[];
  const runtime=createGatewayRuntime({env:{STARMUX_PROJECT_ROOT:project,STARMUX_PROJECT_PORT:'0',
    STARMUX_PERMISSION_MODE:'global',STARMUX_ALLOW_LAN:allowLan?'1':'0',STARMUX_ACCESS_FILE:accessFile},audit:event=>audits.push(event)});
  t.after(()=>runtime.close());await runtime.start();
  assert.ok(audits.some(event=>event.event==='PROJECT_WORKSPACE_LISTENING'&&event.allowLan===allowLan&&event.host===(allowLan?'0.0.0.0':'127.0.0.1')));
  return {port:runtime.port,access,audits};
}
function send(port,route,{hostname='127.0.0.1',host=`${hostname}:${port}`,method='GET',headers={},body}={}){
  return new Promise((resolve,reject)=>{
    const req=request({hostname,port,path:route,method,headers:{Host:host,...headers},agent:false},res=>{
      let text='';res.setEncoding('utf8');res.on('data',chunk=>{text+=chunk;});res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));
    });
    req.setTimeout(5000,()=>req.destroy(Error('HTTP_TEST_TIMEOUT')));req.on('error',reject);req.end(body);
  });
}
const initialization={method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'lan-test',version:'1'}}})};
function assertInitialized(response){assert.equal(response.status,200,response.text);const data=response.headers['content-type']?.includes('text/event-stream')?response.text.split('\n').find(line=>line.startsWith('data: '))?.slice(6):response.text;assert.ok(JSON.parse(data).result.serverInfo);}

test('default listener supports unchanged tunnel Host, rejects rebinding, and remains physically loopback-only',{timeout:30000},async t=>{
  const {port,audits}=await gateway(t,false);
  const tunnel={host:'my-tunnel.trycloudflare.com'};
  const health=await send(port,'/healthz',tunnel);assert.equal(health.status,200);assert.equal(JSON.parse(health.text).allowLan,false);
  assertInitialized(await send(port,'/mcp',{...initialization,...tunnel}));
  for(const route of ownerRoutes){
    const denied=await send(port,route,{host:'evil-rebind.com:18893'});
    assert.equal(denied.status,403,route);assert.equal(denied.text,'HOST_NOT_ALLOWED');
  }
  for(const route of publicRoutes.slice(2))assert.equal((await send(port,route,tunnel)).status,404,'unconfigured metadata reaches its handler');
  assert.ok(audits.some(event=>event.event==='HTTP_REQUEST_DENIED'&&event.reason==='HOST_NOT_ALLOWED'));
  await t.test('non-loopback connection is refused',async t=>{
    const lanIp=lanIpv4Addresses()[0];if(!lanIp){t.skip('No non-internal IPv4 interface');return;}
    await assert.rejects(send(port,'/healthz',{hostname:lanIp}),{code:'ECONNREFUSED'});
  });
});

test('LAN listener exposes MCP while owner routes stay local; Origin and API keys still apply',{timeout:30000},async t=>{
  const {port,access,audits}=await gateway(t,true);
  for(const route of ['/access','/dashboard.json'])assert.equal((await send(port,route)).status,200);
  assert.equal((await send(port,'/access',{host:`192.168.1.50:${port}`})).status,403);
  const origin=await send(port,'/mcp',{...initialization,headers:{...initialization.headers,Origin:'https://evil.com'}});
  assert.equal(origin.status,403);
  await t.test('real non-loopback requests and spoofed Host/forwarded headers',async t=>{
    const lanIp=lanIpv4Addresses()[0];if(!lanIp){t.skip('No non-internal IPv4 interface');return;}
    const health=await send(port,'/healthz',{hostname:lanIp});assert.equal(health.status,200);assert.equal(JSON.parse(health.text).allowLan,true);
    assertInitialized(await send(port,'/mcp',{...initialization,hostname:lanIp}));
    for(const route of ownerRoutes){
      for(const host of [`${lanIp}:${port}`,`127.0.0.1:${port}`]){
        const denied=await send(port,route,{hostname:lanIp,host,headers:{'X-Forwarded-For':'127.0.0.1','X-Forwarded-Host':`localhost:${port}`}});
        assert.equal(denied.status,403,route);assert.equal(denied.text,'LOOPBACK_REQUIRED');
      }
    }
    assert.ok(audits.some(event=>event.event==='HTTP_REQUEST_DENIED'&&event.reason==='LOOPBACK_REQUIRED'));
    const credential=await access.create('test-client',null,true);
    assert.equal((await send(port,'/mcp',{...initialization,hostname:lanIp})).status,401);
    assertInitialized(await send(port,'/mcp',{...initialization,hostname:lanIp,headers:{...initialization.headers,Authorization:`Bearer ${credential.key}`}}));
    await access.revoke(credential.id);
    assert.equal((await send(port,'/mcp',{...initialization,hostname:lanIp,headers:{...initialization.headers,Authorization:`Bearer ${credential.key}`}})).status,401);
  });
});

test('legacy config omitting allowLan loads with false',async t=>{
  const home=await temporary(t);
  const instance=await createInstance('legacy',{config:instanceConfigSchema.parse({schemaVersion:1,projectRoot:home,port:18893})},home);
  await writeFile(instance.source.path,JSON.stringify({schemaVersion:1,projectRoot:home,port:18893}),{mode:0o600});
  assert.equal((await loadInstanceConfig(instance)).config.allowLan,false);
});

test('wildcard port check detects loopback and LAN-specific port occupation',async t=>{
  const lanIp=lanIpv4Addresses()[0];
  for(const address of ['127.0.0.1',...(lanIp?[lanIp]:[])]){
    const server=createServer();t.after(()=>new Promise(resolve=>server.close(resolve)));
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,address,resolve);});
    assert.equal(await availablePort(server.address().port,'0.0.0.0'),false);
    if(address==='127.0.0.1')assert.equal(await availablePort(server.address().port),false);
  }
});


test('LAN port suggestions and CLI init/copy skip ports occupied only on another interface',async t=>{
  const lanIp=lanIpv4Addresses()[0];if(!lanIp){t.skip('No non-internal IPv4 interface');return;}
  const home=await temporary(t);
  const candidate=await suggestPort(home);
  const blocker=createServer();t.after(()=>new Promise(resolve=>blocker.close(resolve)));
  await new Promise((resolve,reject)=>{blocker.once('error',reject);blocker.listen(candidate,lanIp,resolve);});
  assert.equal(await availablePort(candidate),true,'loopback alone does not detect this conflict');
  assert.notEqual(await suggestPort(home,'0.0.0.0'),candidate);
  const run=async(...args)=>{
    const result=await promisify(execFile)(process.execPath,[path.resolve('bin/starmux.mjs'),...args,'--json'],{
      env:{...process.env,HOME:home,USERPROFILE:home},timeout:20000
    });return JSON.parse(result.stdout);
  };
  const initialized=await run('init',home,'-i','lan-new','--allow-lan');
  const first=(await loadInstanceConfig(initialized.instance)).config;
  assert.equal(first.allowLan,true);assert.notEqual(first.port,candidate);
  const copied=await run('config','copy','lan-copy','-i','lan-new');
  const second=(await loadInstanceConfig(copied.instance)).config;
  assert.equal(second.allowLan,true);assert.notEqual(second.port,candidate);assert.notEqual(second.port,first.port);
});

test('port probes close connections accepted during their bind check',{timeout:5000},async t=>{
  const listen=Server.prototype.listen;
  const sockets=[];const servers=[];
  t.after(()=>{
    for(const socket of sockets)socket.destroy();
    for(const server of servers)try{server.close();}catch{}
  });
  // Deterministically deliver a real TCP connection before the probe closes.
  // A bare net.Server.close() otherwise waits forever for this idle peer.
  t.mock.method(Server.prototype,'listen',function(port,host,callback){
    servers.push(this);
    return listen.call(this,port,host,()=>{
      const socket=createConnection({host,port:this.address().port});sockets.push(socket);
      socket.on('error',()=>this.close());socket.once('connect',callback);
    });
  });
  let timer;
  try{
    assert.equal(await Promise.race([availablePort(0),new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(Error('Port probe hung on an idle TCP connection')),1000);
    })]),true);
  }finally{clearTimeout(timer);}
});


test('original tunnel Host supports OAuth discovery and preserves the authentication challenge',{timeout:30000},async t=>{
  const {port,access}=await gateway(t,false);
  await access.configureOAuth({issuer:'https://issuer.example.com',resource:'https://mcp.example.com/mcp',
    jwksUri:'https://issuer.example.com/jwks',authorizationEndpoint:'https://issuer.example.com/authorize',
    tokenEndpoint:'https://issuer.example.com/token',clientRegistration:'provided',clientId:'test',
    tokenEndpointAuthMethod:'none',allowedSubjects:['owner']});
  await access.setMode('oauth');
  for(const route of ['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp']){
    const response=await send(port,route,{host:'original-tunnel.example.com',headers:{Origin:'https://client.example.com'}});
    assert.equal(response.status,200,response.text);
    assert.equal(JSON.parse(response.text).resource,'https://mcp.example.com/mcp','Host cannot redefine the configured OAuth audience');
    assert.equal((await send(port,route,{host:'original-tunnel.example.com',method:'OPTIONS'})).status,204);
  }
  const unauthorized=await send(port,'/mcp',{...initialization,host:'original-tunnel.example.com'});
  assert.equal(unauthorized.status,401);
  assert.match(unauthorized.headers['www-authenticate'],/resource_metadata="https:\/\/mcp\.example\.com\/\.well-known\/oauth-protected-resource\/mcp"/);
});

test('wire-level Host validation rejects malformed requests without weakening owner routing',{timeout:30000},async t=>{
  const {port}=await gateway(t,false);
  const raw=(headers,route='/healthz')=>new Promise((resolve,reject)=>{
    let response='';const socket=createConnection({host:'127.0.0.1',port},()=>{
      socket.write(`GET ${route} HTTP/1.1\r\n${headers}Connection: close\r\n\r\n`);
    });
    socket.setTimeout(3000,()=>socket.destroy(Error('HTTP_TEST_TIMEOUT')));
    socket.on('error',reject);socket.on('data',data=>{response+=data;});socket.on('end',()=>resolve(response));
  });
  // Depending on Node's HTTP parser version, a missing Host is rejected before
  // the request reaches our handler (400), or by the Host policy itself (403).
  assert.match(await raw(''),/^HTTP\/1\.1 (400|403) /);
  for(const headers of ['Host: mcp.example.com\r\nHost: evil.example.com\r\n',
    'Host: evil.com/path\r\n','Host: user@evil.com\r\n','Host: evil.com other.com\r\n',
    'Host: evil.com:70000\r\n']){
    const response=await raw(headers);assert.match(response,/^HTTP\/1\.1 403 /);assert.match(response,/HOST_NOT_ALLOWED/);
  }
  assert.match(await raw('Host:   mcp.example.com   \r\n'),/^HTTP\/1\.1 200 /,'HTTP field padding is allowed');
  for(const route of ['/mcp/../access','/.well-known/oauth-protected-resource/../../access','/mcp/%2e%2e/access']){
    assert.match(await raw('Host: tunnel.example.com\r\n',route),/HOST_NOT_ALLOWED/,'normalized owner paths retain owner policy');
  }
});
