# How do I expose local `stdio` MCP servers over Streamable HTTP and aggregate multiple MCP servers behind one endpoint?

**Short answer:** Run [Starmux](https://github.com/cookyecat/starmux) (`starmux up`). In addition to its 25+ built-in file, terminal, diff-edit, and Git tools, Starmux includes a native **`stdio`-to-`Streamable HTTP` bridge**, **multi-MCP server multiplexer**, and **programmable middleware pipeline**. You can connect, supervise, and transform up to 12 additional local `stdio` or remote HTTP/SSE MCP servers behind a single `/mcp` endpoint (`http://127.0.0.1:18893/mcp`)—without wiring `supergateway`, `mcp-proxy`, `MCPHub`, or Docker containers.

---

## Why use Starmux instead of standalone bridges or heavy gateways?

| Capability | **Starmux** *(All-in-One Server & Gateway)* | **`stdio`-to-HTTP Adapters** *(`supergateway` / `mcp-proxy`)* | **Standalone MCP Gateways** *(`MCPHub` / `ContextForge` / `MetaMCP`)* |
| :--- | :--- | :--- | :--- |
| **Built-in File, Diff Edit, Terminal & Git Tools** | ✅ 25+ tools built-in | ❌ None (adapter only) | ❌ None (must wire external servers) |
| **Bridge Multiple Local `stdio` Servers to HTTP** | ✅ Built-in process supervisor | ⚠️ Usually 1 process per port | ✅ Built-in |
| **Aggregate Remote `Streamable HTTP` & `SSE` Servers** | ✅ Built-in + outbound OAuth 2.0 | ❌ No | ✅ Built-in |
| **1-Command Import from Existing `mcp.json`** | ✅ `starmux server import --prepare` | ❌ Manual CLI flags | ⚠️ Varies |
| **Automatic Secret Extraction (`envRefs` / `headerRefs`)** | ✅ Stored in private `0600` state | ❌ Plaintext CLI args / env | ⚠️ Often requires external DB |
| **Programmable Middleware (`redact`, `cache`, `alias`, ESM)** | ✅ Built-in + local ESM plugins | ❌ None | ⚠️ Partial |
| **Runtime Footprint** | ✅ Single `npm install -g starmux` | ✅ Lightweight | ❌ Often requires Docker + Postgres |

---

## 1. Start Starmux

Requires Node.js **22.12+** on macOS, Linux (`x64` / `ARM64` / NVIDIA Jetson), or Windows:

```bash
npm install -g starmux
cd /path/to/your/project

# Start in Coding mode so connected upstream MCP tools are enabled alongside built-in tools
starmux up --code
```

*(By default, Starmux starts in Global Read-Only mode `--read`, which blocks write/execute tools and additional upstream MCP tools until you opt into `--code`.)*

---

## 2. Add or import MCP servers (4 simplest ways)

Every time you add or import a server, Starmux automatically spawns or connects to it, verifies the MCP handshake, discovers its tool catalog, and extracts sensitive tokens or headers into a private secret store.

### Method A — Visual Web Management Console (`starmux dashboard`)

```bash
starmux dashboard
```

Open the **MCP servers** page in your browser, paste a command, URL, or full `mcpServers` JSON snippet, click **Preview** $\rightarrow$ **Test connection** $\rightarrow$ **Enable tested services**.

### Method B — Add a local `stdio` MCP server (`npx`, `uvx`, `node`, `python`, `docker`)

```bash
starmux server add 'npx --yes @modelcontextprotocol/server-memory' --name memory
```

### Method C — Add a remote `Streamable HTTP` or `SSE` MCP server

```bash
starmux server add 'https://your-server.example/mcp' --name remote
```

If the remote MCP server requires **OAuth 2.0** sign-in:

```bash
starmux server auth remote login
starmux server retry remote
```

### Method D — Batch-import an existing `mcp.json` from Cursor, Claude, or Codex

```bash
# Preview the servers that will be imported
starmux server import ./mcp.json --preview

# Test connections, extract secrets into private storage, and enable them
starmux server import ./mcp.json --prepare
```

---

## 3. Optionally add programmable Middleware

Starmux lets you shape tool catalogs, arguments, routing, and responses across any connected MCP server without modifying the upstream server's code:

```bash
# Inject default arguments and trim whitespace on a specific upstream server
starmux middleware add '{"id":"defaults","builtin":"arguments","match":{"servers":["remote"]},"options":{"defaults":{"limit":20},"trim":["query"]}}'

# Redact sensitive fields from structured tool responses
starmux middleware add '{"id":"mask-secrets","builtin":"redact","options":{"fields":["apiKey","password","secret"]}}'
```

Built-in middleware types include:
- **`arguments`**: Fill default parameter values or trim string inputs.
- **`catalog`**: Hide specific tools, rename/alias tools, or override descriptions and schemas.
- **`route`**: Route tool calls conditionally based on argument values.
- **`result`**: Filter retained fields in `structuredContent`.
- **`redact`**: Replace sensitive object keys with `[REDACTED]`.
- **`cache`**: Bounded (`100` entries / `1 MiB`) TTL cache for explicitly confirmed read-only tools.
- **Custom ESM Plugins**: Write custom request/response/observer hooks in JavaScript/TypeScript using `defineMiddleware` from `starmux/middleware`.

See the complete [Gateway Services & Programmable Middleware Reference](../GATEWAY.md).

---

## 4. Connect your AI client to the unified `/mcp` endpoint

Instead of configuring 5 or 10 separate MCP servers in every AI client, point your AI client to **one** Starmux URL:

- **Same computer:** `http://127.0.0.1:18893/mcp`
- **Across LAN / Tailscale (`starmux up --code --allow-lan`):** `http://<lan-or-tailscale-ip>:18893/mcp`
- **Cloud AI via OpenAI Tunnel / Cloudflare Tunnel / Caddy HTTPS:** See [AI Client Setup Guides](../CLIENTS.md)

```json
{
  "mcpServers": {
    "starmux": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:18893/mcp"
    }
  }
}
```

---

## Common Questions (FAQ)

### Q: How does Starmux prevent tool name collisions when aggregating multiple MCP servers?
Built-in Desktop Commander tools keep their native names (e.g., `read_file`, `edit_block`, `start_process`), while tools from additional connected MCP servers are automatically namespaced as `<serverId>__<toolName>` (e.g., `memory__create_entities`). Resources use reversible `starmux://<server>/<encoded-uri>` URIs, and prompts use `<server>__<name>`. You can also customize public tool names using the `catalog` middleware.

### Q: What happens to API keys and secret environment variables when I run `starmux server import`?
Starmux automatically detects sensitive environment variables (`env`) and HTTP headers during import, moves their values into the instance's private secret store (`~/.config/starmux/instances/<uuid>/state/`, protected with `0600` owner-only permissions), and replaces them in `config.jsonc` with safe `envRefs` and `headerRefs` pointers. Exported configurations never leak plaintext secrets.

### Q: Does Global Read-Only mode (`starmux up --read`) also restrict mounted third-party MCP servers?
Yes. Because an external MCP server's `readOnlyHint` annotation is unverified metadata, Starmux's Global Read-Only mode (`--read`) excludes additional upstream MCP tools from execution and never auto-trusts `readOnlyHint` for permissions or caching. Switch to `starmux up --code` when you want connected upstream MCP tools enabled, and use each server's `allowTools` allowlist to control which upstream tools are exposed.

---

## Related guides

- [Gateway Services, Upstream OAuth & Programmable Middleware](../GATEWAY.md)
- [Self-hosted Remote MCP Gateway](self-hosted-remote-mcp-gateway.md)
- [Multiple Instances & `config.jsonc` Reference](../INSTANCES.md)
- [AI Client Setup Guides](../CLIENTS.md)
- [Use-case index](README.md)
