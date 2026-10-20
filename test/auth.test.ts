import type { JWTPayload } from 'jose';
import { createLocalJWKSet,exportJWK,generateKeyPair,SignJWT } from 'jose';
import assert from 'node:assert/strict';
import { chmod,mkdtemp,rm,unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { initializeRemoteRevocations,revokeRemoteIdentity } from '../src/community-remote-revocations.js';
import { createRemoteAuthenticator } from '../src/remote-auth.js';

test('authentication verifies signatures, identity, scope and live revocation; unsafe state fails closed',async()=>{
  const home=await mkdtemp(join(tmpdir(),'gateway-auth-'));
  const revocationsFile=join(home,'remote-revocations.json');
  await initializeRemoteRevocations(revocationsFile);
  const {publicKey,privateKey}=await generateKeyPair('ES256');
  const jwks=createLocalJWKSet({keys:[await exportJWK(publicKey)]});
  const config={issuer:'https://identity.example/',audience:'https://gateway.example/mcp',requiredScope:'mac-mcp:files.read',
    jwksUrl:'https://identity.example/jwks',subjects:['owner'],revocationsFile};
  const auth=createRemoteAuthenticator(config,jwks);
  const claims: JWTPayload={iss:config.issuer,aud:config.audience,sub:'owner',scope:'mac-mcp:files.read',exp:Math.floor(Date.now()/1000)+60,jti:'one'};
  const sign=async(p: JWTPayload)=>'Bearer '+await new SignJWT(p).setProtectedHeader({alg:'ES256'}).sign(privateKey);
  try{
    assert.equal((await auth(undefined)).status,401);
    assert.equal((await auth('Bearer invalid')).status,401);
    for(const change of [{iss:'https://wrong.example/'},{aud:'wrong'},{exp:1}]){
      assert.equal((await auth(await sign({...claims,...change}))).status,401);
    }
    const missingSubject={...claims};delete missingSubject.sub;
    assert.equal((await auth(await sign(missingSubject))).status,401);
    for(const change of [{sub:'stranger'},{scope:'mac-mcp:files.write'}]){
      assert.equal((await auth(await sign({...claims,...change}))).status,403);
    }
    assert.throws(()=>createRemoteAuthenticator({...config,requiredScope:''},jwks),/REMOTE_REQUIRED_SCOPE_INVALID/);
    assert.throws(()=>createRemoteAuthenticator({...config,requiredScope:'read write'},jwks),/REMOTE_REQUIRED_SCOPE_INVALID/);
    const writeAuth=createRemoteAuthenticator({...config,requiredScope:'mac-mcp:files.write'},jwks);
    assert.equal((await writeAuth(await sign(claims))).status,403);
    assert.equal((await writeAuth(await sign({...claims,scope:'mac-mcp:files.write'}))).status,200);
    const token=await sign(claims);
    const ok=await auth(token);assert.equal(ok.status,200);
    if(ok.status===200){assert.equal(ok.principal.kind,'verified-remote');assert.notEqual(ok.principal.subjectHash,'owner');}
    const other=await generateKeyPair('ES256');
    assert.equal((await auth('Bearer '+await new SignJWT(claims).setProtectedHeader({alg:'ES256'}).sign(other.privateKey))).status,401);
    await revokeRemoteIdentity(revocationsFile,{jti:'one'});
    assert.deepEqual(await auth(token),{status:403,revoked:true});
    await chmod(revocationsFile,0o644);assert.equal((await auth(token)).status,503);
    await unlink(revocationsFile);assert.equal((await auth(token)).status,503);
  }finally{await rm(home,{recursive:true,force:true});}
});
