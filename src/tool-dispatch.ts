import type { AuditSink,CallToolResult,RequestContext,ToolInvocation } from './contracts.js';
import type { BridgeOptions,BridgeUpstream } from './desktop-commander-facade.js';
import { authorizeInvocation,createInvocationExecutor,observeSafely } from './invocation.js';
import { errorCode } from './validation.js';

// The dispatch order is part of the compatibility contract: Gateway tools,
// extension routes, owner-enabled native mode, workspace policy, then fixtures.
export function createToolDispatcher(upstream: BridgeUpstream, audit: AuditSink, options: BridgeOptions) {
  const execute = createInvocationExecutor(upstream);
  return async (params: ToolInvocation, context: RequestContext): Promise<CallToolResult> => {
    const id = context.requestId;
    const name = params.name;
    const args = params.arguments || {};
    const observe = (fn: () => void) => observeSafely(fn, audit, context);
    if(name==="health_check"){
      audit({event:"DC_BRIDGE_HEALTH_CHECK",requestId:id});
      return {content:[{type:"text",text:JSON.stringify({
        status:"ok",service:"mac-mcp-gateway-dc-bridge",
        upstream:"desktop-commander",tools:upstream.upstreamCatalog.length,
        routes:options.upstreamRouter?.routes||[{id:"desktop",toolCount:upstream.upstreamCatalog.length}],
        workspaceMode:options.workspacePolicy?.mode||"fixed-fixture",
        developerCommands:options.workspacePolicy?.developerCommands||"fixed-fixture",
        nativeAccess:options.nativePassthrough===true,
        traceId:id
      })}]};
    }
    // Present effective Gateway permissions, not the raw upstream config.
    if(name==="get_config"&&options.workspacePolicy&&!options.nativePassthrough){
      const policy=options.workspacePolicy;
      audit({event:"GATEWAY_CONFIG_READ",requestId:id});
      return {content:[{type:"text",text:JSON.stringify({
        source:"mac-mcp-gateway",configType:"effective-workspace-summary",
        projectRoot:policy.root,workspaceMode:policy.mode,
        developerCommands:policy.developerCommands,
        commandSafety:"Desktop Commander upstream blocklist; advisory, not OS sandbox",
        remoteConfigMutation:"owner-only",
        nativeToolCount:upstream.upstreamCatalog.length,
        grantsDashboard:policy.grantsSnapshot?"/permissions":null,
        note:"Gateway summary; not the complete upstream Desktop Commander config."
      },null,2)}]};
    }
    if(name==="set_config_value"&&options.workspacePolicy&&!options.nativePassthrough){
      audit({event:"GATEWAY_CONFIG_MUTATION_DENIED",requestId:id});
      return {isError:true,content:[{type:"text",text:
        "OWNER_ONLY_CONFIG: Remote AI cannot modify safety settings; use the Mac owner dashboard."}]};
    }
    if(name==="gateway_disk_usage"&&options.workspacePolicy?.prepareDiskUsage){
      try{
        if(!args||typeof args.path!=="string"||
           Object.keys(args).some(k=>!["path","depth"].includes(k)))
          throw Error("DISK_USAGE_ARGUMENTS_DENIED");
        const invocation=await options.workspacePolicy.prepareDiskUsage(
          args.path,args.depth??1);
        const result=await execute(authorizeInvocation(invocation));
        observe(() => options.workspacePolicy?.observe?.("start_process",result,
          {command:"gateway_disk_usage"}));
        audit({event:"GATEWAY_DISK_USAGE_COMPLETED",requestId:id,
          isError:result.isError===true});
        return result;
      }catch(error){
        audit({event:"GATEWAY_DISK_USAGE_DENIED",requestId:id,
          reason:errorCode(error)||"DISK_USAGE_ERROR"});
        return {isError:true,content:[{type:"text",text:"WORKSPACE_DENIED: "+
          "Check directory grants on the Mac Dashboard /permissions"}]};
      }
    }
    if(options.gitWorkflow?.names.includes(name)){
      audit({event:"GIT_WORKFLOW_ATTEMPT",requestId:id,tool:name});
      try{
        const result=await options.gitWorkflow.handle(name,args);
        audit({event:"GIT_WORKFLOW_COMPLETE",requestId:id,tool:name});
        return result;
      }catch(error){
        audit({event:"GIT_WORKFLOW_DENIED",requestId:id,tool:name,
          reason:errorCode(error)||"GIT_WORKFLOW_FAILED"});
        return {isError:true,content:[{type:"text",text:"GIT_WORKFLOW_DENIED"}]};
      }
    }
    if(options.upstreamRouter?.routeFor(name)&&
       options.upstreamRouter.routeFor(name)!=="desktop"){
      let routed;
      try{routed=await options.upstreamRouter.authorizeExtension(name,args);}
      catch(error){
        audit({event:"MCP_ROUTE_DENIED",requestId:id,tool:name,
          reason:errorCode(error)||"ROUTE_POLICY"});
        return {isError:true,content:[{type:"text",text:"ROUTE_DENIED"}]};
      }
      audit({event:"MCP_ROUTE_FORWARDED",requestId:id,tool:name});
      try{
        const result=await execute(authorizeInvocation(routed));
        audit({event:"MCP_ROUTE_COMPLETED",requestId:id,tool:name,
          isError:result.isError===true});
        return result;
      }catch(error){
        // Report ambiguous remote effects distinctly; never silently replay.
        const code=errorCode(error)==="UPSTREAM_CALL_UNCERTAIN"?
          "UPSTREAM_CALL_UNCERTAIN":"UPSTREAM_UNAVAILABLE";
        audit({event:"MCP_ROUTE_UPSTREAM_FAILED",requestId:id,tool:name,reason:code});
        return {isError:true,content:[{type:"text",text:code}]};
      }
    }
    // Deliberately trusted, owner-enabled native mode: the upstream server
    // and the macOS process account decide execution. Do not maintain a
    // second incomplete tool/path/argument whitelist here. Never use this
    // path for unrecognized names, routed extensions or Gateway tools.
    if(options.nativePassthrough&&
       upstream.upstreamCatalog.some(tool=>tool.name===name)){
      audit({event:"DC_NATIVE_FORWARDED",requestId:id,tool:name});
      try{
        const result=await execute(authorizeInvocation({name,arguments:args}));
        audit({event:"DC_NATIVE_COMPLETED",requestId:id,tool:name,
          isError:result.isError===true});
        return result;
      }catch(error){
        const reason=errorCode(error)==="UPSTREAM_CALL_UNCERTAIN"?
          "UPSTREAM_CALL_UNCERTAIN":"UPSTREAM_UNAVAILABLE";
        audit({event:"DC_NATIVE_UPSTREAM_FAILED",requestId:id,tool:name,reason});
        return {isError:true,content:[{type:"text",text:reason}]};
      }
    }
    if(options.workspacePolicy){
      let invocation;
      try{invocation=await options.workspacePolicy.prepare(name,args);}
      catch(error){
        audit({event:"DC_BRIDGE_DENIED",requestId:id,tool:name,
               reason:errorCode(error)||"POLICY_ERROR"});
        return {isError:true,content:[{type:"text",text:
          options.workspacePolicy.grantsSnapshot?
            "WORKSPACE_DENIED: Review directory grants on your Mac Dashboard /permissions":
            "WORKSPACE_DENIED"}]};
      }
      audit({event:"DC_BRIDGE_FORWARDED",requestId:id,tool:name});
      try{
        const result=await execute(authorizeInvocation(invocation));
        observe(() => options.workspacePolicy?.observe?.(name,result,args));
        audit({event:"DC_BRIDGE_COMPLETED",requestId:id,tool:name,
               commandBytes:name==="start_process"?Buffer.byteLength(String(args.command||"")):undefined,
               isError:result.isError===true});
        return result;
      }catch{
        audit({event:"DC_BRIDGE_UPSTREAM_FAILED",requestId:id,tool:name});
        return {isError:true,content:[{type:"text",text:"UPSTREAM_UNAVAILABLE"}]};
      }
    }
    const keys=Object.keys(args);
    const allowed=(name==="read_file"&&
      ["p1-fixture.txt","dc-bridge-canary.txt","README.md"].includes(String(args.path))&&
      keys.length===1&&keys[0]==="path") ||
      (name==="write_file"&&args.path==="dc-bridge-canary.txt"&&
       typeof args.content==="string"&&Buffer.byteLength(args.content)<=256&&
       keys.every(k=>["path","content"].includes(k))) ||
      (name==="start_process"&&args.command==="/usr/bin/uname -s"&&
       args.timeout_ms===3000&&
       keys.every(k=>["command","timeout_ms"].includes(k)));
    if(!allowed){
      audit({event:"DC_BRIDGE_DENIED",requestId:id,tool:name});
      return {isError:true,content:[{type:"text",text:"NOT_APPROVED_IN_P1_FIXTURE"}]};
    }
    audit({event:"DC_BRIDGE_FORWARDED",requestId:id,tool:name});
    try {
      let response;
      if(name==="read_file"&&args.path!=="README.md")
        response=await upstream.callApprovedRead!(String(args.path));
      else if(name==="read_file")
        response=await upstream.callApprovedProjectRead!();
      else if(name==="write_file")
        response=await upstream.callApprovedCanaryWrite!(String(args.content));
      else
        response=await upstream.callApprovedSystemName!();
      audit({event:"DC_BRIDGE_COMPLETED",requestId:id,tool:name,
             isError:response.isError===true});
      return response;
    }catch{
      audit({event:"DC_BRIDGE_UPSTREAM_FAILED",requestId:id,tool:name});
      return {isError:true,content:[{type:"text",text:"UPSTREAM_FAILED"}]};
    }
  };
}
