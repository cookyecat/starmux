import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {mkdtemp,realpath,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createAccessControl} from '../src/access-control.js';
import {createGatewayRuntime} from '../src/dc-workspace-http.js';
import {discoverOAuth,validateOAuthConfig} from '../src/oauth-resource.js';

// The issuer fixture signs JWTs, but does not pretend to implement OAuth login.
// The separate Keycloak test exercises real authorization code and refresh.
test('OAuth discovery, JWT validation, live revocation and preserved MCP policy', {timeout:180000},async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'gateway-oauth-')));
 const file=join(root,'private','access.json');
 let pair=await generateKeyPair('RS256');let kid='first';let issuer='';let broken=false;
 let metadataOverrides:Record<string,unknown>={};
 const server=createServer(async(req,res)=>{
   if(broken){res.writeHead(503).end();return;}
   if(req.url==='/keys'){res.setHeader('content-type','application/json');res.end(JSON.stringify({keys:[{...await exportJWK(pair.publicKey),kid}]}));return;}
   if(req.url==='/realm/.well-known/openid-configuration'){
    res.setHeader('content-type','application/json');res.end(JSON.stringify({issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',
     jwks_uri:issuer.replace('/realm','/keys'),code_challenge_methods_supported:['S256'],response_types_supported:['code'],token_endpoint_auth_methods_supported:['none'],...metadataOverrides}));return;
   }
   res.writeHead(404).end();
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const address=server.address();assert.ok(address&&typeof address!=='string');issuer=`http://127.0.0.1:${address.port}/realm`;
 const resource='https://gateway.example/mcp';
 const input={issuer,resource,clientId:'chatgpt-test',allowedSubjects:['owner'],allowLoopbackHttp:true};
 const access=await createAccessControl(file);
 const events:Record<string,unknown>[]=[];
 const runtime=createGatewayRuntime({env:{MAC_MCP_PROJECT_ROOT:root,MAC_MCP_PROJECT_PORT:'0',MAC_MCP_ACCESS_FILE:file},audit:e=>{events.push(e);}});
 const now=()=>Math.floor(Date.now()/1000);
 async function token(overrides:Record<string,unknown>={}){
  return new SignJWT({iss:issuer,aud:resource,sub:'owner',azp:'chatgpt-test',sid:'session1',scope:'gateway:access',iat:now(),exp:now()+300,...overrides})
   .setProtectedHeader({alg:'RS256',kid}).sign(pair.privateKey);
 }
 try{
  await assert.rejects(discoverOAuth({...input,allowLoopbackHttp:false}),/HTTPS/);
  metadataOverrides={code_challenge_methods_supported:['plain']};await assert.rejects(discoverOAuth(input),/PKCE/);
  metadataOverrides={issuer:issuer+'/wrong'};await assert.rejects(discoverOAuth(input),/ISSUER/);
  metadataOverrides={};await assert.rejects(discoverOAuth({...input,clientRegistration:'cimd'}),/CIMD/);
  const config=await discoverOAuth(input);
  assert.throws(()=>validateOAuthConfig({...config,jwksUri:'https://other.example/keys'}),/ORIGIN/);
  await access.configureOAuth(config);assert.equal((await access.snapshot()).mode,'ingress');
  await access.setMode('oauth');await runtime.start();const base=`http://127.0.0.1:${runtime.port}`;
  const meta=await fetch(base+'/.well-known/oauth-protected-resource/mcp',{headers:{origin:'https://chatgpt.com'}});
  assert.equal(meta.status,200);assert.deepEqual(await meta.json(),{resource,authorization_servers:[issuer],scopes_supported:['gateway:access'],bearer_methods_supported:['header']});
  assert.equal((await fetch(base+'/mcp')).status,401);
  async function rpc(secret?:string,method='tools/list',params:unknown={}){
   return fetch(base+'/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',...(secret?{authorization:'Bearer '+secret}:{})},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  }
  const missing=await rpc();assert.equal(missing.status,401);assert.match(missing.headers.get('www-authenticate')||'',/resource_metadata="https:\/\/gateway.example\/\.well-known\/oauth-protected-resource\/mcp"/);
  const bad:[Record<string,unknown>,number][]=[[{iss:'wrong'},401],[{aud:'wrong'},401],[{exp:now()-1},401],[{nbf:now()+60},401],
    [{sub:'other'},403],[{azp:'other'},401],[{scope:'files:read'},403],[{sid:''},401],[{iat:now()+60},401]];
  const before=events.length;
  for(const [payload,status] of bad)assert.equal((await rpc(await token(payload))).status,status,JSON.stringify(payload));
  assert.equal((await rpc('mgw_'+'a'.repeat(43))).status,401);assert.equal(events.length,before);
  const valid=await token();assert.equal((await rpc(valid)).status,200);
  const alias='https://tunnel.example/v1/mcp/owner-tunnel';
  const aliasToken=await token({aud:alias});
  assert.equal((await rpc(aliasToken)).status,401);
  for(const invalid of ['http://remote.example/mcp','https://tunnel.example/mcp#fragment','https://user:pass@tunnel.example/mcp'])
   assert.throws(()=>validateOAuthConfig({...config,resourceAliases:[invalid]}),/HTTPS/);
  await access.configureOAuth({...config,resourceAliases:[alias]});
  const cli=fileURLToPath(new URL('../src/cli/mac-mcp-gateway.js',import.meta.url));
  const invoke=(args:string[])=>promisify(execFile)(process.execPath,[cli,'access','oauth',...args],
    {env:{...process.env,MAC_MCP_ACCESS_FILE:file}});
  assert.match((await invoke(['doctor'])).stdout,/"PASS"/);
  const configure=['configure','--issuer',issuer,'--resource',resource,'--client-id','chatgpt-test',
    '--subjects','owner','--allow-loopback-http'];
  await invoke([...configure,'--resource-aliases',alias]);
  assert.deepEqual((await access.snapshot()).oauth?.resourceAliases,[alias]);
  await assert.rejects(invoke([...configure,'--resource-aliases','http://remote.example/mcp']));
  metadataOverrides={jwks_uri:issuer+'/different-keys'};
  await assert.rejects(invoke(['doctor']),/OAUTH_METADATA_CHANGED_RECONFIGURE/);
  metadataOverrides={};
  assert.equal((await rpc(aliasToken)).status,200);
  assert.equal((await rpc(await token({aud:alias+'-other'}))).status,401);
  assert.equal((await rpc(await token({aud:alias,iss:'wrong'}))).status,401);
  assert.equal((await rpc(await token({aud:alias,sub:'other'}))).status,403);
  assert.equal((await rpc(await token({aud:alias,scope:'wrong'}))).status,403);
  await access.configureOAuth(config);
  assert.equal((await rpc(aliasToken)).status,401);
  const listed=await (await rpc(valid)).json() as {result:{tools:{name:string;securitySchemes:unknown}[]}};
  assert.ok(listed.result.tools.some(t=>t.name==='read_file'));
  assert.ok(listed.result.tools.every(t=>JSON.stringify(t.securitySchemes)==='[{"type":"oauth2","scopes":["gateway:access"]}]'));
  const read=await (await rpc(valid,'tools/call',{name:'list_directory',arguments:{path:'.',depth:0}})).json() as {result:{isError?:boolean}};assert.notEqual(read.result.isError,true);
  const denied=await (await rpc(valid,'tools/call',{name:'write_file',arguments:{path:'no.txt',content:'no'}})).json() as {result:{isError:boolean}};assert.equal(denied.result.isError,true);
  const c=(await access.snapshot()).oauthConnections[0]!;
  assert.ok(c.id);assert.ok(!JSON.stringify(events).includes(valid));
  await access.revokeOAuth(c.id);
  assert.equal((await rpc(valid)).status,401);assert.equal((await rpc(await token({jti:'refreshed'}))).status,401);
  assert.equal((await rpc(await token({sid:'new-owner-login'}))).status,200);
  // Rotation refreshes JWKS after cooldown; no accepted-token cache bypasses revocation.
  await new Promise(r=>setTimeout(r,1100));pair=await generateKeyPair('RS256');kid='rotated';
  assert.equal((await rpc(await token({sid:'new-owner-login'}))).status,200);
  const saved=await readFile(file,'utf8');assert.ok(!saved.includes(valid));
  await writeFile(file,'{}');assert.equal((await rpc(valid)).status,503);await writeFile(file,saved);
  broken=true;await assert.rejects(discoverOAuth(input),/DISCOVERY/);
  await access.setMode('ingress');assert.equal((await rpc()).status,200);
  assert.equal((await fetch(base+'/.well-known/oauth-protected-resource')).status,404);
 }finally{await runtime.close();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
