import type { RequestContext,AuditSink,DenyRules,GitWorkflow,McpUpstream,ResourceProvider,UpstreamRouter,WorkspacePolicy } from "./contracts.js";
import type { InvocationMiddleware } from "./invocation.js";
import { createInvocationPipeline,safeAuditSink } from "./invocation.js";
import type { LocalDesktopReadProbe } from './local-desktop-read-probe.js';
import { createToolDispatcher } from "./tool-dispatch.js";
export type BridgeUpstream = McpUpstream & Partial<ResourceProvider> & Partial<Pick<LocalDesktopReadProbe,'callApprovedRead'|'callApprovedProjectRead'|'callApprovedCanaryWrite'|'callApprovedSystemName'>>;
export interface BridgeOptions {oauthScope?:string;request?:RequestContext;workspacePolicy?:WorkspacePolicy;upstreamRouter?:UpstreamRouter;nativePassthrough?:boolean;denyRules?:DenyRules|null;gitWorkflow?:GitWorkflow;middleware?:readonly InvocationMiddleware[]}
// Desktop Commander tool-schema facade. Upstream catalog remains unmodified.
// Preserve all native upstream tools; owner-approved native mode forwards unchanged.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
CallToolRequestSchema,
ListResourcesRequestSchema,
ListResourceTemplatesRequestSchema,
ListToolsRequestSchema,
ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { gitTools } from "./project-git-workflow.js";

export function createDesktopCommanderBridge(upstream: BridgeUpstream, audit: AuditSink=()=>{}, options: BridgeOptions={}) {
  const safeAudit = safeAuditSink(audit);
  const resourcesEnabled=typeof upstream.listResources==="function"&&
    typeof upstream.readResource==="function";
  const server=new Server({
    name:"mac-mcp-gateway-desktop-commander-bridge",version:"0.1.0"
  },{capabilities:{tools:{},...(resourcesEnabled?{resources:{}}:{})}});
  if(resourcesEnabled){
    server.setRequestHandler(ListResourcesRequestSchema,async()=>{
      return {resources:await upstream.listResources!()};
    });
    server.setRequestHandler(ReadResourceRequestSchema,async(request)=>{
      const uri=request.params.uri;
      const resources=await upstream.listResources!();
      if(!resources.some(item=>item.uri===uri))
        throw Error("MCP_UI_RESOURCE_NOT_ADVERTISED");
      return upstream.readResource!(uri);
    });
    server.setRequestHandler(ListResourceTemplatesRequestSchema,async()=>({
      resourceTemplates:typeof upstream.listResourceTemplates==="function"?
        await upstream.listResourceTemplates():[]
    }));
  }
  server.setRequestHandler(ListToolsRequestSchema,async()=>{
    const state=options.denyRules?await options.denyRules.snapshot():null;
    return {tools:[...upstream.upstreamCatalog,...(options.gitWorkflow?gitTools:[]),
    ...(options.workspacePolicy?.prepareDiskUsage?[{
      name:"gateway_disk_usage",
      description:"Read-only disk usage in KiB of an authorized directory, executed by local Desktop Commander",
      inputSchema:{type:"object",properties:{path:{type:"string"},
        depth:{type:"integer",minimum:0,maximum:1,default:1}},
        required:["path"],additionalProperties:false},
      annotations:{readOnlyHint:true,destructiveHint:false}
    }]:[]),{
      name:"health_check",
      description:"Mac MCP Gateway bridge connection and genuine upstream availability check",
      inputSchema:{type:"object",properties:{},additionalProperties:false},
      annotations:{readOnlyHint:true,destructiveHint:false}
    }].filter(tool=>!state?.deniedTools.includes(tool.name)).map(tool=>options.oauthScope?{...tool,
      securitySchemes:[{type:'oauth2',scopes:[options.oauthScope]}],
      _meta:{...('_meta' in tool?tool._meta:{}),securitySchemes:[{type:'oauth2',scopes:[options.oauthScope]}]}}:tool)};
  });
  const invoke = createInvocationPipeline({
    dispatch: createToolDispatcher(upstream, safeAudit, options),
    audit: safeAudit,
    ...(options.request ? {request:options.request} : {}),
    ...(options.denyRules ? {denyRules: options.denyRules} : {}),
    ...(options.middleware ? {middleware: options.middleware} : {})
  });
  server.setRequestHandler(CallToolRequestSchema, request => invoke(request.params));
  return server;
}
