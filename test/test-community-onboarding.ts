import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp,readFile,rm,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { packageRoot } from "../src/runtime-paths.js";
import { parseJSON,record } from "../src/validation.js";
const jsonRecord = (text: string) => record(parseJSON(text));
const repo=packageRoot;
const pkg=jsonRecord(await readFile(path.join(repo,"package.json"),"utf8"));
const lock=jsonRecord(await readFile(path.join(repo,"package-lock.json"),"utf8"));
assert.equal(record(pkg.dependencies)["@wonderwhy-er/desktop-commander"],"0.3.0");
assert.equal(record(record(record(lock.packages)[""]).dependencies)["@wonderwhy-er/desktop-commander"],"0.3.0");
assert.ok(record(pkg.devDependencies).typescript);
assert.equal(record(record(lock.packages)["node_modules/@wonderwhy-er/desktop-commander"]).version,"0.3.0");
console.log("RELEASE_LOCK_METADATA_PASS");
const root=await mkdtemp(path.join(repo,"test","fixtures",".community-"));
const home=await mkdtemp(path.join(tmpdir(),"gateway-doctor-home-"));
const entry=path.join(repo,"bin","mac-mcp-gateway.mjs");
const env={HOME:home,PATH:process.env.PATH,LANG:"C",MAC_MCP_PROJECT_PORT:"0"};
const spawnCli=(args: string[],changes: NodeJS.ProcessEnv={})=>spawn(process.execPath,[entry,...args],{
 cwd:repo,env:{...env,...changes},stdio:["ignore","pipe","pipe"]});
async function doctor(changes: NodeJS.ProcessEnv){
 const p=spawnCli(["doctor"],changes);let stdout="";
 p.stdout.on("data",x=>stdout+=x);const [code]=await once(p,"exit");
 return {code,json:jsonRecord(stdout.trim())};
}
try{
 await writeFile(path.join(root,"README.md"),"COMMUNITY_FIXTURE\n");
 const missing=await doctor({});
 assert.equal(missing.code,1);
 assert.equal(missing.json.reason,"MAC_MCP_PROJECT_ROOT_REQUIRED");
 const restricted=await doctor({MAC_MCP_PROJECT_ROOT:root,
  MAC_MCP_DEV_COMMANDS:"trusted-project"});
 assert.equal(restricted.code,1);
 const ready=await doctor({MAC_MCP_PROJECT_ROOT:root});
 assert.equal(ready.code,0,JSON.stringify(ready.json));assert.equal(ready.json.desktopCommanderTools,25);
 console.log("RELEASE_DOCTOR_REAL_DC_AND_NEGATIVE_PASS");
 // Direct raw bootstrap is intentionally blocked; real managed local MCP
 // read/write-denial is covered by test-release1-onboarding.mjs.
 const raw=spawnCli(["start-raw"],{MAC_MCP_PROJECT_ROOT:root});
 let message="";
 raw.stderr.on("data",chunk=>message+=String(chunk));
 const [rawCode]=await once(raw,"exit");
 assert.equal(rawCode,2);
 assert.match(message,/LEGACY_DIRECT_BOOTSTRAP_DISABLED_USE_SETUP/);
 console.log("COMMUNITY_LEGACY_UNSUPERVISED_BOOTSTRAP_DENIED_PASS");
}finally{
 await rm(root,{recursive:true,force:true});
 await rm(home,{recursive:true,force:true});
}
