import {createAccessControl} from '../access-control.js';
import {discoverOAuth,metadataUrl,validateOAuthConfig} from '../oauth-resource.js';
import {keycloakRealm} from '../oauth-keycloak.js';
export async function oauthCommand(args:string[]){
  const action=args.shift()||'status';const json=args.includes('--json');args=args.filter(a=>a!=='--json');
  const options=new Map<string,string>();
  for(let i=0;i<args.length;i++){
    const name=args[i]!;
    if(name==='--allow-loopback-http'){options.set(name,'true');continue;}
    if(!['--issuer','--resource','--resource-aliases','--client-id','--subjects','--registration','--token-auth','--callback'].includes(name)||!args[i+1]||options.has(name))throw Error('OAUTH_ARGUMENT_INVALID');
    options.set(name,args[++i]!);
  }
  if(action==='keycloak-realm'){
    const realm=keycloakRealm(options.get('--resource')||'',options.get('--callback')||'',options.get('--allow-loopback-http')==='true');
    process.stdout.write(JSON.stringify(realm,null,2)+'\n');return;
  }
  const access=await createAccessControl();
  if(action==='configure'){
    const registration=options.get('--registration')||'provided';
    const method=options.get('--token-auth')||'none';
    if(!['provided','cimd','dcr'].includes(registration)||!['none','client_secret_basic','client_secret_post','private_key_jwt'].includes(method))throw Error('OAUTH_CLIENT_METHOD_INVALID');
    const config=await discoverOAuth({issuer:options.get('--issuer')||'',resource:options.get('--resource')||'',
      clientId:options.get('--client-id')||'',allowedSubjects:(options.get('--subjects')||'').split(',').filter(Boolean),
      clientRegistration:registration as 'provided'|'cimd'|'dcr',tokenEndpointAuthMethod:method as 'none'|'client_secret_basic'|'client_secret_post'|'private_key_jwt',
      allowLoopbackHttp:options.get('--allow-loopback-http')==='true'});
    await access.configureOAuth(validateOAuthConfig({...config,...(options.has('--resource-aliases')?
      {resourceAliases:options.get('--resource-aliases')!.split(',')}: {})}));
  }else if(action==='doctor'){
    const config=(await access.snapshot()).oauth;if(!config)throw Error('OAUTH_CONFIGURATION_REQUIRED');
    const fresh=await discoverOAuth({issuer:config.issuer,resource:config.resource,clientId:config.clientId,
      allowedSubjects:config.allowedSubjects,clientRegistration:config.clientRegistration,
      tokenEndpointAuthMethod:config.tokenEndpointAuthMethod,allowLoopbackHttp:config.allowLoopbackHttp});
    // Resource aliases are owner configuration, not authorization-server metadata.
    const {resourceAliases: _aliases,...discoveredConfig}=config;
    if(JSON.stringify(fresh)!==JSON.stringify(discoveredConfig))throw Error('OAUTH_METADATA_CHANGED_RECONFIGURE');
    process.stdout.write(JSON.stringify({event:'OAUTH_DOCTOR',result:'PASS',issuer:config.issuer,
      scope:config.scope,pkce:'S256',remoteClientVerified:false,note:'Discovery verified; actual login, refresh and remote reachability require end-to-end testing.'})+'\n');return;
  }else if(action!=='status')throw Error('Usage: access oauth configure|status|doctor|keycloak-realm');
  const state=await access.snapshot();
  if(json){process.stdout.write(JSON.stringify(state)+'\n');return;}
  const c=state.oauth;
  process.stdout.write('\n  Gateway OAuth\n  ────────────────────────────────────────────────\n');
  if(!c){process.stdout.write('  Not configured.\n\n');return;}
  if(c.resourceAliases?.length)process.stdout.write(`  Resource aliases: ${c.resourceAliases.join(', ')}\n`);
  process.stdout.write(`  Mode          ${state.mode}\n  Issuer        ${c.issuer}\n  Resource      ${c.resource}\n  Discovery     ${metadataUrl(c)}\n  Registration  ${c.clientRegistration}\n  Client ID     ${c.clientId}\n  Token auth    ${c.tokenEndpointAuthMethod}\n  Scope         ${c.scope}\n  Permission    Owner default\n  Transport     ${c.allowLoopbackHttp?'Development: loopback HTTP allowed':'HTTPS required'}\n\n`);
  for(const connection of state.oauthConnections)process.stdout.write(`  ${connection.revokedAt?'Revoked':'Active'} · ${connection.clientId}\n    ID: ${connection.id}\n    Last used: ${connection.lastUsedAt}\n`);
  if(action==='configure')process.stdout.write('  Configuration saved. Enable explicitly: mac-mcp-gateway access mode oauth\n');
  process.stdout.write('  Remote ChatGPT authorization is not verified by this command.\n\n');
}
