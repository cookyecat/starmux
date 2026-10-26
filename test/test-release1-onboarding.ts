import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod,lstat,mkdir,mkdtemp,readFile,realpath,rm,writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultSetupPath } from "../src/release1-onboarding.js";
import { packageRoot } from "../src/runtime-paths.js";
import { parseJSON,record } from "../src/validation.js";
const jsonRecord = (text: string) => record(parseJSON(text));

const repo=process.env.GATEWAY_TEST_PACKAGE_ROOT||packageRoot;
const packageVersion=jsonRecord(await readFile(path.join(repo,"package.json"),"utf8")).version;
assert.equal(typeof packageVersion,"string");
const home=await realpath(await mkdtemp(path.join(tmpdir(),"mac-mcp-release1-newuser-")));
const project=path.join(home,"Projects","safe-work");
await mkdir(project,{recursive:true});
await writeFile(path.join(project,"README.md"),"ONBOARDING_REAL_DC_FIXTURE\n");
const configFile=defaultSetupPath(home);
const baseEnv={PATH:process.env.PATH||"/usr/bin:/bin",HOME:home,LANG:"C",
  MAC_MCP_SETUP_FILE:configFile};
const binary=path.join(repo,"dist","src","cli","mac-mcp-gateway.js");
const wizard=path.join(repo,"bin","setup-wizard.mjs");
function command(file: string,args: string[],change: NodeJS.ProcessEnv={}){
  const p=spawn(process.execPath,[file,...args],{
    cwd:home,env:{...baseEnv,...change},stdio:["ignore","pipe","pipe"]});
  let stdout="",stderr="";
  p.stdout.on("data",b=>stdout+=b);
  p.stderr.on("data",b=>stderr+=b);
  return {p,done:once(p,"exit").then(([code])=>({code,stdout,stderr}))};
}
const getPort=()=>new Promise<number>((resolve,reject)=>{
 const sock=createServer().once("error",reject).listen(0,"127.0.0.1",()=>{
  const address=sock.address();assert(address&&typeof address!=="string");
 const p=address.port;sock.close(e=>e?reject(e):resolve(p));
 });
});
let service;
try{
  const port=await getPort();
  const choices=["--project",project,"--mode","read-only","--connection","tunnel",
    "--port",String(port)];
  let a=await command(wizard,choices).done;
  assert.equal(a.code,0,a.stdout+"\n"+a.stderr);
  assert.match(a.stdout,/SETUP_LOCAL_PROFILE_SAVED/);
  assert.match(a.stdout,/SETUP_REMOTE_PENDING/);
  assert.doesNotMatch(a.stdout,/sk-proj-|sk-/,"no secret in onboarding guidance");
  const st=await lstat(configFile),parent=await lstat(path.dirname(configFile));
  assert.equal(st.mode&0o777,0o600);
  assert.equal(parent.mode&0o777,0o700);
  const profile=jsonRecord(await readFile(configFile,"utf8"));
  assert.deepEqual(profile,{version:1,projectRoot:await realpath(project),mode:"read-only",
    connection:"tunnel",port});
  const repeated=await command(wizard,choices).done;
  assert.equal(repeated.code,1);
  assert.match(repeated.stdout,/SETUP_EXISTING_CONFIG_PROTECTED/);
  const badWrite=await command(wizard,[...choices,"--replace",
    "--approve-write","--mode","read-write"]).done;
  assert.equal(badWrite.code,1,"duplicate CLI options must be denied");
  const missingApproval=await command(wizard,["--project",project,"--mode","read-write",
    "--connection","tunnel","--port",String(port),"--replace"]).done;
  assert.equal(missingApproval.code,1);
  assert.match(missingApproval.stdout,/SETUP_WRITE_NOT_APPROVED/);
  const doc=await command(binary,["doctor-setup"]).done;
  assert.equal(doc.code,0,doc.stderr+"\n"+doc.stdout);
  assert.equal(jsonRecord(doc.stdout.trim()).desktopCommanderTools,25);
  console.log("RELEASE1_NEWUSER_PRIVATE_SETUP_AND_REAL_DC_DOCTOR_PASS");
  // A direct HTTPS preference must not cause a public listener or skip identity.
  const https=await command(wizard,["--project",project,"--mode","read-only",
    "--connection","https","--port",String(port),"--replace"]).done;
  assert.equal(https.code,0,https.stdout);
  assert.match(https.stdout,/SETUP_REMOTE_PENDING/);
  assert.match(https.stdout,/authentication is deployed/);
  assert.equal((await readFile(configFile,"utf8")).includes("https"),true);
  service=command(binary,["start-setup"]);
  let listen=false;
  for(let t=0;t<100;t++){
    if(service.p.exitCode!==null)break;
    try{
      const h=await fetch("http://127.0.0.1:"+port+"/healthz",
        {signal:AbortSignal.timeout(500)});
      if(h.ok){listen=true;break;}
    }catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(listen,true,"Gateway should only listen on local endpoint");
  const duplicate=await command(binary,["run","--profile","setup"]).done;
  assert.equal(duplicate.code,1,duplicate.stdout+" / "+duplicate.stderr);
  assert.match(duplicate.stderr,/CORE_ALREADY_RUNNING/);
  console.log("COMMUNITY_SETUP_UNIQUE_CORE_DUPLICATE_DENIED_PASS");
  const wrongPort=port===65535?port-1:port+1;
  const override=await command(binary,["run","--profile","setup",
    "--port",String(wrongPort)]).done;
  assert.equal(override.code,1);
  assert.match(override.stderr,/SETUP_PORT_OVERRIDE_DENIED_RECONFIGURE/);
  console.log("COMMUNITY_SETUP_PORT_OVERRIDE_FAIL_CLOSED_PASS");
  const actual=await command(binary,["status","--json","--profile","auto"]).done;
  assert.equal(actual.code,0,actual.stderr);
  const shared=jsonRecord(actual.stdout.trim());
  assert.equal(shared.profile,"setup");
  assert.equal(shared.port,port);
  assert.equal(shared.executionMode,"foreground");
  assert.equal(shared.coreLauncher,"cli");
  assert.equal(shared.coreControl,"RUNNING");
  console.log("COMMUNITY_FRESH_SETUP_CLI_STATUS_AUTHENTICATED_OWNER_PASS");
  async function rpc(method: string,params={}){
    const r=await fetch("http://127.0.0.1:"+port+"/mcp",{
      method:"POST",headers:{"content-type":"application/json",
        accept:"application/json, text/event-stream"},
      body:JSON.stringify({jsonrpc:"2.0",id:4,method,params})});
    assert.equal(r.status,200);
    return record(record(await r.json()).result);
  }
  const permissionResponse=await fetch("http://127.0.0.1:"+port+"/privacy/status",{
    headers:{accept:"application/json"}
  });
  assert.equal(permissionResponse.status,200);
  assert.match(permissionResponse.headers.get("cache-control")??"",/no-store/);
  const current=record(await permissionResponse.json());
  assert.ok(Array.isArray(current.checks));
  const checks: Record<string,unknown>[] = current.checks.map((x: unknown)=>record(x));
  assert.equal(current.context,"gateway-process");
  assert.equal(current.method,"open-directory-without-reading-entries");
  assert.equal(checks.length,6);
  assert.equal(new Set(checks.map((x: Record<string,unknown>)=>x.id)).size,6);
  assert(checks.every((x: Record<string,unknown>)=>["READ_OK","OS_DENIED","MISSING","INCONCLUSIVE"].includes(String(x.state))));
  assert(!JSON.stringify(current).includes(home));
  assert(!JSON.stringify(current).includes("Library/Application Support"));
  const deniedOrigin=await fetch("http://127.0.0.1:"+port+"/privacy/status",{
    headers:{origin:"https://not-local.example"}
  });
  assert.equal(deniedOrigin.status,403);
  console.log("CURRENT_CORE_READ_ONLY_FDA_CAPABILITY_NO_CONTENTS_OR_ORIGIN_LEAK_PASS");
  const listed=(await rpc("tools/list")).tools;
  assert.ok(Array.isArray(listed));
  const items=listed.map((x: unknown)=>record(x));
  assert.equal(items.length,27); // Local onboarding enables the optional disk-inventory tool.
  assert.ok(items.some((x: Record<string,unknown>)=>x.name==="start_process"));
  const health=await rpc("tools/call",{name:"health_check",arguments:{}});
  assert.notEqual(health.isError,true);
  const read=await rpc("tools/call",{name:"read_file",arguments:{path:"README.md"}});
  assert.match(JSON.stringify(read),/ONBOARDING_REAL_DC_FIXTURE/);
  const forbidden=await rpc("tools/call",{name:"write_file",
    arguments:{path:"README.md",content:"unauthorized"}});
  assert.equal(forbidden.isError,true);
  assert.equal(await readFile(path.join(project,"README.md"),"utf8"),
    "ONBOARDING_REAL_DC_FIXTURE\n");
  const localProof=await command(path.join(repo,"bin","verify-setup.mjs"),[]).done;
  assert.equal(localProof.code,0,localProof.stderr+"\n"+localProof.stdout);
  const proof=jsonRecord(localProof.stdout.trim());
  assert.equal(proof.remoteClientVerified,false);
  assert.equal(proof.toolCount,27);
  console.log("RELEASE1_VERIFY_LOCAL_REAL_READ_NO_FALSE_REMOTE_CLAIM_PASS");
  console.log("RELEASE1_HTTPS_MODE_STAYS_LOOPBACK_REAL_27_TOOLS_AND_READ_DENY_PASS");
  await chmod(configFile,0o644);
  const insecure=await command(binary,["doctor-setup"]).done;
  assert.equal(insecure.code,1);
  assert.match(insecure.stderr,/SETUP_CONFIG_FILE_UNSAFE/);
  await chmod(configFile,0o600);
  console.log("RELEASE1_REJECTS_WORLD_READABLE_ONBOARDING_PROFILE_PASS");
  const globalStop=await command(binary,["stop","--profile","setup"]).done;
  assert.equal(globalStop.code,0,globalStop.stderr);
  assert.equal(jsonRecord(globalStop.stdout.trim()).result,"STOPPED");
  await service.done;
  const statusAfter=await command(binary,["status","--json","--profile","auto"]).done;
  assert.equal(statusAfter.code,0,statusAfter.stderr);
  assert.equal(jsonRecord(statusAfter.stdout.trim()).executionMode,"stopped");
  console.log("COMMUNITY_SETUP_REMOTE_CLI_GLOBAL_STOP_AND_PORT_RELEASE_PASS");

  // Reproduce the documented trusted setup with no --project: the default
  // directory is Home, which doctor and runtime must both accept.
  const trusted=await command(binary,["setup","--access-role","trusted","--connection","tunnel",
    "--approve-trusted-developer","--port",String(port),"--replace"]).done;
  assert.equal(trusted.code,0,trusted.stdout+trusted.stderr);
  assert.equal(jsonRecord(await readFile(configFile,"utf8")).projectRoot,home);
  const trustedDoctor=await command(binary,["doctor"]).done;
  assert.equal(trustedDoctor.code,0,trustedDoctor.stdout+trustedDoctor.stderr);
  assert.equal(jsonRecord(trustedDoctor.stdout.trim()).result,"PASS");
  const restrictedHome=await command(wizard,["--access-role","restricted","--project",home,
    "--connection","tunnel","--port",String(port),"--replace"]).done;
  assert.equal(restrictedHome.code,1);
  assert.match(restrictedHome.stdout,/ROOT_TOO_BROAD/);
  // An old installation must not override a newly saved configuration.
  const legacyFolder=path.join(home,"Library","LaunchAgents");
  await mkdir(legacyFolder,{recursive:true});
  const legacyFile=path.join(legacyFolder,"ai.home.mac-mcp-project-workspace.plist");
  await writeFile(legacyFile,"invalid legacy plist must not override setup",{mode:0o600});
  service=command(binary,["run"]);
  let trustedReady=false;
  for(let t=0;t<100;t++){
    if(service.p.exitCode!==null)break;
    try{
      if((await fetch("http://127.0.0.1:"+port+"/healthz",
        {signal:AbortSignal.timeout(500)})).ok){trustedReady=true;break;}
    }catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(trustedReady,true,"Trusted Home Core must start");
  const running=await command(binary,["status","--json"]).done;
  const runningStatus=jsonRecord(running.stdout.trim());
  assert.equal(runningStatus.health,"ok");
  assert.equal(runningStatus.profile,"setup");
  assert.equal(runningStatus.coreControl,"RUNNING");
  assert.equal(runningStatus.writeScope,"home-only");
  const human=await command(binary,["status","--profile","setup"]).done;
  assert.match(human.stdout,/RUNNING/);
  assert.doesNotMatch(human.stdout,/STOPPED/);
  const target=path.join(home,"coding-smoke.txt");
  const write=await rpc("tools/call",{name:"write_file",arguments:{path:target,content:"TRUSTED_HOME_WRITE_PASS"}});
  assert.notEqual(write.isError,true,JSON.stringify(write));
  assert.equal(await readFile(target,"utf8"),"TRUSTED_HOME_WRITE_PASS");
  const shell=await rpc("tools/call",{name:"start_process",
    arguments:{command:"/usr/bin/printf TRUSTED_SHELL_PASS",shell:"/bin/sh",timeout_ms:3000}});
  assert.notEqual(shell.isError,true,JSON.stringify(shell));
  assert.match(JSON.stringify(shell),/TRUSTED_SHELL_PASS/);
  assert.equal((await command(binary,["verify"]).done).code,0);
  assert.equal((await command(binary,["stop"]).done).code,0);
  const completed=await service.done;
  assert.match(completed.stdout,/Config source\s+/);
  assert.ok(completed.stdout.includes(configFile));
  assert.ok(completed.stdout.includes(path.join(await realpath(repo),"dist/src/dc-workspace-http.js")));
  const displayedBuild=completed.stdout.match(/Build version\s+(\S+) \(sha256:[a-f0-9]{16}\)/);
  assert.ok(displayedBuild);assert.equal(displayedBuild[1],packageVersion);
  const stoppedProof=await command(path.join(repo,"bin","verify-setup.mjs"),[]).done;
  assert.equal(stoppedProof.code,1);
  assert.match(stoppedProof.stderr,/mac-mcp-gateway run/);
  console.log("TRUSTED_HOME_SETUP_DOCTOR_RUNTIME_WRITE_SHELL_STATUS_STOP_PASS");
  // Explicit legacy configuration may retain its port/settings, but must never
  // launch the legacy ProgramArguments or depend on their old working directory.
  const oldEntry=path.join(home,"Library/Application Support/Mac-MCP-Gateway/releases/old/src/dc-workspace-http.mjs");
  await writeFile(legacyFile,JSON.stringify({
    Label:"ai.home.mac-mcp-project-workspace",
    ProgramArguments:["/nonexistent/old/node",oldEntry],
    WorkingDirectory:path.dirname(path.dirname(oldEntry)),
    EnvironmentVariables:{MAC_MCP_PROJECT_PORT:"8793",MAC_MCP_PROJECT_ROOT:project,
      MAC_MCP_WORKSPACE_MODE:"read-only",MAC_MCP_DEV_COMMANDS:"presets"}
  }),{mode:0o600});
  service=command(binary,["run","--profile","live","--port",String(port),"--json"]);
  let legacyReady=false;
  for(let t=0;t<100;t++){
    if(service.p.exitCode!==null)break;
    try{
      if((await fetch("http://127.0.0.1:"+port+"/healthz",
        {signal:AbortSignal.timeout(500)})).ok){legacyReady=true;break;}
    }catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(legacyReady,true,"Legacy settings must run the current CLI's Core");
  service.p.kill("SIGTERM");
  const legacyRun=await service.done;
  const startLine=legacyRun.stdout.split("\n").find(line=>line.includes("GATEWAY_FOREGROUND_START"));
  assert.ok(startLine);
  const start=jsonRecord(startLine);
  assert.equal(start.configSource,legacyFile);
  assert.equal(start.coreProgram,path.join(await realpath(repo),"dist/src/dc-workspace-http.js"));
  assert.equal(start.port,port);
  const legacyBuild=String(start.buildVersion).match(/^(\S+) \(sha256:[a-f0-9]{16}\)$/);
  assert.ok(legacyBuild);assert.equal(legacyBuild[1],packageVersion);
  console.log("LEGACY_CONFIGURATION_RUNS_CURRENT_CORE_WITH_VISIBLE_IDENTITY_PASS");
}finally{
  if(service){
    service.p.kill("SIGTERM");
    await Promise.race([service.done,new Promise(r=>setTimeout(r,2500))]);
    if(service.p.exitCode===null)service.p.kill("SIGKILL");
  }
  await rm(home,{recursive:true,force:true});
}
