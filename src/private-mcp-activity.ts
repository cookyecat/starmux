import type { AuditEvent } from "./contracts.js";
// Opt-in, in-memory, owner-local recent MCP tool activity only.
// Never retain caller identity, MCP params, tool name, payload, filenames,
// network headers, token, arbitrary audit fields or request IDs.
const MAX_EVENTS=8;
const WINDOW_MS=15*60*1000;
const ROUTE=/^[a-z][a-z0-9_-]{0,39}$/;
const COMPLETED=new Set(["DC_NATIVE_COMPLETED","DC_BRIDGE_COMPLETED",
  "MCP_ROUTE_COMPLETED","GIT_WORKFLOW_COMPLETE",
  "GATEWAY_DISK_USAGE_COMPLETED"]);
const BLOCKED=new Set(["TOOL_EXPLICITLY_DENIED","DC_BRIDGE_DENIED",
  "GATEWAY_DISK_USAGE_DENIED","MCP_ROUTE_DENIED",
  "GIT_WORKFLOW_DENIED","GATEWAY_CONFIG_MUTATION_DENIED"]);
const FAILED=new Set(["DC_NATIVE_UPSTREAM_FAILED","DC_BRIDGE_UPSTREAM_FAILED",
  "MCP_ROUTE_UPSTREAM_FAILED","GATEWAY_DISK_USAGE_UPSTREAM_FAILED",
  "GIT_WORKFLOW_UPSTREAM_FAILED"]);
export function createPrivateMCPActivity({now=()=>Date.now(),routeFor=()=>null}: {now?:()=>number;routeFor?:(name:string)=>string|null}={}){
  let events: {at:number;route:string|null;outcome:string}[]=[];
  function observation(audit: AuditEvent){
    const event=typeof audit?.event==="string"?audit.event:"";
    // COMPLETED means the transport got a tool response, not that the
    // tool succeeded. Preserve this distinction without retaining the
    // message, arguments, name, path or upstream error details.
    const outcome=BLOCKED.has(event)?"blocked":
      FAILED.has(event)?"error":
      COMPLETED.has(event)?(audit.isError===true?"error":"complete"):null;
    if(!outcome)return false;
    // Named health probes and config summaries are *not* AI activity.
    if(typeof audit.tool==="string"&&audit.tool==="health_check")return false;
    if(event==="GATEWAY_CONFIG_MUTATION_DENIED")return false;
    const via=typeof audit.tool==="string"?routeFor(audit.tool):null;
    const route=ROUTE.test(via||"")?via:
      event.startsWith("GATEWAY_DISK_USAGE_")?"desktop":
      event.startsWith("GIT_")?"gateway":
      event==="TOOL_EXPLICITLY_DENIED"?"unknown":"desktop";
    const at=now();
    if(!Number.isFinite(at)||at<0)return false;
    events.push({at,route,outcome});
    events=events.filter(x=>at-x.at>=0&&at-x.at<=WINDOW_MS).slice(-MAX_EVENTS);
    return true;
  }
  function snapshot(){
    const at=now();
    const recent=events.filter(x=>at-x.at>=0&&at-x.at<=WINDOW_MS);
    return Object.freeze({
      schemaVersion:1,
      enabled:true,
      evidence:"gateway-tool-dispatch-audit",
      attribution:"unverified",
      scope:"owner-local-memory",
      idleExpirySeconds:WINDOW_MS/1000,
      lastToolCallAt:recent.length?new Date(recent.at(-1)!.at).toISOString():null,
      recent:recent.slice(-5).reverse().map(x=>({
        at:new Date(x.at).toISOString(),route:x.route,outcome:x.outcome
      }))
    });
  }
  return Object.freeze({observeAudit:observation,snapshot});
}
