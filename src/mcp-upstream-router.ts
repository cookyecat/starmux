import type { RouteDefinition,RouteInfo,Tool,ToolArguments,ToolInvocation,UpstreamRouter } from "./contracts.js";
// MCP router: route upstream tool calls without implementing their functionality.
// Registered upstream servers own their tools; the DC route retains native names.
// Additional upstream tools are namespaced "<route>__<nativeTool>".
export class MCPRouteError extends Error {
  constructor(public readonly code: string){super(code);}
}
function invalid(message: string): never{throw new MCPRouteError(message);}
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
      catalog.push({...structuredClone(tool),name:publicName});
    }
    routeInfos.push(Object.freeze({id,toolCount:names.size,nativeNames:exposeNativeNames}));
  }
  if(!seenRoutes.has(defaultRoute))invalid("DEFAULT_ROUTE_MISSING");
  const resourceSource=routes.find(x=>x.id===defaultRoute)?.upstream;
  return Object.freeze({
    // Default native route's MCP App resources correspond to the unchanged
    // UI URIs advertised on its tools. Additional namespaced upstream
    // resource URIs require explicit collision/ownership contracts later.
    ...(typeof resourceSource?.listNativeResources==="function"&&
        typeof resourceSource?.readNativeResource==="function"?{
      async listResources(){return resourceSource.listNativeResources!();},
      async readResource(uri: string){return resourceSource.readNativeResource!(uri);},
      async listResourceTemplates(){
        return typeof resourceSource.listNativeResourceTemplates==="function"?
          resourceSource.listNativeResourceTemplates():[];
      }
    }:{}),
    upstreamCatalog:Object.freeze(catalog),
    routes:Object.freeze(routeInfos),
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
      return target.upstream.forwardWorkspaceInvocation({
        ...invocation,name:target.nativeName,arguments:invocation.arguments||{}
      });
    }
  });
}
