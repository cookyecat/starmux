import type { IncomingMessage } from 'node:http';
import {isIP} from 'node:net';

export function isLoopbackSocketAddress(remoteAddress: string|undefined): boolean {
  return remoteAddress==='127.0.0.1'||remoteAddress==='::ffff:127.0.0.1';
}

/** Everything not explicitly public, including unknown paths, is owner-local. */
export function isClientFacingGatewayRoute(route: string): boolean {
  return route==='/mcp'||route==='/healthz'||route==='/.well-known/oauth-protected-resource'||
    route.startsWith('/.well-known/oauth-protected-resource/');
}

/** Validate an authority without URL normalization, userinfo, or alternate IP spellings. */
export function isValidHttpHostAuthority(rawHost: string): boolean {
  if(!rawHost||rawHost.length>255||/[\s,\\/@\x00-\x1f\x7f]/.test(rawHost))return false;
  let host=rawHost;let port:string|undefined;
  if(rawHost.startsWith('[')){
    const end=rawHost.indexOf(']');
    if(end<2||isIP(rawHost.slice(1,end))!==6)return false;
    const rest=rawHost.slice(end+1);
    if(rest){if(!rest.startsWith(':'))return false;port=rest.slice(1);}
  }else{
    const colon=rawHost.indexOf(':');
    if(colon!==-1){host=rawHost.slice(0,colon);port=rawHost.slice(colon+1);}
    if(!host||host.length>253||!host.split('.').every(label=>
      /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label)))return false;
    if(/^[0-9.]+$/.test(host)&&isIP(host)!==4)return false;
  }
  return port===undefined||(/^[0-9]{1,5}$/.test(port)&&Number(port)>=1&&Number(port)<=65535);
}

export function isAllowedGatewayHost(
  req: Pick<IncomingMessage, 'headers'|'rawHeaders'>,
  listenerPort: number|null,
  route = ''
): boolean {
  if(listenerPort===null||!Number.isInteger(listenerPort)||listenerPort<1||listenerPort>65535)return false;
  // Node keeps only one Host in headers; inspect rawHeaders to reject duplicates too.
  let hostCount=0;
  for(let i=0;i<req.rawHeaders.length;i+=2)
    if(req.rawHeaders[i]?.toLowerCase()==='host')hostCount++;
  const host=req.headers.host;
  if(hostCount!==1||typeof host!=='string'||!isValidHttpHostAuthority(host))return false;
  if(isClientFacingGatewayRoute(route))return true;
  const normalized=host.toLowerCase();
  return normalized===`127.0.0.1:${listenerPort}`||normalized===`localhost:${listenerPort}`;
}
