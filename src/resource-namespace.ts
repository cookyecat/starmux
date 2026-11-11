const prefix='starmux://';
export function namespaceUri(serverId:string,uri:string){return serverId==='desktop'?uri:prefix+serverId+'/'+encodeURIComponent(uri).replace(/%7B([^{}]+?)%7D/gi,(_all,variable:string)=>'{'+decodeURIComponent(variable)+'}');}
export function resolveNamespacedUri(uri:string):{serverId:string;uri:string}{
 if(!uri.startsWith(prefix))return {serverId:'desktop',uri};
 const match=/^starmux:\/\/([a-z][a-z0-9_-]{0,39})\/(.+)$/.exec(uri);if(!match)throw Error('RESOURCE_NAMESPACE_INVALID');
 try{return {serverId:match[1]!,uri:decodeURIComponent(match[2]!) };}catch{throw Error('RESOURCE_NAMESPACE_INVALID');}
}
/** Only MCP-defined URI locations are rewritten; arbitrary text/data is untouched. */
export function namespaceReferences<T>(serverId:string,value:T):T{
 if(serverId==='desktop')return value;
 const copy=structuredClone(value);
 const visit=(v:unknown)=>{
  if(Array.isArray(v)){for(const item of v)visit(item);return;}
  if(!v||typeof v!=='object')return;const object=v as Record<string,unknown>;
  if((object.type==='resource_link'||'mimeType' in object||'text' in object||'blob' in object)&&typeof object.uri==='string')object.uri=namespaceUri(serverId,object.uri);
  if(object.resource&&typeof object.resource==='object'){const resource=object.resource as Record<string,unknown>;if(typeof resource.uri==='string')resource.uri=namespaceUri(serverId,resource.uri);}
  const meta=object._meta as Record<string,unknown>|undefined;
  if(meta){if(typeof meta['ui/resourceUri']==='string')meta['ui/resourceUri']=namespaceUri(serverId,meta['ui/resourceUri']);const ui=meta.ui as Record<string,unknown>|undefined;if(ui&&typeof ui.resourceUri==='string')ui.resourceUri=namespaceUri(serverId,ui.resourceUri);}
  // Resource payloads are already rewritten above. Do not double-namespace.
  for(const [key,child] of Object.entries(object))if(key!=='resource'&&key!=='_meta')visit(child);
 };visit(copy);return copy;
}
