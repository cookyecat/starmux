import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {windows,childEnvKeys} from "./platform.js";
import type { Tool,ToolInvocation } from "./contracts.js";
import { toolResult } from "./mcp-results.js";
import { desktopCommanderEntry } from "./runtime-paths.js";
// Embedded Desktop Commander transport. The dispatcher authorizes every invocation.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { access,constants } from "node:fs/promises";
import { sandboxedDesktopSpawn } from "./home-write-sandbox.js";

const DC_BIN = desktopCommanderEntry;
// The embedded upstream must not launch browser onboarding on every Gateway
// connection or after test/dev child restarts. Supported upstream CLI option.
export function desktopCommanderSpawnArgs(binary=DC_BIN) {
  return [binary, "--no-onboarding"];
}
const EXPOSED_LOCAL_TOOLS = Object.freeze(["read_file"]);

function sanitizedEnv() {
  const allow = childEnvKeys;
  const env: Record<string,string> = {};
  for (const key of allow) if (process.env[key]) env[key] = process.env[key]!;
  // no .zshrc loading; no ALIYUN_ACCESSKEY*, OPENAI_API_KEY, or other inherited secrets
  return env;
}
function assertNoCredentials(env: Record<string,string>) {
  for (const key of Object.keys(env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD|AUTH|PROXY/i.test(key))
      throw new Error("Forbidden child-process environment key");
  }
}

export class LocalDesktopReadProbe {
  #client: Client|null = null;
  #transport:StdioClientTransport|null=null;
  #toolNames: string[] = [];
  #upstreamCatalog: Tool[] = [];
  #writeScope: string;

  constructor({writeScope="unrestricted"}={}){
    if(!["unrestricted","home-only"].includes(writeScope))
      throw Error("INVALID_DC_WRITE_SCOPE");
    this.#writeScope=writeScope;
  }

  async connect() {
    if (this.#client) throw new Error("Already connected");
    await access(DC_BIN, constants.R_OK);
    const env = sanitizedEnv();
    assertNoCredentials(env);
    const executable=this.#writeScope==="home-only"?
      await sandboxedDesktopSpawn({
        home:env.HOME, nodeBinary:process.execPath,
        entryArgs:desktopCommanderSpawnArgs()
      }):
      {command:process.execPath,args:desktopCommanderSpawnArgs()};
    // The sandbox follows DC and every shell/process launched from DC.
    // A failed sandbox launch must never fall back to unrestricted native DC.
    const transport = new StdioClientTransport({
      ...executable,env,stderr:"pipe"
    });
    const client = new Client({ name: "starmux-local-read-probe", version: "0.1.0" },
                              { capabilities: {} });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      const names = tools.tools.map(x => x.name);
      if (!names.includes("read_file")) throw new Error("Upstream read_file missing");
      if (new Set(names).size !== names.length || names.some(name => typeof name !== "string"))
        throw new Error("Invalid upstream catalog");
      this.#upstreamCatalog = structuredClone(tools.tools);
      this.#toolNames = names.filter(name => EXPOSED_LOCAL_TOOLS.includes(name));
      this.#client = client;
      this.#transport=transport;
    } catch (e) {
      await client.close().catch(() => {});
      throw e;
    }
  }

  get allowedToolNames() { return Object.freeze([...this.#toolNames]); }
  get upstreamCatalog() { return structuredClone(this.#upstreamCatalog); }

  // MCP Apps advertised by upstream tool _meta must remain available via
  // resources/list and resources/read. This is static upstream-owned UI, not
  // a Gateway reimplementation of Desktop Commander's app.
  async listNativeResources() {
    if (!this.#client) throw new Error("Not connected");
    return (await this.#client.listResources()).resources || [];
  }
  async readNativeResource(uri: string) {
    if (!this.#client) throw new Error("Not connected");
    return this.#client.readResource({uri});
  }
  async listNativeResourceTemplates() {
    if (!this.#client) throw new Error("Not connected");
    return (await this.#client.listResourceTemplates()).resourceTemplates || [];
  }

  async forwardWorkspaceInvocation(invocation: ToolInvocation) {
    if (!this.#client) throw new Error("Not connected");
    if (!invocation || !this.#upstreamCatalog.some(t=>t.name===invocation.name))
      throw new Error("Unknown upstream tool");
    return toolResult(await this.#client.callTool(invocation));
  }

  async close() {
    const client = this.#client;
    const pid=this.#transport?.pid;this.#transport=null;
    this.#client = null;
    this.#upstreamCatalog = [];
    // Only the upstream PID spawned by this instance is eligible for tree cleanup.
    if(windows&&pid)await promisify(execFile)("taskkill.exe",["/PID",String(pid),"/T","/F"],{windowsHide:true,timeout:8000}).catch(()=>{});
    if (client) await client.close().catch(() => {});
  }
}
