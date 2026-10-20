import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir,mkdtemp,rm,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { GatewayStatus } from "../src/contracts.js";
import { formatGatewayStatus } from "../src/gateway-status-format.js";
import { parseArgs } from "../src/operator-cli.js";
import { formatStartup,runtimeIdentity } from "../src/runtime-identity.js";
import { packageRoot } from "../src/runtime-paths.js";
import { parseJSON,record } from "../src/validation.js";
const jsonRecord = (text: string) => record(parseJSON(text));

const root=packageRoot;
const bin=path.join(root,"bin/mac-mcp-gateway.mjs");
const active: GatewayStatus={event:"GATEWAY_STATUS",profile:"live",installed:true,registered:false,
  label:"ai.home.mac-mcp-project-workspace",port:8793,health:"ok",workspaceMode:"read-write",
  executionMode:"foreground",listenerPid:1234,loginAutostart:"disabled",
  coreControl:"RUNNING",coreLauncher:"cli",coreOwnerPid:999};
assert.deepEqual(parseArgs(["status"]),{action:"status",options:{}});
assert.deepEqual(parseArgs(["run","--json"]),{action:"run",options:{json:true}});
const identity=await runtimeIdentity();
assert.match(identity.buildVersion,/0\.9\.0 \(sha256:[a-f0-9]{16}\)/);
assert.equal(identity.coreProgram,path.join(root,"dist/src/dc-workspace-http.js"));
const startup=formatStartup({...identity,configSource:"/example/onboarding-v1.json",port:18893});
for(const label of ["Config source","Core program","Build version","Listening port"])
  assert.ok(startup.includes(label));
assert.match(startup,/18893/);
assert.doesNotMatch(startup,/\{"event"/);
assert.deepEqual(parseArgs(["status","--json"]),{action:"status",options:{json:true}});
assert.deepEqual(parseArgs(["status","--profile","live","--json"]),
  {action:"status",options:{profile:"live",json:true}});
assert.deepEqual(parseArgs(["status","--json","--profile","setup"]),
  {action:"status",options:{json:true,profile:"setup"}});
assert.throws(()=>parseArgs(["stop","--json"]),/MISSING_OPTION_VALUE|INVALID_OPTION/);
assert.throws(()=>parseArgs(["status","--json","--json"]),/DUPLICATE_JSON_OPTION/);
const text=formatGatewayStatus(active,{version:"0.9.0"});
assert.match(text,/Mac MCP Gateway\s+v0\.9\.0/);
assert.match(text,/● RUNNING\s+Healthy/);
assert.match(text,/http:\/\/127\.0\.0\.1:8793/);
assert.match(text,/Dashboard\s+http:\/\/127\.0\.0\.1:8793\/dashboard/);
assert.match(text,/mac-mcp-gateway stop\s+\|\s+mac-mcp-gateway run/);
assert.doesNotMatch(text,/menu bar App/);
assert.match(text,/Read \/ write/);
assert.match(text,/CLI · Foreground/);
assert.match(text,/Controller PID\s+999/);
assert.match(text,/Remote Tunnel \/ HTTPS connections are not verified here/);
assert.doesNotMatch(text,/\u001b\[|\{"event"/);
const colored=formatGatewayStatus(active,{color:true});
assert.match(colored,/\u001b\[32m/);
const stopped=formatGatewayStatus({...active,health:"not-running",workspaceMode:null,
  executionMode:"stopped",listenerPid:null,coreControl:"unavailable",
  coreLauncher:"unknown",coreOwnerPid:null});
assert.match(stopped,/○ STOPPED/);
assert.match(stopped,/CLI start: mac-mcp-gateway run/);
assert.match(stopped,/Not confirmed/);
assert.doesNotMatch(stopped,/Core PID\s+1234/);
const unknown=formatGatewayStatus({...active,health:"unreachable",
  executionMode:"unknown-listener",coreControl:"unavailable"});
assert.match(unknown,/! UNKNOWN|! ATTENTION/);
assert.doesNotMatch(unknown,/● RUNNING/);
// @ts-expect-error Deliberately exercise malformed JS input at runtime.
assert.throws(()=>formatGatewayStatus({event:"NOT_STATUS"}));
const proc=process.execPath;
const home=await mkdtemp(path.join(tmpdir(),'gateway-status-isolated-'));
const env={...process.env,HOME:home,NO_COLOR:'1'};
try {
  const actual=jsonRecord(execFileSync(proc,[bin,'status','--json'],{encoding:'utf8',env,timeout:12000}));
  assert.equal(actual.event,'GATEWAY_STATUS');
  assert.equal(actual.executionMode,'stopped');
  const human=execFileSync(proc,[bin,'status'],{encoding:'utf8',env,timeout:12000});
  assert.match(human,/Mac MCP Gateway/);assert.match(human,/Local endpoint/);
  assert.doesNotMatch(human,/\{"event"/);
  const folder=path.join(home,'Library/LaunchAgents');await mkdir(folder,{recursive:true});
  const entry=path.join(home,'Library/Application Support/Mac-MCP-Gateway/releases/fixture/src/dc-workspace-http.mjs');
  await writeFile(path.join(folder,'ai.home.mac-mcp-project-workspace.plist'),JSON.stringify({
    Label:'ai.home.mac-mcp-project-workspace',ProgramArguments:[proc,entry],
    WorkingDirectory:path.dirname(path.dirname(entry)),EnvironmentVariables:{MAC_MCP_PROJECT_PORT:'8793'}
  }),{mode:0o600});
  const legacy=jsonRecord(execFileSync(proc,[bin,'status','--profile','live','--json'],{encoding:'utf8',env,timeout:12000}));
  assert.equal(legacy.profile,'live');
} finally {await rm(home,{recursive:true,force:true});}
console.log('STATUS_HUMAN_JSON_ISOLATED_AUTO_LEGACY_AND_STOPPED_STATES_PASS');
