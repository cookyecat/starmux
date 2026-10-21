import type { GatewayStatus } from "./contracts.js";
import { isInteger } from "./validation.js";
// Human-facing status for the one local Gateway Core.
// Keep runtime JSON stable for scripts, show only observed facts to humans.
const RULE="─".repeat(48);
function value(v: unknown,fallback="—"){return v===null||v===undefined||v===""?fallback:String(v);}
function stateOf(s: GatewayStatus): [string,string,string] {
  if(s.health==="ok"&&s.coreControl==="RUNNING")return ["● RUNNING","Healthy","healthy"];
  if(s.executionMode==="stopped"&&["not-running",null].includes(s.health))
    return ["○ STOPPED","Not running","stopped"];
  if(s.health==="ok")return ["● DETECTED","Ownership not verified","warning"];
  if(s.executionMode==="unknown-listener")return ["! UNKNOWN","Unrecognized listener","warning"];
  return ["! ATTENTION",value(s.health,"Unavailable"),"warning"];
}
function tint(label: string,kind: string,color: boolean){
  if(!color)return label;
  const ansi: Record<string,string>={healthy:"\u001b[32m",stopped:"\u001b[90m",warning:"\u001b[33m"};
  return (ansi[kind]||"")+label+"\u001b[0m";
}
export function formatGatewayStatus(s: GatewayStatus,{version="",color=false}={}){
  if(s?.event!=="GATEWAY_STATUS")throw Error("EXPECTED_GATEWAY_STATUS");
  const [state,description,kind]=stateOf(s);
  const port=isInteger(s.port)?s.port:null;
  const active=s.health==="ok"&&s.coreControl==="RUNNING";
  const endpoint=port?"http://127.0.0.1:"+port:"Not configured";
  const launcher=s.coreLauncher==="app"?"Menu bar App":
    s.coreLauncher==="cli"?"CLI":s.coreLauncher==="unknown"?"Unknown":value(s.coreLauncher);
  const session=s.executionMode==="foreground"?"Foreground":
    s.executionMode==="stopped"?"Stopped":value(s.executionMode);
  const autostart=s.loginAutostart==="disabled"?"Off":
    s.loginAutostart==="enabled"?"On":value(s.loginAutostart,"Unknown");
  const permission=s.workspaceMode==="read-only"?"Read only":
    s.workspaceMode==="read-write"?"Read / write":"Not confirmed";
  const line=(label: string,data: string)=>"  "+label.padEnd(16)+data;
  const lines=[
    "",
    "  Mac MCP Gateway"+(version?"  v"+version:""),
    "  "+RULE,
    line("Core",tint(state,kind,color)+"  "+description),
    line("Local endpoint",endpoint),
    line("Dashboard",port?endpoint+"/dashboard":"Not available"),
    line("Access control",s.accessMode==="api-key"?"Gateway API key required":s.accessMode==="ingress"?"Managed by ingress":s.accessMode==="unavailable"?"Unavailable · MCP blocked":"Not confirmed"),
    line("Permissions",permission),
    line("Write scope",s.writeScope==="home-only"?"Home only · Outside read-only":
      s.writeScope==="unrestricted"?"Unrestricted (trusted)": "Not confirmed"),
    line("Launcher",active?launcher+" · "+session:session),
    line("Core PID",active?value(s.listenerPid):"—"),
    line("Controller PID",active?value(s.coreOwnerPid):"—"),
    line("Login autostart",autostart),
    "  "+RULE
  ];
  if(active)
    lines.push("  CLI controls: mac-mcp-gateway stop   |   mac-mcp-gateway run");
  else if(kind==="stopped")
    lines.push("  CLI start: mac-mcp-gateway run");
  else if(kind==="warning")
    lines.push("  Tip: Check the local listener and Core ownership before restarting.");
  lines.push("  Remote Tunnel / HTTPS connections are not verified here.");
  lines.push("  Machine output: mac-mcp-gateway status --json","");
  return lines.join("\n")+"\n";
}
