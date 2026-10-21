// OAuth resource-server adapter. The authorization server owns login, consent,
// authorization codes, refresh tokens and client registration.
import {z} from 'zod';
import {createRemoteJWKSet,jwtVerify,type JWTVerifyGetKey} from 'jose';
import {createHash} from 'node:crypto';

const url=z.string().url().max(2048);
export const oauthConfigSchema=z.object({
  issuer:url,resource:url,jwksUri:url,authorizationEndpoint:url,tokenEndpoint:url,
  registrationEndpoint:url.optional(),clientRegistration:z.enum(['provided','cimd','dcr']),
  clientId:z.string().min(1).max(2048),tokenEndpointAuthMethod:z.enum(['none','client_secret_basic','client_secret_post','private_key_jwt']),
  allowedSubjects:z.array(z.string().min(1).max(256)).min(1).max(32),
  scope:z.string().regex(/^[A-Za-z0-9:_-]{1,80}$/).default('gateway:access'),
  allowLoopbackHttp:z.boolean().default(false)
}).strict();
export type OAuthConfig=z.infer<typeof oauthConfigSchema>;
export const oauthConnectionSchema=z.object({
  id:z.string().regex(/^[a-f0-9]{64}$/),subjectHash:z.string().regex(/^[a-f0-9]{64}$/),
  clientId:z.string().min(1).max(2048),createdAt:z.string().datetime(),lastUsedAt:z.string().datetime(),
  revokedAt:z.string().datetime().nullable(),permission:z.literal('owner-default')
}).strict();
export type OAuthConnection=z.infer<typeof oauthConnectionSchema>;
export class OAuthError extends Error {
  constructor(readonly status:401|403|503,readonly reason:string){super(reason);}
}
function checkedUrl(value:string,allowHttp:boolean){
  if(/[\u0000-\u0020\u007f\\]/.test(value))throw Error('OAUTH_URL_INVALID');
  const parsed=new URL(value);
  if(parsed.username||parsed.password||parsed.hash||parsed.search||
    !(parsed.protocol==='https:'||(allowHttp&&parsed.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(parsed.hostname))))
    throw Error('OAUTH_HTTPS_URL_REQUIRED');
  return parsed;
}
export function validateOAuthConfig(value:unknown):OAuthConfig{
  const c=oauthConfigSchema.parse(value);
  const issuer=checkedUrl(c.issuer,c.allowLoopbackHttp);
  checkedUrl(c.resource,c.allowLoopbackHttp);
  for(const value of [c.jwksUri,c.authorizationEndpoint,c.tokenEndpoint,...(c.registrationEndpoint?[c.registrationEndpoint]:[])]){
    if(checkedUrl(value,c.allowLoopbackHttp).origin!==issuer.origin)throw Error('OAUTH_ENDPOINT_ORIGIN_MISMATCH');
  }
  if(c.clientRegistration==='dcr'&&!c.registrationEndpoint)throw Error('OAUTH_DCR_ENDPOINT_REQUIRED');
  return c;
}
const discoverySchema=z.object({
  issuer:url,jwks_uri:url,authorization_endpoint:url,token_endpoint:url,
  registration_endpoint:url.optional(),client_id_metadata_document_supported:z.boolean().optional(),
  code_challenge_methods_supported:z.array(z.string()),response_types_supported:z.array(z.string()),
  token_endpoint_auth_methods_supported:z.array(z.string()).optional(),scopes_supported:z.array(z.string()).optional()
});
export async function discoverOAuth(input:{issuer:string;resource:string;clientId:string;allowedSubjects:string[];
  clientRegistration?:'provided'|'cimd'|'dcr';tokenEndpointAuthMethod?:OAuthConfig['tokenEndpointAuthMethod'];allowLoopbackHttp?:boolean}){
  const issuer=checkedUrl(input.issuer,input.allowLoopbackHttp??false);
  checkedUrl(input.resource,input.allowLoopbackHttp??false);
  const base=issuer.pathname.replace(/\/$/,'');
  const candidates=[issuer.origin+'/.well-known/oauth-authorization-server'+base,
    issuer.origin+base+'/.well-known/openid-configuration'];
  let metadata:z.infer<typeof discoverySchema>|undefined;
  for(const address of candidates){
    try{
      const response=await fetch(address,{redirect:'error',signal:AbortSignal.timeout(5000)});
      if(!response.ok||!response.body)continue;
      const reader=response.body.getReader();let body='';const decoder=new TextDecoder();let length=0;
      try{for(;;){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.byteLength;
        if(length>65536)throw Error('OAUTH_METADATA_TOO_LARGE');body+=decoder.decode(chunk.value,{stream:true});}}
      finally{await reader.cancel();}
      body+=decoder.decode();metadata=discoverySchema.parse(JSON.parse(body) as unknown);break;
    }catch{/* Try the standard OIDC discovery location; never accept redirects. */}
  }
  if(!metadata)throw Error('OAUTH_DISCOVERY_FAILED');
  if(metadata.issuer!==input.issuer)throw Error('OAUTH_ISSUER_MISMATCH');
  if(!metadata.code_challenge_methods_supported.includes('S256')||!metadata.response_types_supported.includes('code'))throw Error('OAUTH_CODE_PKCE_S256_REQUIRED');
  const registration=input.clientRegistration??'provided';const method=input.tokenEndpointAuthMethod??'none';
  if(!metadata.token_endpoint_auth_methods_supported?.includes(method))throw Error('OAUTH_TOKEN_AUTH_METHOD_UNSUPPORTED');
  if(registration==='cimd'&&!metadata.client_id_metadata_document_supported)throw Error('OAUTH_CIMD_NOT_ADVERTISED');
  if(registration==='dcr'&&!metadata.registration_endpoint)throw Error('OAUTH_DCR_NOT_ADVERTISED');
  return validateOAuthConfig({issuer:input.issuer,resource:input.resource,jwksUri:metadata.jwks_uri,
    authorizationEndpoint:metadata.authorization_endpoint,tokenEndpoint:metadata.token_endpoint,
    ...(metadata.registration_endpoint?{registrationEndpoint:metadata.registration_endpoint}:{}),
    clientRegistration:registration,clientId:input.clientId,tokenEndpointAuthMethod:method,
    allowedSubjects:input.allowedSubjects,allowLoopbackHttp:input.allowLoopbackHttp??false,scope:'gateway:access'});
}
export function metadataUrl(c:OAuthConfig){
  const resource=new URL(c.resource);
  return resource.origin+'/.well-known/oauth-protected-resource'+resource.pathname.replace(/\/$/,'');
}
export function resourceMetadata(c:OAuthConfig){
  return {resource:c.resource,authorization_servers:[c.issuer],scopes_supported:[c.scope],bearer_methods_supported:['header']};
}
export function oauthChallenge(c:OAuthConfig,status:401|403=401){
  // URLs and scope are validated and encoded as quoted-string contents.
  const quote=(s:string)=>s.replace(/\\/g,'\\\\').replace(/"/g,'\\"');
  return `Bearer resource_metadata="${quote(metadataUrl(c))}", scope="${quote(c.scope)}", error="${status===403?'insufficient_scope':'invalid_token'}"`;
}
export function createOAuthVerifier(c:OAuthConfig,key?:JWTVerifyGetKey){
  const keyset=key??createRemoteJWKSet(new URL(c.jwksUri),{timeoutDuration:4000,cooldownDuration:1000,cacheMaxAge:300000});
  return async(header:string|undefined)=>{
    if(!header||header.length>16384||!/^Bearer [^\s]+$/i.test(header))throw new OAuthError(401,'OAUTH_TOKEN_REQUIRED');
    let payload;
    try{({payload}=await jwtVerify(header.slice(7),keyset,{issuer:c.issuer,audience:c.resource,algorithms:['RS256','ES256','PS256'],
      requiredClaims:['sub','exp','iat','sid','azp'],clockTolerance:0}));}
    catch(error){
      const code=error&&typeof error==='object'&&'code' in error?error.code:'';
      if(code==='ERR_JWKS_TIMEOUT'||error instanceof TypeError)throw new OAuthError(503,'OAUTH_KEYS_UNAVAILABLE');
      throw new OAuthError(401,'OAUTH_TOKEN_INVALID');
    }
    if(typeof payload.sub!=='string'||!payload.sub||payload.sub.length>256||
      typeof payload.sid!=='string'||!payload.sid||payload.sid.length>512||payload.azp!==c.clientId||
      typeof payload.iat!=='number'||!Number.isSafeInteger(payload.iat)||payload.iat>Math.floor(Date.now()/1000)||
      typeof payload.exp!=='number'||!Number.isSafeInteger(payload.exp)||payload.exp<=payload.iat)
      throw new OAuthError(401,'OAUTH_TOKEN_INVALID');
    if(!c.allowedSubjects.includes(payload.sub))throw new OAuthError(403,'OAUTH_SUBJECT_NOT_ALLOWED');
    const scopes=typeof payload.scope==='string'?payload.scope.split(/\s+/):[];
    if(!scopes.includes(c.scope))throw new OAuthError(403,'OAUTH_SCOPE_REQUIRED');
    const hash=(parts:string[])=>createHash('sha256').update(JSON.stringify(parts)).digest('hex');
    return {id:hash([c.issuer,payload.sub,c.clientId,payload.sid]),subjectHash:hash([c.issuer,payload.sub]),
      clientId:c.clientId,scopes};
  };
}
