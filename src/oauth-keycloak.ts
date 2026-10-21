// A reference realm generator, not an embedded authorization server.
// No users, passwords, client secrets or wildcard callback URLs are generated.
export function keycloakRealm(resource:string,callback:string,development=false){
  for(const value of [resource,callback]){
    const u=new URL(value);
    if(u.username||u.password||u.hash||u.search||value.includes('*')||!(u.protocol==='https:'||
      (development&&u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))))throw Error('KEYCLOAK_HTTPS_EXACT_URL_REQUIRED');
  }
  return {
    realm:'gateway',enabled:true,registrationAllowed:false,resetPasswordAllowed:false,
    sslRequired:development?'none':'external',accessTokenLifespan:300,revokeRefreshToken:true,refreshTokenMaxReuse:0,
    clientScopes:[{name:'gateway:access',protocol:'openid-connect',attributes:{'include.in.token.scope':'true',
      'display.on.consent.screen':'true','consent.screen.text':'Use the Gateway owner-approved tools'},
      protocolMappers:[{name:'gateway audience',protocol:'openid-connect',protocolMapper:'oidc-audience-mapper',
        config:{'included.client.audience':'gateway-resource','access.token.claim':'true','id.token.claim':'false'}}]}],
    clients:[{clientId:'gateway-resource',name:'Gateway resource',enabled:true,protocol:'openid-connect',
      bearerOnly:true,attributes:{resource_url:resource}},
      {clientId:'gateway-chatgpt',name:'ChatGPT Gateway connection',enabled:true,protocol:'openid-connect',
        publicClient:true,standardFlowEnabled:true,directAccessGrantsEnabled:false,implicitFlowEnabled:false,
        serviceAccountsEnabled:false,consentRequired:true,redirectUris:[callback],webOrigins:[],
        attributes:{'pkce.code.challenge.method':'S256'},optionalClientScopes:['gateway:access'],defaultClientScopes:[]}]
  };
}
