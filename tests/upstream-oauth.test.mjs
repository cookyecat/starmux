import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {auth} from '@modelcontextprotocol/sdk/client/auth.js';
import {beginUpstreamOAuth,upstreamOAuthProvider,logoutUpstreamOAuth,upstreamOAuthStatus} from '../dist/src/upstream-oauth.js';
test('outbound OAuth binds callback state and PKCE to one service, and logout invalidates stale writers',{timeout:20000},async t=>{
 await mkdir('.internal',{recursive:true});const root=await mkdtemp(path.resolve('.internal/oauth-upstream-'));t.after(()=>rm(root,{recursive:true,force:true}));
 let base='',tokenRequest,refreshRequests=0;const http=createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.url.includes('oauth-protected-resource')){res.end(JSON.stringify({resource:base+'/mcp',authorization_servers:[base]}));return;}
  if(req.url.includes('oauth-authorization-server')||req.url.includes('openid-configuration')){res.end(JSON.stringify({issuer:base,authorization_endpoint:base+'/authorize',token_endpoint:base+'/token',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']}));return;}
  if(req.url==='/token'){let raw='';for await(const chunk of req)raw+=chunk;tokenRequest=new URLSearchParams(raw);if(tokenRequest.get('grant_type')==='refresh_token'){refreshRequests++;await new Promise(r=>setTimeout(r,25));}res.end(JSON.stringify({access_token:'fixture-access',refresh_token:refreshRequests?'rotated-refresh':'fixture-refresh',token_type:'Bearer',expires_in:3600}));return;}
  res.writeHead(401,{'www-authenticate':`Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`}).end('{}');
 });
 await new Promise(r=>http.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${http.address().port}`;t.after(()=>{http.closeAllConnections();return new Promise(r=>http.close(r));});
 const file=path.join(root,'account.json'),settings={clientId:'fixture-client',issuer:base};
 const started=await beginUpstreamOAuth(file,base+'/mcp',settings);assert.equal(started.status,'authorization-required');assert.match(started.headless,/Forward local port/);
 const authorization=new URL(started.authorizationUrl),callback=new URL(started.callbackUrl);
 assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');
 callback.searchParams.set('code','fixture-code');callback.searchParams.set('state','wrong');assert.equal((await fetch(callback)).status,403);
 callback.searchParams.set('state',authorization.searchParams.get('state'));assert.equal((await fetch(callback)).status,200);
 assert.equal(createHash('sha256').update(tokenRequest.get('code_verifier')).digest('base64url'),authorization.searchParams.get('code_challenge'));
 assert.equal((await upstreamOAuthStatus(file,base+'/mcp')).authenticated,true);
 const existing=await upstreamOAuthProvider(file,base+'/mcp',settings);assert.equal((await existing.provider.tokens()).access_token,'fixture-access');
 const parallel=await upstreamOAuthProvider(file,base+'/mcp',settings);await Promise.all([existing,parallel].map(client=>auth(client.provider,{serverUrl:base+'/mcp',fetchFn:client.fetch})));assert.equal(refreshRequests,1);
 await logoutUpstreamOAuth(file,base+'/mcp');assert.equal((await upstreamOAuthStatus(file,base+'/mcp')).authenticated,false);
 await assert.rejects(existing.provider.saveTokens({access_token:'stale',token_type:'Bearer'}),e=>e.code==='UPSTREAM_AUTH_SESSION_CHANGED');
 await assert.rejects(upstreamOAuthProvider(file,base+'/other',settings),e=>e.code==='UPSTREAM_AUTH_SERVER_CHANGED');
});
