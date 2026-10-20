#!/usr/bin/env node
import { errorCode,errorMessage } from "../validation.js";
// Guided Release 1 setup, with a non-interactive test path. No arbitrary shell,
// downloads, OAuth tokens, cert files, public listeners or launchd changes.
import { lstat,realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { stdin as input,stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { defaultSetupPath,saveSetupConfig } from "../release1-onboarding.js";

const help=`Mac MCP Gateway · Release 1 setup

Usage:
  mac-mcp-gateway setup
  mac-mcp-gateway setup --project /absolute/project --connection tunnel|https --mode read-only|read-write [--port 18893] [--approve-write] [--replace]
  mac-mcp-gateway setup --access-role trusted --connection tunnel|https [--project /default-directory] [--port 18893] --approve-trusted-developer
  mac-mcp-gateway setup --access-role restricted --project /specific/project --connection tunnel|https [--port 18893]

After setup:
  mac-mcp-gateway doctor
  mac-mcp-gateway run

Setup does not establish a remote connection. It configures a safe local
Gateway and prints verified manual steps for Tunnel or authenticated HTTPS.
Do not expose :8793 or another local HTTP port directly on the internet.
`;
function parse(argv: string[]){
  const result: Record<string,string|boolean|undefined>={};
  const bare=new Set(["--replace","--approve-write","--approve-trusted-developer","--help","--app-json"]);
  const valued=new Map([["--project","project"],["--mode","mode"],
    ["--connection","connection"],["--port","port"],["--access-role","accessRole"]]);
  for(let i=0;i<argv.length;i++){
    const arg=argv[i]!;
    if(bare.has(arg)){result[arg.slice(2)]=true;continue;}
    const key=valued.get(arg);
    if(!key||!argv[i+1]||argv[i+1]!.startsWith("--")||result[key]!==undefined)
      throw Error("SETUP_ARGUMENT_INVALID");
    result[key]=argv[++i];
  }
  return result;
}
const args=parse(process.argv.slice(2));
const appJSON=Boolean(args["app-json"]);
const say=(message: string)=>{if(!appJSON)output.write(message);};
if(args.help){output.write(help);process.exit(0);}
const interactive=process.stdin.isTTY===true;
if(!interactive&&((!args.project&&args.accessRole!=="trusted")||!args.connection||(!args.mode&&!args.accessRole)))
  throw Error("SETUP_NON_INTERACTIVE_REQUIRES_PROJECT_MODE_CONNECTION");
const rl=interactive?createInterface({input,output}):null;
try{
  say("Mac MCP Gateway · Release 1 onboarding\n");
  say("No Desktop Commander hosted relay is used. Local MCP tools still run as your Mac user.\n");
  const accessRole=args.accessRole;
  const root=args.project||(accessRole==="trusted"?homedir():
    await rl!.question("Approved project directory (absolute path): "));
  if(accessRole!==undefined&&!["restricted","trusted"].includes(String(accessRole)))
    throw Error("SETUP_ACCESS_ROLE_INVALID");
  if(args["approve-trusted-developer"]&&accessRole!=="trusted")
    throw Error("SETUP_TRUSTED_APPROVAL_WITHOUT_ROLE");
  const mode=accessRole?
    (accessRole==="trusted"?"read-write":"read-only"):
    args.mode||(await rl!.question("Access (read-only [default] / read-write): "))||"read-only";
  if(accessRole&&args.mode&&args.mode!==mode)
    throw Error("SETUP_ACCESS_ROLE_MISMATCH");
  if(accessRole==="trusted"&&!args["approve-trusted-developer"])
    throw Error("SETUP_TRUSTED_DEVELOPER_APPROVAL_REQUIRED");
  const connection=args.connection||(await rl!.question("Remote connection (tunnel / https): "))||"tunnel";
  const port=Number(args.port||(interactive?((await rl!.question("Loopback port [18893]: "))||"18893"):"18893"));
  if(mode==="read-write"&&accessRole!=="trusted"&&!args["approve-write"]){
    const confirm=interactive?await rl!.question(
      "Read-write can change files in the approved workspace. Type WRITE to allow: "):"";
    if(confirm!=="WRITE")throw Error("SETUP_WRITE_NOT_APPROVED");
  }
  const selected=String(root).trim();
  const expanded=selected==="~"?homedir():
    selected.startsWith("~/")?path.join(homedir(),selected.slice(2)):selected;
  if(!path.isAbsolute(expanded))throw Error("SETUP_ROOT_ABSOLUTE_REQUIRED");
  const inputRoot=path.resolve(expanded);
  if((await lstat(inputRoot)).isSymbolicLink())throw Error("SETUP_ROOT_SYMLINK_DENIED");
  // macOS /var and /tmp may be aliases; normalize to the real canonical path.
  // v1 stays backward-compatible. Explicit access role is recorded in
  // schema v2; never silently escalate a legacy profile.
  const config=accessRole==="trusted"?
    {version:3,projectRoot:await realpath(inputRoot),mode,connection,port,
      accessRole,writeScope:"home-only"}:
    accessRole==="restricted"?
      {version:2,projectRoot:await realpath(inputRoot),mode,connection,port,accessRole}:
      {version:1,projectRoot:await realpath(inputRoot),mode,connection,port};
  const location=await saveSetupConfig(config,{file:defaultSetupPath(),replace:Boolean(args.replace)});
  say("\nSETUP_LOCAL_PROFILE_SAVED\n");
  say("Profile: "+location+" (private, owner-only)\n");
  say(accessRole==="trusted"?
    "Role: Trusted Home-Write Developer; Home file writes allowed, outside Home read-only for sandboxed Desktop Commander and its subprocesses (subject to OS permissions). This does not secure unrelated upstreams or external apps reached via IPC.\n":
    "Role: Restricted; Gateway read/write workspace checks active; arbitrary Shell and Git writes disabled.\n");
  say("Next 1. mac-mcp-gateway doctor\nNext 2. mac-mcp-gateway run\n");
  say("Next 3. Verify loopback health and tool discovery at http://127.0.0.1:"+port+"/mcp\n");
  if(connection==="tunnel"){
    say("\nTunnel (private, outbound-only):\n");
    say("Install/configure the supported tunnel-client after verifying workspace eligibility.\n");
    say("Use local MCP URL http://127.0.0.1:"+port+"/mcp; never paste tokens into setup logs.\n");
    say("Docs: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels\n");
    say("ChatGPT: Plugins > Add custom MCP server > Tunnel; discover and test real tools.\n");
    say("SETUP_REMOTE_PENDING: tunnel permission, identity, and tool call not yet validated.\n");
  }else{
    say("\nHTTPS (publicly reachable domain, including IPv6 when reachable):\n");
    say("DO NOT expose the loopback Gateway via Caddy until authentication is deployed and tested.\n");
    say("TLS, DNS AAAA, public endpoint reachability, OAuth and authorization remain separate gates.\n");
    say("ChatGPT: Plugins > Add custom MCP server > public HTTPS /mcp URL (after certification).\n");
    say("SETUP_REMOTE_PENDING: direct ingress not provisioned or authenticated.\n");
  }
  say("You may stop this local server with Ctrl+C; setup never starts public services.\n");
  if(appJSON)output.write(JSON.stringify({event:"SETUP_SAVE_OK"})+"\n");
}catch(error){
  const raw=String(errorCode(error)||errorMessage(error)||"UNKNOWN");
  // Preserve stable, non-sensitive *reason codes* from workspace admission.
  // Never emit the rejected absolute path or untrusted raw exception text.
  const mapped: Record<string,string>={"ROOT_TOO_BROAD":"SETUP_ROOT_TOO_BROAD",
    "ROOT_MUST_BE_CANONICAL":"SETUP_ROOT_MUST_BE_CANONICAL"};
  const code=mapped[raw]||(/^SETUP_[A-Z0-9_]+$/.test(raw)?raw:"SETUP_UNAVAILABLE");
  if(appJSON)output.write(JSON.stringify({event:"SETUP_SAVE_FAILED",code})+"\n");
  else output.write("SETUP_FAILED "+raw.slice(0,160)+"\n");
  process.exitCode=1;
}finally{rl?.close();}
