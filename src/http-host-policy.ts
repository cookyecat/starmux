import type { IncomingMessage } from 'node:http';

/** Host is an HTTP authority, not a URL; do not normalize alternate IP spellings or userinfo. */
export function isAllowedGatewayHost(
  req: Pick<IncomingMessage, 'headers'|'rawHeaders'>,
  listenerPort: number|null,
  route: string
): boolean {
  // Node keeps only one Host in headers; inspect rawHeaders to reject duplicates too.
  let hostCount=0;
  for(let i=0;i<req.rawHeaders.length;i+=2)
    if(req.rawHeaders[i]?.toLowerCase()==='host')hostCount++;
  const host=req.headers.host;
  if(hostCount!==1||!host||listenerPort===null)return false;

  // Owner pages and discovery retain their existing listener-specific boundary.
  if(route!=='/mcp')
    return host===`127.0.0.1:${listenerPort}`||host===`localhost:${listenerPort}`;

  // SSH forwards TCP bytes unchanged, including the client's local Host port.
  // Keep the hostname allowlist and validate the entire authority, including its port.
  const match=/^(?:127\.0\.0\.1|localhost)(?::([0-9]{1,5}))?$/i.exec(host);
  if(!match||match[0]!==host)return false;
  return match[1]===undefined||(Number(match[1])>=1&&Number(match[1])<=65535);
}
