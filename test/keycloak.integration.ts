// Opt-in: GATEWAY_KEYCLOAK_HOME must point to a disposable Keycloak 26.8.1
// distribution. This test imports a temporary realm and changes its data dir.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {decodeJwt} from 'jose';
import {keycloakRealm} from '../src/oauth-keycloak.js';
import {createAccessControl} from '../src/access-control.js';
import {createGatewayRuntime} from '../src/dc-workspace-http.js';
const home=process.env.GATEWAY_KEYCLOAK_HOME;

test('real Keycloak: code + PKCE, consent, audience, refresh rotation and Gateway revocation',
 {skip:!home,timeout:180000},async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'gateway-keycloak-test-')));
 const portProbe=createServer();await new Promise<void>(r=>portProbe.listen(0,'127.0.0.1',r));
 const addr=portProbe.address();assert.ok(addr&&typeof addr!=='string');const port=addr.port;
 await new Promise<void>(r=>portProbe.close(()=>r()));
 const issuer=`http://127.0.0.1:${port}/realms/gateway`;
 const resource='https://gateway.example/mcp',callback='http://127.0.0.1:19999/callback';
 const owner=randomUUID(),password=randomBytes(24).toString('hex'),clientSecret=randomBytes(32).toString('hex');
 const realm={...keycloakRealm(resource,callback,true),accessTokenLifespan:5,
   users:[{id:owner,username:'owner',enabled:true,email:'owner@example.test',emailVerified:true,
     firstName:'Gateway',lastName:'Owner',requiredActions:[],credentials:[{type:'password',value:password,temporary:false}]}]};
 Object.assign(realm.clients[1]!,{secret:clientSecret});
 const importDir=join(home!,'data','import');await mkdir(importDir,{recursive:true});
 const importFile=join(importDir,'gateway-realm.json');await writeFile(importFile,JSON.stringify(realm),{mode:0o600});
 const kc=spawn(join(home!,'bin','kc.sh'),['start-dev','--db=dev-mem','--import-realm','--features=resource-indicators',
   '--http-host=127.0.0.1',`--http-port=${port}`,'--hostname-strict=false'],{stdio:['ignore','pipe','pipe'],env:{...process.env}});
 let logs='';kc.stdout.on('data',b=>{logs=(logs+String(b)).slice(-12000);});kc.stderr.on('data',b=>{logs=(logs+String(b)).slice(-12000);});
 const exited=once(kc,'exit');
 const access=await createAccessControl(join(root,'private','access.json'));
 const runtime=createGatewayRuntime({env:{MAC_MCP_PROJECT_ROOT:root,MAC_MCP_PROJECT_PORT:'0',MAC_MCP_ACCESS_FILE:access.file},audit:()=>{}});
 try{
  let ready=false;
  for(let i=0;i<120;i++){
   if(kc.exitCode!==null)throw Error('KEYCLOAK_START_FAILED: '+logs);
   try{if((await fetch(issuer+'/.well-known/openid-configuration',{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}
   await new Promise(r=>setTimeout(r,500));
  }
  assert.ok(ready,'KEYCLOAK_NOT_READY: '+logs);
  const cli=fileURLToPath(new URL('../src/cli/mac-mcp-gateway.js',import.meta.url));
  const cliEnv={...process.env,MAC_MCP_ACCESS_FILE:access.file};
  await promisify(execFile)(process.execPath,[cli,'access','oauth','configure','--issuer',issuer,
    '--resource',resource,'--client-id','gateway-chatgpt','--subjects',owner,
    '--token-auth','client_secret_basic','--allow-loopback-http'],{env:cliEnv});
  assert.equal((await access.snapshot()).mode,'ingress');
  const doctor=await promisify(execFile)(process.execPath,[cli,'access','oauth','doctor'],{env:cliEnv});
  assert.equal((JSON.parse(doctor.stdout) as {result:string}).result,'PASS');
  await access.setMode('oauth');await runtime.start();
  const endpoint=`http://127.0.0.1:${runtime.port}/mcp`;
  const cookies=new Map<string,string>();
  async function browser(url:string,body?:URLSearchParams){
   const headers:Record<string,string>={cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')};
   if(body)headers['content-type']='application/x-www-form-urlencoded';
   const response=await fetch(url,{method:body?'POST':'GET',headers,...(body?{body}:{}),redirect:'manual'});
   for(const raw of response.headers.getSetCookie()){const pair=raw.split(';')[0]!;const at=pair.indexOf('=');cookies.set(pair.slice(0,at),pair.slice(at+1));}
   return response;
  }
  async function authorize({deny=false,redirect=callback,pkce='S256'}={}){
   const verifier=randomBytes(32).toString('base64url');const state=randomBytes(16).toString('hex');
   const query=new URLSearchParams({client_id:'gateway-chatgpt',redirect_uri:redirect,response_type:'code',scope:'gateway:access',resource,state,
     code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:pkce,prompt:'consent'});
   let response=await browser(issuer+'/protocol/openid-connect/auth?'+query);
   for(let step=0;step<12;step++){
    const redirectLocation=response.headers.get('location');
    if(response.status===302&&redirectLocation&&new URL(redirectLocation,issuer).origin===new URL(issuer).origin){
      response=await browser(new URL(redirectLocation,issuer).href);continue;
    }
    if(response.status!==200)break;
    const html=await response.text();const action=html.match(/<form[^>]*action="([^"]+)"/)?.[1]?.replaceAll('&amp;','&');
    assert.ok(action,'KEYCLOAK_EXPECTED_LOGIN_OR_CONSENT_FORM');
    const data=new URLSearchParams();
    for(const tag of html.matchAll(/<input\b[^>]*>/g)){
      const name=tag[0].match(/\bname="([^"]+)"/)?.[1];const value=tag[0].match(/\bvalue="([^"]*)"/)?.[1];
      if(name&&value!==undefined&&/type="hidden"/.test(tag[0]))data.set(name,value.replaceAll('&amp;','&'));
    }
    if(html.includes('name="username"')||html.includes('name="password"')){data.set('username','owner');data.set('password',password);}
    else data.set(deny?'cancel':'accept',deny?'No':'Yes');
    response=await browser(new URL(action,issuer).href,data);
   }
   return {response,verifier,state};
  }
  async function exchange(code:string,verifier:string){
   return fetch(issuer+'/protocol/openid-connect/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',authorization:'Basic '+Buffer.from('gateway-chatgpt:'+clientSecret).toString('base64')},
    body:new URLSearchParams({grant_type:'authorization_code',client_id:'gateway-chatgpt',redirect_uri:callback,code,code_verifier:verifier,resource})});
  }
  const wrongCallback=await authorize({redirect:'http://127.0.0.1:19999/wrong'});assert.equal(wrongCallback.response.status,400);
  const noPKCE=await authorize({pkce:'plain'});assert.ok(noPKCE.response.status===400||noPKCE.response.headers.get('location')?.includes('error='));
  const denial=await authorize({deny:true});assert.match(denial.response.headers.get('location')||'',/error=access_denied/);
  const bad=await authorize();const badLocation=new URL(bad.response.headers.get('location')!);
  assert.equal((await exchange(badLocation.searchParams.get('code')!,randomBytes(32).toString('base64url'))).status,400);
  const granted=await authorize();assert.equal(granted.response.status,302);
  const location=new URL(granted.response.headers.get('location')!);assert.equal(location.searchParams.get('state'),granted.state);
  assert.equal(location.searchParams.get('iss'),issuer);
  const code=location.searchParams.get('code');assert.ok(code);
  const tokensResponse=await exchange(code,granted.verifier);assert.equal(tokensResponse.status,200);
  const tokens=await tokensResponse.json() as {access_token:string;refresh_token:string};
  assert.ok(tokens.access_token&&tokens.refresh_token);
  async function rpc(token:string,method='tools/list',params:unknown={}){
   return fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',authorization:'Bearer '+token},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  }
  try{await access.authenticate('Bearer '+tokens.access_token);}catch(error){
    const claims=decodeJwt(tokens.access_token);throw Error('PROVIDER_TOKEN_REJECTED: '+String(error)+'; claim keys='+Object.keys(claims).join(',')+'; audience='+JSON.stringify(claims.aud));
  }
  assert.equal((await rpc(tokens.access_token)).status,200);
  const read=await rpc(tokens.access_token,'tools/call',{name:'list_directory',arguments:{path:'.',depth:0}});assert.equal(read.status,200);
  assert.notEqual((await read.json() as {result:{isError?:boolean}}).result.isError,true);
  await new Promise(r=>setTimeout(r,6000));assert.equal((await rpc(tokens.access_token)).status,401);
  async function refresh(secret:string){
   return fetch(issuer+'/protocol/openid-connect/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',authorization:'Basic '+Buffer.from('gateway-chatgpt:'+clientSecret).toString('base64')},
    body:new URLSearchParams({grant_type:'refresh_token',client_id:'gateway-chatgpt',refresh_token:secret,resource})});
  }
  const renewed=await refresh(tokens.refresh_token);assert.equal(renewed.status,200);
  const next=await renewed.json() as {access_token:string;refresh_token:string};
  assert.equal((await rpc(next.access_token)).status,200);
  const connection=(await access.snapshot()).oauthConnections[0]!;assert.ok(connection);
  await access.revokeOAuth(connection.id);assert.equal((await rpc(next.access_token)).status,401);
  const after=await refresh(next.refresh_token);assert.equal(after.status,200);
  const afterTokens=await after.json() as {access_token:string};assert.equal((await rpc(afterTokens.access_token)).status,401);
  assert.equal((await refresh(tokens.refresh_token)).status,400);
  assert.equal((await access.snapshot()).oauthConnections.length,1);
  // Keycloak can revoke the provider session after code replay, so probe it last.
  assert.equal((await exchange(code,granted.verifier)).status,400);
 }finally{
  await runtime.close();kc.kill('SIGTERM');
  const timeout=setTimeout(()=>kc.kill('SIGKILL'),10000);timeout.unref();await exited;clearTimeout(timeout);
  await rm(importFile,{force:true});await rm(root,{recursive:true,force:true});
 }
});
