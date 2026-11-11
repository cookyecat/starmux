import path from 'node:path';
import {randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {auth,type OAuthClientProvider} from '@modelcontextprotocol/sdk/client/auth.js';
import {OAuthTokensSchema,type OAuthTokens,type OAuthClientInformationMixed,type OAuthClientMetadata} from '@modelcontextprotocol/sdk/shared/auth.js';
import {atomicPrivate,exists,readTrusted} from './instance-store.js';
import {withPrivateLock} from './private-store-lock.js';
import {GatewayError} from './validation.js';
export interface UpstreamOAuthSettings {clientId?:string|undefined;issuer?:string|undefined;clientSecret?:string|undefined}
interface StoredOAuth {url:string;epoch:string;tokens?:OAuthTokens;client?:OAuthClientInformationMixed;redirect?:string;verifier?:string;state?:string;attemptExpires?:number}
const read=async(file:string,url:string):Promise<StoredOAuth>=>{
 if(!await exists(file))return {url,epoch:randomBytes(16).toString('hex')};
 const value=JSON.parse(await readTrusted(file)) as StoredOAuth;
 if(value.url!==url)throw new GatewayError('UPSTREAM_AUTH_SERVER_CHANGED');return value;
};
export async function upstreamOAuthProvider(file:string,url:string,settings:UpstreamOAuthSettings={},interactive=false){
 let state=await read(file,url);let authorizationUrl:string|undefined;
 if(!await exists(file))await withPrivateLock(file+'.lock',async()=>{if(!await exists(file))await atomicPrivate(file,JSON.stringify(state));state=await read(file,url);});
 const epoch=state.epoch;
 const change=async(fn:(state:StoredOAuth)=>void)=>oauthLock(file+'.lock',async()=>{const current=await read(file,url);if(current.epoch!==epoch)throw new GatewayError('UPSTREAM_AUTH_SESSION_CHANGED');fn(current);await atomicPrivate(file,JSON.stringify(current));state=current;});
 const provider:OAuthClientProvider={
  get redirectUrl(){return state.redirect;},
  get clientMetadata():OAuthClientMetadata{return {client_name:'Starmux',redirect_uris:state.redirect?[state.redirect]:[],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:settings.clientSecret?'client_secret_post':'none'};},
  state(){if(!interactive||!state.state)throw new GatewayError('UPSTREAM_AUTH_REQUIRED');return state.state;},
  clientInformation(){return settings.clientId?{client_id:settings.clientId,...(settings.issuer?{issuer:settings.issuer}:{}),...(settings.clientSecret?{client_secret:settings.clientSecret}:{})}:state.client;},
  saveClientInformation(value){return change(s=>{s.client=value;});},
  async tokens(){const next=await read(file,url);if(next.epoch!==epoch)throw new GatewayError('UPSTREAM_AUTH_SESSION_CHANGED');state=next;return state.tokens;},
  saveTokens(value){return change(s=>{s.tokens=value;});},
  redirectToAuthorization(value){if(!interactive)throw new GatewayError('UPSTREAM_AUTH_REQUIRED');authorizationUrl=value.href;},
  saveCodeVerifier(value){if(!interactive)throw new GatewayError('UPSTREAM_AUTH_REQUIRED');return change(s=>{s.verifier=value;});},
  codeVerifier(){if(!state.verifier||!state.attemptExpires||state.attemptExpires<Date.now())throw new GatewayError('UPSTREAM_AUTH_ATTEMPT_EXPIRED');return state.verifier;},
  invalidateCredentials(scope){return change(s=>{if(scope==='all'||scope==='tokens')delete s.tokens;if(scope==='all'||scope==='client')delete s.client;if(scope==='all'||scope==='verifier')delete s.verifier;});}
 };
 const fetchWithAuth:typeof fetch=async(input,init)=>{
  const request={...init,redirect:'error' as const,signal:AbortSignal.any([AbortSignal.timeout(30000),...(init?.signal?[init.signal]:[])])};
  const params=typeof init?.body==='string'||init?.body instanceof URLSearchParams?new URLSearchParams(init.body):undefined;
  if(params?.get('grant_type')!=='refresh_token')return fetch(input,request);
  const refresh=async()=>{
   const current=await read(file,url);if(current.epoch!==epoch)throw new GatewayError('UPSTREAM_AUTH_SESSION_CHANGED');
   if(current.tokens?.refresh_token&&current.tokens.refresh_token!==params.get('refresh_token'))return new Response(JSON.stringify(current.tokens),{headers:{'content-type':'application/json'}});
   const response=await fetch(input,request);
   if(response.ok){const parsed=OAuthTokensSchema.safeParse(await response.clone().json());if(parsed.success)await provider.saveTokens({...current.tokens,...parsed.data,...(current.tokens?.issuer?{issuer:current.tokens.issuer}:{})});}
   return response;
  };
  for(let attempt=0;;attempt++)try{if(request.signal.aborted)throw request.signal.reason;return await withPrivateLock(file+'.refresh-lock',refresh,'UPSTREAM_AUTH_BUSY');}catch(error){if(!(error instanceof Error)||!error.message.startsWith('UPSTREAM_AUTH_BUSY')||attempt>=100)throw error;await new Promise(r=>setTimeout(r,20));}
 };
 return {provider,fetch:fetchWithAuth,get authorizationUrl(){return authorizationUrl;},get state(){return state;},change};
}
const attempts=new Map<string,()=>void>();
export async function beginUpstreamOAuth(file:string,url:string,settings:UpstreamOAuthSettings={}){
 if(attempts.size>=20&&!attempts.has(file))throw new GatewayError('UPSTREAM_AUTH_BUSY');attempts.get(file)?.();
 const client=await upstreamOAuthProvider(file,url,settings,true),state=randomBytes(32).toString('hex');
 let used=false;let timer:NodeJS.Timeout|undefined;
 const callback=createServer(async(req,res)=>{
  res.setHeader('cache-control','no-store');res.setHeader('referrer-policy','no-referrer');
  const request=new URL(req.url??'/',client.state.redirect!);
  const expected=new URL(client.state.redirect!);
  if(req.method!=='GET'||req.headers.host!==expected.host||request.pathname!==expected.pathname||!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'')){res.writeHead(403).end('Rejected');return;}
  const received=request.searchParams.get('state')??'';
  if(used||received.length!==state.length||!timingSafeEqual(Buffer.from(received),Buffer.from(state))){res.writeHead(403).end('Authorization attempt mismatch');return;}
  used=true;
  try{
   if(request.searchParams.has('error')||!request.searchParams.get('code'))throw Error('UPSTREAM_AUTH_DENIED');
   const result=await auth(client.provider,{serverUrl:url,fetchFn:client.fetch,authorizationCode:request.searchParams.get('code')!});
   if(result!=='AUTHORIZED')throw Error('UPSTREAM_AUTH_FAILED');
   await client.change(s=>{delete s.state;delete s.verifier;delete s.attemptExpires;});res.end('Starmux: authorization complete. Return to the service page and retry the connection.');
  }catch{res.writeHead(400).end('UPSTREAM_AUTH_FAILED: restart authorization from Starmux.');}
  finally{finish();}
 });
 const finish=()=>{if(timer)clearTimeout(timer);callback.close();callback.closeIdleConnections();if(attempts.get(file)===finish)attempts.delete(file);};
 const oldPort=client.state.redirect?Number(new URL(client.state.redirect).port):0;
 try{
  await new Promise<void>((resolve,reject)=>{callback.once('error',reject);callback.listen(oldPort,'127.0.0.1',resolve);});
  const address=callback.address();if(!address||typeof address==='string')throw Error('UPSTREAM_AUTH_CALLBACK_FAILED');
  // Keep the registered redirect URI stable across attempts, including restarts.
  const redirect=client.state.redirect??`http://127.0.0.1:${address.port}/oauth/callback`;
  await client.change(s=>{s.redirect=redirect;s.state=state;s.attemptExpires=Date.now()+300000;});
  attempts.set(file,finish);timer=setTimeout(finish,300000);timer.unref();
  const result=await auth(client.provider,{serverUrl:url,fetchFn:client.fetch});
  if(result==='AUTHORIZED'){finish();return {status:'authorized'};}
  return {status:'authorization-required',authorizationUrl:client.authorizationUrl,callbackUrl:redirect,expiresInSeconds:300,headless:`Forward local port ${address.port} to 127.0.0.1:${address.port} on the Starmux host before opening the authorization URL.`};
 }catch(error){finish();throw error instanceof GatewayError?error:new GatewayError('UPSTREAM_AUTH_FAILED');}
}
export async function logoutUpstreamOAuth(file:string,url:string){
 attempts.get(file)?.();await withPrivateLock(file+'.lock',async()=>{const old=await read(file,url);await atomicPrivate(file,JSON.stringify({url,epoch:randomBytes(16).toString('hex'),...(old.redirect?{redirect:old.redirect}:{}),...(old.client?{client:old.client}:{})}));});
}
export async function upstreamOAuthStatus(file:string,url:string){const state=await read(file,url);return {authenticated:!!state.tokens,pending:!!state.state&&!!state.attemptExpires&&state.attemptExpires>Date.now()};}

async function oauthLock<T>(file:string,action:()=>Promise<T>):Promise<T>{
 for(let attempt=0;;attempt++)try{return await withPrivateLock(file,action,'UPSTREAM_AUTH_BUSY');}catch(error){if(!(error instanceof Error)||!error.message.startsWith('UPSTREAM_AUTH_BUSY')||attempt>=100)throw error;await new Promise(r=>setTimeout(r,20));}
}

export function upstreamOAuthFile(directory:string,id:string,url:string){return path.join(directory,'upstream-oauth-'+id+'-'+createHash('sha256').update(url).digest('hex').slice(0,32)+'.json');}
