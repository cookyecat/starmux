import type { JWTVerifyGetKey } from 'jose';
import { createRemoteJWKSet,jwtVerify } from 'jose';
import { createHash } from 'node:crypto';
import { isRemoteIdentityRevoked,readRemoteRevocations } from './community-remote-revocations.js';
import type { AuthenticationResult } from './contracts.js';
import { isSafeInteger } from './validation.js';
// Internal authentication primitive, not an HTTP listener or Core authorization.
export interface RemoteAuthConfig {
  issuer: string;
  audience: string;
  jwksUrl: string;
  subjects: readonly string[];
  revocationsFile: string;
  requiredScope: string;
}

export function createRemoteAuthenticator(config: RemoteAuthConfig, jwks?: JWTVerifyGetKey) {
  if(!config.requiredScope||/\s/.test(config.requiredScope))
    throw Error('REMOTE_REQUIRED_SCOPE_INVALID');
  const keyset = jwks || createRemoteJWKSet(new URL(config.jwksUrl), {
    timeoutDuration: 3000, cooldownDuration: 30000
  });
  const allowedSubjects = new Set(config.subjects);
  return async function authenticate(auth: string|undefined): Promise<AuthenticationResult> {
    if(typeof auth!=="string"||!/^Bearer [^\s]+$/.test(auth))
      return {status:401};
    try {
      const token=auth.slice(7);
      const {payload}=await jwtVerify(token,keyset,{
        issuer:config.issuer,audience:config.audience,
        algorithms:["RS256","ES256","PS256"],clockTolerance:5
      });
      if(!isSafeInteger(payload.exp)||typeof payload.sub!=="string")
        return {status:401};
      if(!allowedSubjects.has(payload.sub))
        return {status:403};
      const scopes=typeof payload.scope==="string"?payload.scope.split(" "):[];
      if(!scopes.includes(config.requiredScope))return {status:403};
      // Every authentication attempt re-reads owner-controlled revocation state. If it
      // disappears, becomes unsafe, or is malformed, fail closed (503).
      let revoked;
      try{revoked=isRemoteIdentityRevoked(
        await readRemoteRevocations(config.revocationsFile),payload);}
      catch{return {status:503};}
      if(revoked)return {status:403,revoked:true};
      return {status:200,principal:{kind:"verified-remote",subjectHash:createHash("sha256")
        .update(payload.sub).digest("hex").slice(0,16),scopes}};
    }catch {
      return {status:401};
    }
  }
}
