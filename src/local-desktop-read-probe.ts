import type { Tool,ToolInvocation } from "./contracts.js";
import { toolResult } from "./mcp-results.js";
import { desktopCommanderEntry,fixtureRoot,packageRoot } from "./runtime-paths.js";
import { currentUid,errorCode } from "./validation.js";
// Desktop Commander stdio MCP client for fixture tests and the private P1 bridge.
// NOT imported into public P0 src/server.mjs; only explicitly approved operations.
// This adapter exposes no arbitrary callTool capability.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { access,constants,lstat,readFile } from "node:fs/promises";
import path from "node:path";
import { sandboxedDesktopSpawn } from "./home-write-sandbox.js";
import { resolveScopedRead } from "./read-scope.js";

const PROJECT=packageRoot;
const FIXTURES = fixtureRoot;
const DC_BIN = desktopCommanderEntry;
// The embedded upstream must not launch browser onboarding on every Gateway
// connection or after test/dev child restarts. Supported upstream CLI option.
export function desktopCommanderSpawnArgs(binary=DC_BIN) {
  return [binary, "--no-onboarding"];
}
const EXPOSED_LOCAL_TOOLS = Object.freeze(["read_file"]);
const MAX_READ = 4096;
const MAX_PROJECT_README_BYTES = 16384; // Project README may grow; synthetic fixture limit remains 4096.

function sanitizedEnv() {
  const allow = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "USER", "LOGNAME"];
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
    const client = new Client({ name: "mac-mcp-local-read-probe", version: "0.1.0" },
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

  async callApprovedRead(pathToFile: string) {
    if (!this.#client) throw new Error("Not connected");
    const { absolutePath } = await resolveScopedRead({
      root: FIXTURES, relativePath: pathToFile,
      allowedFiles: ["p1-fixture.txt", "dc-bridge-canary.txt"], maxBytes: MAX_READ
    });
    return toolResult(await this.#client.callTool({name: "read_file", arguments: {path: absolutePath}}));
  }

  async callApprovedProjectRead() {
    if (!this.#client) throw new Error("Not connected");
    const candidate = path.join(PROJECT, "README.md");
    const st = await lstat(candidate);
    if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 ||
        st.uid !== currentUid() || st.size > MAX_PROJECT_README_BYTES)
      throw new Error("Project file failed read approval");
    return toolResult(await this.#client.callTool({name:"read_file",arguments:{path:candidate}}));
  }

  async callApprovedCanaryWrite(content: string) {
    if (!this.#client) throw new Error("Not connected");
    if (typeof content !== "string" || Buffer.byteLength(content) > 256)
      throw new Error("Canary content exceeds approved bound");
    const root = await lstat(FIXTURES);
    if (!root.isDirectory() || root.isSymbolicLink() ||
        root.uid !== currentUid()) throw new Error("Fixture directory denied");
    const candidate = path.join(FIXTURES, "dc-bridge-canary.txt");
    const existing = await lstat(candidate).catch(e => {
      if (errorCode(e) === "ENOENT") return null;
      throw e;
    });
    if (existing && (!existing.isFile() || existing.isSymbolicLink() ||
        existing.nlink !== 1 || existing.uid !== currentUid()))
      throw new Error("Canary target denied");
    return toolResult(await this.#client.callTool({name:"write_file",arguments:{
      path:candidate,content,mode:"rewrite"
    }}));
  }

  async callApprovedSystemName() {
    if (!this.#client) throw new Error("Not connected");
    return toolResult(await this.#client.callTool({name:"start_process",arguments:{
      command:"/usr/bin/uname -s",timeout_ms:3000
    }}));
  }

  async readFixture(basename = "p1-fixture.txt") {
    if (!this.#client) throw new Error("Not connected");
    if (basename !== "p1-fixture.txt") throw new Error("Only the synthetic fixture is approved");
    const { absolutePath: candidate } = await resolveScopedRead({
      root: FIXTURES, relativePath: basename,
      allowedFiles: ["p1-fixture.txt"], maxBytes: MAX_READ
    });
    const expected = await readFile(candidate, "utf8");
    const result = toolResult(await this.#client.callTool({
      name: "read_file",
      arguments: { path: candidate }
    }));
    if (result.isError) throw new Error("Upstream read_file returned error");
    const combined = (result.content || []).filter(x => x.type === "text").map(x => x.text).join("\n");
    if (!combined.includes(expected.trim())) {
      throw new Error("Unexpected tool result; refusing to display private content");
    }
    return { ok: true, fixture: basename, bytes: Buffer.byteLength(expected),
             allowedToolNames: this.allowedToolNames };
  }

  async close() {
    const client = this.#client;
    this.#client = null;
    this.#upstreamCatalog = [];
    if (client) await client.close().catch(() => {});
  }
}

// No general-purpose remote forwarding. All interactions live inside this
// explicitly opted-in local test, not the public HTTP MCP request handlers.
