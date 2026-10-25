import {supportedHost} from "../platform.js";
import { z } from "zod";
import { legacyCliEntry as cliEntry,packageRoot,desktopCommanderEntry } from "../runtime-paths.js";
import { errorCode,errorMessage,isInteger,parseJSON } from "../validation.js";
const packageSchema=z.object({version:z.string(),dependencies:z.record(z.string())});
// Minimal, portable local Gateway entrypoint. No implicit public network binding.
import { access,readFile } from "node:fs/promises";
import path from "node:path";

const project=packageRoot;
const pkg=packageSchema.parse(parseJSON(await readFile(path.join(project,"package.json"),"utf8")));
const command=process.argv[2]||"help";

function help(){
  process.stdout.write(`Mac MCP Gateway ${pkg.version}

Usage:
  mac-mcp-gateway instance create NAME --project /absolute/path
  mac-mcp-gateway instance list [--json]
  mac-mcp-gateway instance import FILE --name NAME [--link]
  mac-mcp-gateway instance copy|rename NAME NEW_NAME
  mac-mcp-gateway instance default|archive|restore NAME
  mac-mcp-gateway instance migrate [setup|live] [--confirm]
  mac-mcp-gateway config path|show|edit|validate|diff|apply --instance NAME
  mac-mcp-gateway run|stop|status|doctor|verify|logs --instance NAME
  mac-mcp-gateway status --all --json

  mac-mcp-gateway run [--port N]         Foreground; Ctrl+C stops; current OS account
  mac-mcp-gateway run --app-parent-pid PID  App-owned foreground; stops if GUI parent exits
  mac-mcp-gateway stop                 Stop the Core at the configured local endpoint
  mac-mcp-gateway status               Human-readable health for the configured Core
  mac-mcp-gateway status --json        Original structured status for scripts/agents
  mac-mcp-gateway logs [--lines N]     Inspect local Gateway logs (owner only)
  mac-mcp-gateway privacy [--all] [--target /absolute/path]
                                          macOS only: compare terminal and Gateway protected-directory access

  mac-mcp-gateway access              Show access mode and client credentials
  mac-mcp-gateway access create "Name" Create a key (displayed once)
  mac-mcp-gateway access mode api-key Require a key on every MCP request
  mac-mcp-gateway access mode ingress Delegate access control to ingress
  mac-mcp-gateway access revoke ID    Revoke one credential immediately
  mac-mcp-gateway access oauth configure --issuer URL --resource URL --client-id ID --subjects SUBJECT
                                      Discover and save OAuth settings; does not enable auth
  mac-mcp-gateway access oauth doctor  Check OAuth discovery and PKCE support
  mac-mcp-gateway access mode oauth    Require OAuth on MCP requests
  mac-mcp-gateway access revoke-oauth ID Revoke an OAuth session locally
  mac-mcp-gateway access owner-token  Show the local Dashboard management token

  mac-mcp-gateway setup               Configure local access and connection preference
  mac-mcp-gateway doctor              Check saved configuration and Desktop Commander
  mac-mcp-gateway verify              Verify the running local MCP endpoint

  --profile auto|live|setup            Advanced configuration selection only
  run --json                          Structured startup identity and lifecycle events

Configuration:
  Saved onboarding settings take precedence over legacy installation settings.
  run always starts the Core shipped with this CLI and displays its build identity.

Advanced environment-based doctor:
  MAC_MCP_PROJECT_ROOT=/absolute/canonical/project

Optional:
  MAC_MCP_WORKSPACE_MODE=read-only|read-write       (default read-only)
  MAC_MCP_PROJECT_PORT=8793                         (127.0.0.1 only)
  MAC_MCP_DEV_COMMANDS=presets|trusted-project      (default presets)
  MAC_MCP_GIT_MODE=off|review|write|push             (default off)
  MAC_MCP_WORKTREE_MODE=off|linked                  (default off)

IMPORTANT: trusted-project Shell inherits the current OS account's permissions.
The Core binds loopback. Configure protected HTTPS or Tunnel for remote access.
Gateway key authentication is optional; access defaults to managed by ingress.
`);
}
async function doctor(){
  const facts: {event:string;node:string;platform:string;workspaceConfigured:boolean;mode:string;devCommands:string;upstreamVersion:string|null;workspaceValidated?:boolean;workspaceMode?:string;gitMode?:string;worktreeMode?:string;desktopCommanderTools?:number;result?:string;reason?:string}={event:"GATEWAY_DOCTOR",node:process.version,platform:process.platform,
    workspaceConfigured:Boolean(process.env.MAC_MCP_PROJECT_ROOT),
    mode:process.env.MAC_MCP_WORKSPACE_MODE||"read-only",
    devCommands:process.env.MAC_MCP_DEV_COMMANDS||"presets",
    upstreamVersion:pkg.dependencies?.["@wonderwhy-er/desktop-commander"]||null};
  let code=0;
  try{
    const {createProjectPolicy}=await import("../project-workspace-policy.js");
    const {LocalDesktopReadProbe}=await import("../local-desktop-read-probe.js");
    supportedHost();
    if(!facts.workspaceConfigured)throw Error("MAC_MCP_PROJECT_ROOT_REQUIRED");
    const nativeAccessMode=process.env.MAC_MCP_DC_ACCESS_MODE||"workspace";
    if(!["workspace","native"].includes(nativeAccessMode)||
       (nativeAccessMode==="native"&&
        (facts.devCommands!=="trusted-project"||facts.mode!=="read-write")))
      throw Error("NATIVE_ACCESS_REQUIRES_OWNER_TRUSTED_DEVELOPER_PROFILE");
    const policy=await createProjectPolicy({
      root:process.env.MAC_MCP_PROJECT_ROOT,
      mode:facts.mode,developerCommands:facts.devCommands,
      allowTrustedHomeRoot:nativeAccessMode==="native"&&facts.devCommands==="trusted-project"
    });
    facts.workspaceValidated=true;
    facts.workspaceMode=policy.mode;
    const desiredPort=Number(process.env.MAC_MCP_PROJECT_PORT||8793);
    if(!isInteger(desiredPort)||desiredPort<0||desiredPort>65535)
      throw Error("INVALID_PROJECT_PORT");
    const gitMode=process.env.MAC_MCP_GIT_MODE||"off";
    if(!["off","review","write","push"].includes(gitMode))throw Error("INVALID_GIT_MODE");
    facts.gitMode=gitMode;
    const worktreeMode=process.env.MAC_MCP_WORKTREE_MODE||"off";
    if(!["off","linked"].includes(worktreeMode))throw Error("INVALID_WORKTREE_MODE");
    facts.worktreeMode=worktreeMode;
    await access(desktopCommanderEntry);
    const dc=new LocalDesktopReadProbe({
      writeScope:process.env.MAC_MCP_DC_WRITE_SCOPE||"unrestricted"
    });
    try{
      await dc.connect();
      facts.desktopCommanderTools=dc.upstreamCatalog.length;
      if(!dc.upstreamCatalog.some(t=>t.name==="start_process"))
        throw Error("DESKTOP_COMMANDER_START_PROCESS_MISSING");
      facts.result="PASS";
    }finally{await dc.close().catch(()=>{});}
  }catch(error){
    facts.result="FAIL";
    facts.reason=String(errorCode(error)||errorMessage(error)||"UNKNOWN").slice(0,100);
    code=1;
  }
  // Never include access tokens, project paths, command arguments or private filenames.
  process.stdout.write(JSON.stringify(facts)+"\n");
  process.exitCode=code;
}
if(await (await import("./instances.js")).maybeHandleInstances(process.argv.slice(2))){
  // Shared named-instance commands own their complete lifecycle.
}else if(command==="setup"){
  process.argv.splice(2,1);
  await import("./setup-wizard.js");
}else if(command==="access"){
  try{await (await import("./access.js")).accessCommand(process.argv.slice(3));}
  catch(error){process.stderr.write("GATEWAY_ACCESS_ERROR "+errorMessage(error)+"\n");process.exitCode=1;}
}else if(command==="verify"){
  await import("./verify-setup.js");
}else if(command==="help"||command==="--help"||command==="-h"){
  help();
}else if(command==="doctor"){
  if(process.env.MAC_MCP_PROJECT_ROOT)await doctor();
  else{
    try{
      const {loadSetupConfig,setupRuntimeEnv}=await import("../release1-onboarding.js");
      Object.assign(process.env,setupRuntimeEnv(await loadSetupConfig()));
      await doctor();
    }catch(error){
      if(errorCode(error)==="ENOENT")await doctor();
      else process.stdout.write(JSON.stringify({event:"GATEWAY_DOCTOR",result:"FAIL",
        reason:errorCode(error)||errorMessage(error)})+"\n");
      process.stderr.write("Run mac-mcp-gateway setup to configure local access.\n");
      process.exitCode=1;
    }
  }
 }else if(["run","install","start","stop","restart","status","logs","privacy"].includes(command)){
  try{
    const {parseArgs,operatorCommand}=await import("../operator-cli.js");
    const {options}=parseArgs(process.argv.slice(2));
    const result=await operatorCommand(command,{
      ...options,entry:cliEntry()
    });
    if(result.event==="GATEWAY_LOGS")process.stdout.write(result.output);
    else if(result.event==="GATEWAY_RUN_EXIT"&&!options.json&&options.appParentPid===undefined)
      process.stdout.write(result.code===0?"  Gateway stopped.\n":`  Gateway exited with code ${result.code}.\n`);
    else if(result.event==="GATEWAY_STATUS"&&!options.json){
      const {formatGatewayStatus}=await import("../gateway-status-format.js");
      process.stdout.write(formatGatewayStatus(result,{
        version:pkg.version,color:Boolean(process.stdout.isTTY)&&!process.env.NO_COLOR
      }));
    }else process.stdout.write(JSON.stringify(result)+"\n");
    if(result.event==="GATEWAY_RUN_EXIT")process.exitCode=result.code;
  }catch(error){
    process.stderr.write("GATEWAY_CLI_ERROR "+
      String(errorCode(error)||errorMessage(error)||"UNKNOWN").slice(0,240)+"\n");
    process.exitCode=1;
  }
}else if(command==="start-raw"){
  // Legacy direct entry bypassed global one-Core arbitration. Never allow
  // a public subprocess to start a second ungoverned production Core.
  process.stderr.write("LEGACY_DIRECT_BOOTSTRAP_DISABLED_USE_SETUP\n");
  process.exitCode=2;
}else if(command==="doctor-setup"||command==="start-setup"){
  try{
    const {loadSetupConfig,setupRuntimeEnv}=await import("../release1-onboarding.js");
    if(command==="start-setup"){
      const ownerPid=Number(process.env.MAC_MCP_INTERNAL_SETUP_OWNER_PID);
      const runId=process.env.MAC_MCP_INTERNAL_SETUP_RUN_ID;
      const token=process.env.MAC_MCP_INTERNAL_SETUP_TOKEN;
      const internallyLaunched=Boolean(ownerPid&&runId&&token);
      if(!internallyLaunched){
        // Legacy user command is now an alias for supervised CLI Run.
        const {operatorCommand}=await import("../operator-cli.js");
        const result=await operatorCommand("run",{
          profile:"setup",entry:cliEntry()
        });
        process.stdout.write(JSON.stringify(result)+"\n");
        if(result.event==="GATEWAY_RUN_EXIT")process.exitCode=result.code;
      }else{
        const {verifyInternalSetupWorker}=await import("../global-core-control.js");
        const config=await loadSetupConfig(process.env.MAC_MCP_SETUP_FILE);
        verifyInternalSetupWorker({
          port:config.port,ownerPid,runId,token
        });
        Object.assign(process.env,setupRuntimeEnv(config));
        delete process.env.MAC_MCP_UPSTREAMS_FILE;
        const {runGateway}=await import("../dc-workspace-http.js");
        await runGateway();
      }
    }else{
      const config=await loadSetupConfig(process.env.MAC_MCP_SETUP_FILE);
      Object.assign(process.env,setupRuntimeEnv(config));
      delete process.env.MAC_MCP_UPSTREAMS_FILE;
      await doctor();
    }
  }catch(error){
    process.stderr.write("SETUP_PROFILE_INVALID "+
      String(errorCode(error)||errorMessage(error)||"UNKNOWN").slice(0,90)+"\n");
    process.exitCode=1;
  }
}else{
  process.stderr.write("Unknown command. Use --help.\n");
  process.exitCode=2;
}
