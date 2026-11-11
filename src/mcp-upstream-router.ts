import {namespaceUri,resolveNamespacedUri,namespaceReferences} from './resource-namespace.js';
import type { RouteDefinition,RouteInfo,Tool,ToolArguments,ToolInvocation,UpstreamRouter } from "./contracts.js";
// MCP router: route upstream tool calls without implementing their functionality.
// Registered upstream servers own their tools; the DC route retains native names.
// Additional upstream tools are namespaced "<route>__<nativeTool>".
export class MCPRouteError extends Error {
  constructor(public readonly code: string){super(code);}
}
function invalid(message: string): never{throw new MCPRouteError(message);}
function checkedCatalog<T>(items:T[],identity:(item:T)=>string):T[]{
  if(items.length>2000||Buffer.byteLength(JSON.stringify(items))>4194304)invalid('GATEWAY_CATALOG_LIMIT');
  const seen=new Set<string>();for(const item of items){const id=identity(item);if(seen.has(id))invalid('GATEWAY_CATALOG_CONFLICT');seen.add(id);}return items;
}
export async function validateGatewayCatalogs(router:UpstreamRouter){
  await Promise.all([router.listResources?.(),router.listResourceTemplates?.(),router.listPrompts?.()]);
}
function validRoute(route: unknown){
  return typeof route==="string"&&/^[a-z][a-z0-9_-]{0,39}$/.test(route);
}
export function createMCPUpstreamRouter({routes,defaultRoute="desktop"}: {routes: RouteDefinition[]; defaultRoute?: string}): UpstreamRouter{
  if(!Array.isArray(routes)||routes.length===0)invalid("ROUTES_REQUIRED");
  const mapping=new Map<string,{route:string;nativeName:string;upstream: RouteDefinition["upstream"];authorize: RouteDefinition["authorize"]}>(),seenRoutes=new Set<string>(),catalog:Tool[]=[],routeInfos:RouteInfo[]=[];
  for(const {id,upstream,exposeNativeNames=false,authorize=null} of routes){
    if(!validRoute(id)||seenRoutes.has(id))invalid("INVALID_OR_DUPLICATE_ROUTE");
    seenRoutes.add(id);
    if(!upstream||!Array.isArray(upstream.upstreamCatalog)||
      typeof upstream.forwardWorkspaceInvocation!=="function")invalid("INVALID_UPSTREAM");
    const names=new Set();
    for(const tool of upstream.upstreamCatalog){
      if(typeof tool?.name!=="string"||!tool.name||names.has(tool.name)||
        !tool.inputSchema||typeof tool.inputSchema!=="object")
        invalid("INVALID_UPSTREAM_CATALOG");
      names.add(tool.name);
      const publicName=exposeNativeNames?tool.name:id+"__"+tool.name;
      if(mapping.has(publicName)||publicName==="health_check"||
        publicName.startsWith("gateway_git_"))invalid("ROUTED_TOOL_COLLISION");
      mapping.set(publicName,{route:id,nativeName:tool.name,upstream,authorize});
      catalog.push({...namespaceReferences(id,tool),name:publicName});
    }
    routeInfos.push(Object.freeze({id,toolCount:names.size,nativeNames:exposeNativeNames}));
  }
  if(!seenRoutes.has(defaultRoute))invalid("DEFAULT_ROUTE_MISSING");
  checkedCatalog(catalog,tool=>tool.name);
  const promptEntries=async()=>{
    const entries=(await Promise.all(routes.map(async route=>(await route.upstream.listNativePrompts?.()??[]).map(prompt=>({route,prompt,name:route.id==='desktop'?prompt.name:route.id+'__'+prompt.name}))))).flat();
    // Validate the public names, including ambiguous double-underscore prefixes.
    checkedCatalog(entries.map(entry=>({...entry.prompt,name:entry.name})),prompt=>prompt.name);return entries;
  };
  return Object.freeze({
    async listResources(){const lists=await Promise.all(routes.map(async r=>(await r.upstream.listNativeResources?.()??[]).map(resource=>({...resource,uri:namespaceUri(r.id,resource.uri)}))));return checkedCatalog(lists.flat(),resource=>resource.uri);},
    async listResourceTemplates(){const lists=await Promise.all(routes.map(async r=>(await r.upstream.listNativeResourceTemplates?.()??[]).map(resource=>({...resource,uriTemplate:namespaceUri(r.id,resource.uriTemplate)}))));return checkedCatalog(lists.flat(),resource=>resource.uriTemplate);},
    async readResource(uri:string){const target=resolveNamespacedUri(uri),route=routes.find(r=>r.id===target.serverId);if(!route?.upstream.readNativeResource)invalid('RESOURCE_ROUTE_NOT_FOUND');return namespaceReferences(route.id,await route.upstream.readNativeResource(target.uri));},
    async listPrompts(){return (await promptEntries()).map(entry=>({...entry.prompt,name:entry.name}));},
    async getPrompt(name:string,args?:Record<string,string>){
      const entry=(await promptEntries()).find(entry=>entry.name===name);if(entry?.route.upstream.getNativePrompt)return namespaceReferences(entry.route.id,await entry.route.upstream.getNativePrompt(entry.prompt.name,args));invalid('PROMPT_NOT_FOUND');
    },
    upstreamCatalog:Object.freeze(catalog),
    routes:Object.freeze(routeInfos),
    async cacheScopeFor(target:{serverId:string;toolName:string}){return await routes.find(r=>r.id===target.serverId)?.upstream.cacheIdentity?.()??'os-account';},
    targetFor(publicName:string){const target=mapping.get(publicName);return target?{serverId:target.route,toolName:target.nativeName}:undefined;},
    routeFor(publicName: string){return mapping.get(publicName)?.route||null;},
    async authorizeExtension(publicName: string,args: ToolArguments){
      const target=mapping.get(publicName);
      if(!target||target.route===defaultRoute||
        typeof target.authorize!=="function")invalid("ROUTE_NOT_AUTHORIZED");
      const checked=await target.authorize(target.nativeName,args||{});
      if(!checked||typeof checked!=="object"||Array.isArray(checked))
        invalid("ROUTE_AUTHORIZATION_FAILED");
      return {name:publicName,arguments:checked};
    },
    async forwardWorkspaceInvocation(invocation: ToolInvocation){
      if(!invocation||typeof invocation.name!=="string"||
        !mapping.has(invocation.name))invalid("NO_SUCH_ROUTED_TOOL");
      const target=mapping.get(invocation.name)!;
      return namespaceReferences(target.route,await target.upstream.forwardWorkspaceInvocation({
        ...invocation,name:target.nativeName,arguments:invocation.arguments||{}
      }));
    }
  });
}
