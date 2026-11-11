import {mcpCallContext} from './mcp-call-context.js';
import {randomUUID} from 'node:crypto';
import {UriTemplate} from '@modelcontextprotocol/sdk/shared/uriTemplate.js';
import type {MiddlewareEngine} from './middleware-engine.js';
import type { RequestContext,AuditSink,DenyRules,GitWorkflow,McpUpstream,PromptProvider,ResourceProvider,UpstreamRouter,WorkspacePolicy } from "./contracts.js";
import type { InvocationObserver,InvocationMiddleware } from "./invocation.js";
import { createInvocationPipeline,safeAuditSink } from "./invocation.js";
import { createToolDispatcher,createToolAuthorizer } from "./tool-dispatch.js";
import { isReadOnlyTool } from './account-access-policy.js';
export type BridgeUpstream = McpUpstream & Partial<ResourceProvider & PromptProvider>;
export interface BridgeOptions {getSnapshot?:()=>{upstream:BridgeUpstream;middleware:MiddlewareEngine|undefined;router:UpstreamRouter;release:()=>void};upstreamTrace?:(id:string,stage:'upstreamRequest'|'upstreamResponse',value:unknown)=>void;retainSnapshot?:()=>()=>void;programmableMiddleware?:MiddlewareEngine;observer?:InvocationObserver;oauthScope?:string;request?:RequestContext;workspacePolicy?:WorkspacePolicy;upstreamRouter?:UpstreamRouter;nativePassthrough?:boolean;globalReadOnly?:boolean;permissionMode?:'global'|'workspace';denyRules?:DenyRules|null;gitWorkflow?:GitWorkflow;middleware?:readonly InvocationMiddleware[]}
// Desktop Commander tool-schema facade. Upstream catalog remains unmodified.
// Preserve all native upstream tools; owner-approved native mode forwards unchanged.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
CallToolRequestSchema,
ListPromptsRequestSchema,GetPromptRequestSchema,
ListResourcesRequestSchema,
ListResourceTemplatesRequestSchema,
ListToolsRequestSchema,
ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { gitTools } from "./project-git-workflow.js";

export function createDesktopCommanderBridge(upstream: BridgeUpstream, audit: AuditSink=()=>{}, options: BridgeOptions={}) {
  const safeAudit = safeAuditSink(audit);
  const current=async<T>(fn:(upstream:BridgeUpstream,options:BridgeOptions)=>Promise<T>):Promise<T>=>{
    const snapshot=options.getSnapshot?.();
    if(!snapshot)return fn(upstream,options);
    const {programmableMiddleware,upstreamRouter,...base}=options;
    try{return await fn(snapshot.upstream,{...base,upstreamRouter:snapshot.router,...(snapshot.middleware?{programmableMiddleware:snapshot.middleware}:{}),...(options.request?{request:{...options.request,requestId:randomUUID()}}:{})});}finally{snapshot.release();}
  };
  const resourcesEnabled=typeof upstream.listResources==="function"&&
    typeof upstream.readResource==="function";
  const server=new Server({
    name:"starmux-desktop-commander-bridge",version:"0.1.0"
  },{capabilities:{tools:options.getSnapshot?{listChanged:true}:{},...(resourcesEnabled?{resources:options.getSnapshot?{listChanged:true}:{}}:{}),...(upstream.listPrompts&&upstream.getPrompt?{prompts:options.getSnapshot?{listChanged:true}:{}}:{})}});
  if(upstream.listPrompts&&upstream.getPrompt){server.setRequestHandler(ListPromptsRequestSchema,async()=>current(async upstream=>({prompts:await upstream.listPrompts!()})));server.setRequestHandler(GetPromptRequestSchema,async request=>current(upstream=>upstream.getPrompt!(request.params.name,request.params.arguments)));}
  if(resourcesEnabled){
    server.setRequestHandler(ListResourcesRequestSchema,async()=>current(async upstream=>{
      return {resources:await upstream.listResources!()};
    }));
    server.setRequestHandler(ReadResourceRequestSchema,async(request)=>current(async upstream=>{
      const uri=request.params.uri;
      const resources=await upstream.listResources!();
      if(!resources.some(item=>item.uri===uri)&&!(await upstream.listResourceTemplates?.()??[]).some(t=>new UriTemplate(t.uriTemplate).match(uri)))
        throw Error("MCP_UI_RESOURCE_NOT_ADVERTISED");
      return upstream.readResource!(uri);
    }));
    server.setRequestHandler(ListResourceTemplatesRequestSchema,async()=>current(async upstream=>({
      resourceTemplates:typeof upstream.listResourceTemplates==="function"?
        await upstream.listResourceTemplates():[]
    })));
  }
  server.setRequestHandler(ListToolsRequestSchema,async()=>current(async(upstream,options)=>{
    const state=options.denyRules?await options.denyRules.snapshot():null;
    return {tools:[...(options.programmableMiddleware?.catalog??upstream.upstreamCatalog),...(options.gitWorkflow?gitTools:[]),
    ...(options.workspacePolicy?.prepareDiskUsage?[{
      name:"gateway_disk_usage",
      description:"Read-only disk usage in KiB of an authorized directory, executed by local Desktop Commander",
      inputSchema:{type:"object",properties:{path:{type:"string"},
        depth:{type:"integer",minimum:0,maximum:1,default:1}},
        required:["path"],additionalProperties:false},
      annotations:{readOnlyHint:true,destructiveHint:false}
    }]:[]),{
      name:"health_check",
      description:"Starmux bridge connection, upstream availability and active mode check. Read-only blocks writes and arbitrary execution; Coding uses upstream tools with OS account permissions.",
      inputSchema:{type:"object",properties:{},additionalProperties:false},
      annotations:{readOnlyHint:true,destructiveHint:false}
    }].filter(tool=>!state?.deniedTools.includes(tool.name)&&!state?.deniedTools.includes(options.programmableMiddleware?.canonical(tool.name)??tool.name)&&(!options.globalReadOnly||isReadOnlyTool(options.programmableMiddleware?.canonical(tool.name)??tool.name))).map(tool=>options.oauthScope?{...tool,
      securitySchemes:[{type:'oauth2',scopes:[options.oauthScope]}],
      _meta:{...('_meta' in tool?tool._meta:{}),securitySchemes:[{type:'oauth2',scopes:[options.oauthScope]}]}}:tool)};
  }));
  const invokeCurrent=(upstream:BridgeUpstream,options:BridgeOptions,params:import('./contracts.js').ToolInvocation)=>{
  const call=mcpCallContext.getStore();if(call&&options.request)call.trace=(stage,value)=>options.upstreamTrace?.(options.request!.requestId,stage,value);
  const dispatch=createToolDispatcher(upstream,safeAudit,options),authorize=createToolAuthorizer(upstream,options);
  const invoke = createInvocationPipeline({
    ...(options.observer?{observer:options.observer}:{}),
    dispatch:(params,context)=>options.programmableMiddleware&&options.programmableMiddleware.canonical(params.name)?options.programmableMiddleware.invoke(params,authorize,invocation=>dispatch(invocation,context),context.requestId,async target=>JSON.stringify([context.identity,options.globalReadOnly,options.permissionMode,await options.upstreamRouter?.cacheScopeFor?.(target)])):options.programmableMiddleware&&upstream.upstreamCatalog.some(t=>t.name===params.name)?Promise.resolve({isError:true,content:[{type:'text' as const,text:'TOOL_NOT_PUBLISHED'}]}):dispatch(params,context),
    audit: safeAudit,
    ...(options.request ? {request:options.request} : {}),
    ...(options.denyRules ? {denyRules: options.denyRules} : {}),
    ...(options.middleware ? {middleware: options.middleware} : {})
  });
  return invoke(params);
  };
  const bridgeSession=randomUUID();
  server.setRequestHandler(CallToolRequestSchema,(request,extra)=>mcpCallContext.run({
    sessionId:extra.sessionId??bridgeSession,capabilities:server.getClientCapabilities()??{},signal:extra.signal,
    progress:async progress=>{const progressToken=request.params._meta?.progressToken;if(progressToken!==undefined)await extra.sendNotification({method:'notifications/progress',params:{...progress,progressToken}});},
    interact:async(method,params,signal)=>{
      if(method==='sampling/createMessage')return server.createMessage(params as import('@modelcontextprotocol/sdk/types.js').CreateMessageRequest['params'],{signal});
      if(method==='elicitation/create')return server.elicitInput(params as import('@modelcontextprotocol/sdk/types.js').ElicitRequest['params'],{signal});
      return server.listRoots(undefined,{signal});
    }
  },()=>current((upstream,options)=>invokeCurrent(upstream,options,request.params))));
  return server;
}
