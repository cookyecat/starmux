<div align="center">

# Starmux MCP Gateway

### Give cloud AI clients secure access to your local machine.

**Self-hosted MCP Gateway · Built-in File, Shell & Git Tools · macOS Menu Bar App · MIT**

[Why Starmux?](#why-starmux) · [Quick Start](#quick-start) · [Connecting AI Clients](#connecting-ai-clients) · [macOS App](#native-macos-app) · [Documentation](docs/README.md)

</div>

---

## Why Starmux?

Cloud AI assistants (like **ChatGPT Web**, **Claude**, **Codex**, or **WorkBuddy**) are powerful, but they are trapped in the cloud—isolated from your local codebases, terminal, and development environment.

**Starmux** (`Star` topology + `Multiplexer`) is a self-hosted MCP gateway that connects remote AI clients to the real tools on your own computers over Direct HTTPS or a Secure Tunnel:

<div align="center">
  <img src="docs/assets/starmux-architecture.svg" width="100%" alt="Starmux architecture: Many AI clients connecting to self-hosted computers via Direct HTTPS or Secure MCP Tunnel" />
</div>

- **Batteries-Included Workspace Tools:** Powered by a built-in [Desktop Commander](https://github.com/wonderwhy-er/DesktopCommanderMCP) engine (installed automatically via npm). Out of the box, your AI can read/write files, search code, run Shell commands, and manage Git.
- **Code on Any Host (macOS, Linux, Windows & Edge Devices):** Many AI clients (like **ChatGPT Desktop** or **WorkBuddy**) have no native Linux or ARM64 client. Because Starmux runs anywhere **Node.js 22.12+** runs—including **macOS**, **Linux (`x64` / `arm64`)**, **NVIDIA Jetson**, headless servers, and **Windows**—you can use your favorite AI client on your main computer or browser to develop directly on any target machine.
- **Safe by Default:** Starts in strict **Read-Only** mode (`starmux up`). Explicitly opt into **Coding Mode** (`starmux up --code`) only when you want AI to edit files or run terminal commands.
- **Your Network, Your Keys:** No vendor-hosted relay required. Protect your gateway with Bearer **API Keys**, browser-based **OAuth**, or your existing **Tunnel / Reverse Proxy** access controls. Revoke access instantly at any time.

---

## Quick Start

### 1. Install

Requires **Node.js 22.12+**.

```bash
npm install -g starmux
```

### 2. Start in your project directory

```bash
cd /path/to/your/project

# Option A: Safe read-only mode (default — inspect files & code)
starmux up

# Option B: Full coding mode (edit files, run Shell & Git)
starmux up --code
```

Starmux initializes itself and runs in the background on port `18893` (coding mode asks for confirmation the first time):

```text
● Starmux is running
  Listen          http://127.0.0.1:18893/mcp  (this computer only)
  Workspace       /path/to/your/project
  Mode            Read-only  (run 'starmux up --code' to enable edits & shell)
  Auth            None (no token required)
  Runtime         Background · continues after this terminal closes

Connect an AI client (MCP settings)
  Transport       Streamable HTTP
  URL (Local)     http://127.0.0.1:18893/mcp  (AI client on this computer)
  URL (Remote)    https://<your-domain-or-tunnel>/mcp  (via protected HTTPS proxy or tunnel -> 127.0.0.1:18893)
  Authentication  None  (optional Bearer API key: starmux auth key "My AI Client")

Commands
  Verify          starmux verify
  Auth & keys     starmux auth
  Dashboard       starmux dashboard  (view & copy settings in browser)
  Logs            starmux logs -f
  Stop            starmux down
```

### 3. Add Starmux to your AI client

Need a Bearer API key for remote access? Generate one first (optional for local use):

```bash
starmux auth key "My AI Client"
```

Depending on your AI client, configure the MCP server using either **Form UI** or **JSON**:

#### Option A — AI clients with a Form UI (e.g., ChatGPT Web, Claude)

Copy the fields directly from `starmux up` (or open `starmux dashboard` in your browser):

| MCP Client Field | Value to Fill In |
| :--- | :--- |
| **Transport** | `Streamable HTTP` |
| **URL (Local)** | `http://127.0.0.1:18893/mcp` *(when the AI client is on this same computer)* |
| **URL (Remote)** | `https://<your-domain-or-tunnel>/mcp` *(forwarded to `127.0.0.1:18893` via Caddy or Tunnel)* |
| **Authentication** | *Optional:* `None` *(default)*, `Bearer API key` (`Authorization: Bearer <YOUR_API_KEY>`), or `OAuth` |

#### Option B — AI clients with JSON config (e.g., WorkBuddy, Cursor, Windsurf)

Paste one of the blocks below into your client's `mcp.json` / `mcpServers` settings.

**Without API key (default for local `127.0.0.1` or when your tunnel handles login — no `headers` needed):**

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

**With Bearer API key (`headers` is optional — include it after running `starmux auth key`):**

```json
{
  "mcpServers": {
    "starmux": {
      "type": "streamable-http",
      "url": "https://<your-domain-or-tunnel>/mcp",
      "headers": {
        "Authorization": "Bearer smx_YOUR_GENERATED_API_KEY"
      }
    }
  }
}
```

---

## Connecting AI Clients

By design, Starmux only listens on `127.0.0.1:18893/mcp` (loopback) and never exposes raw ports directly to external networks:

- **Local AI Client (Same Computer):** Connects directly to `http://127.0.0.1:18893/mcp` with zero network configuration.
- **Remote / Cloud AI Client:** Connects through an **HTTPS Reverse Proxy** or a **Tunnel Client** running on your machine, which receives external HTTPS traffic and forwards it locally to `127.0.0.1:18893/mcp`:

```text
Remote AI Client
  ──(HTTPS)──▶ HTTPS Reverse Proxy (Caddy) or Tunnel Client
                 ──(Loopback)──▶ Starmux (127.0.0.1:18893/mcp)
                                   ──▶ Local Files, Shell & Git
```

### 1. Choose a Network Forwarder (for Remote / Cloud Access)

| Network Method | Best For | Recommended Software & Official Docs | Starmux Guide |
| :--- | :--- | :--- | :--- |
| **Direct HTTPS (Reverse Proxy)** | Hosts with a public IPv4 / IPv6 address and a domain name | [Caddy](https://caddyserver.com/docs/quick-starts/reverse-proxy) *(auto HTTPS)* · [Nginx](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) | [Caddy HTTPS Setup](docs/REMOTE_SETUP.md#2-https--bearer-api-key) |
| **Secure Tunnel** | Hosts behind NAT, home Wi-Fi, or office firewalls *(no inbound port needed)* | [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) · [Tailscale Funnel / Serve](https://tailscale.com/kb/1223/funnel) · [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) · [ngrok](https://ngrok.com/docs) | [Tunnel Setup](docs/CONNECT_CHATGPT.md#2-secure-mcp-tunnel--no-inbound-port) |

### 2. Choose an Authentication Mode

Authentication is configured independently of how you expose the network:

| Authentication Mode | When to Use | CLI Command |
| :--- | :--- | :--- |
| **None** *(default)* | Same-computer clients, or tunnels that already handle caller login | `starmux auth mode none` |
| **Bearer API Key** *(recommended)* | Clients that support an `Authorization: Bearer <key>` header | `starmux auth key "My AI Client"` |
| **OAuth 2.0** | Cloud clients that require browser sign-in (e.g., ChatGPT Web) | `starmux auth oauth setup ...` |

### 3. Client Setup Guides

| AI Client | Recommended Connection & Auth | Status | Setup Guide |
| :--- | :--- | :--- | :--- |
| **ChatGPT Web** | Secure Tunnel + OAuth (Browser Login) | ✅ Tested | [ChatGPT OAuth Guide](docs/OAUTH.md) |
| **Claude App** | Remote MCP Custom Connector | 🎯 Target | [Client Compatibility](docs/CLIENTS.md) |
| **Codex** | Protected Tunnel (No Starmux Token) | ✅ Tested | [Remote Setup Guide](docs/REMOTE_SETUP.md) |
| **WorkBuddy** | Direct HTTPS + Bearer API Key | ✅ Tested | [HTTPS + API Key Guide](docs/REMOTE_SETUP.md#2-https--bearer-api-key) |
| **Doubao (豆包)** | HTTPS / Tunnel | ✅ Community Verified | [Client Compatibility](docs/CLIENTS.md) |

See [Client Compatibility](docs/CLIENTS.md) and [Remote Setup](docs/REMOTE_SETUP.md) for DNS, TLS, Caddy, OAuth, and tunnel configuration details.

---

## Everyday CLI & Multi-Workspace

Manage your gateway with simple, human-friendly commands:

```bash
starmux status          # Check health, endpoints, and active permission mode
starmux auth            # View auth mode, active API keys, and OAuth sessions
starmux verify          # Test local MCP handshake, tool discovery, and workspace read
starmux doctor          # Run environment and configuration diagnostics
starmux dashboard       # Open the local Web Access Console to copy settings
starmux logs -f         # Stream live gateway logs
starmux down            # Stop the gateway (alias: stop)
```

After initialization, `starmux up` reuses your saved workspace. Use `starmux up .` to switch it to your current directory, or pass `--foreground` to keep the process in your terminal.

### Advanced: Running multiple workspaces (`-i`)

*(Optional)* By default, Starmux manages a single `default` workspace so you never have to pass extra flags. When you need to expose multiple projects simultaneously or run different permission modes on the same machine, pass `-i <name>` to create isolated instances with their own ports, credentials, policies, and logs:

```bash
starmux up ~/work/repo-a -i work --code
starmux up ~/personal/blog -i blog --read
starmux ls              # List all instances with status, mode, port, and workspace
starmux down -i work    # Stop a specific instance
starmux rm blog         # Stop and archive an instance
```

See [Instances and Configuration](docs/INSTANCES.md) for advanced JSONC configuration (`starmux config edit` / `starmux config apply`) and hot-reload workflows.

---

## Native macOS App

Prefer a visual interface? The native SwiftUI menu bar App puts service health, workspace permissions, live MCP connection topology, and recent tool calls in one compact panel.

<div align="center">
  <img src="docs/assets/starmux-app-en.png" width="380" alt="Starmux native macOS menu bar app showing service status, MCP connection topology, and recent tool calls" />
  <p><sub>Native macOS Menu Bar App (English & Chinese) · Controls the same instances as the CLI</sub></p>
</div>

The App and CLI manage the same underlying instances. Quitting the App stops only instances started by the App; background instances started via CLI keep running.

| Host Platform | Core & CLI | Native Menu Bar App |
| :--- | :--- | :--- |
| **macOS** (`Apple Silicon` / `Intel`) | ✅ Tested | 🧪 Development Build ([App Build Guide](app/README.md)) |
| **Linux** (`x64` / `ARM64` / **NVIDIA Jetson**) | ✅ Tested | — |
| **Windows** | ✅ Tested | — |

---

## Documentation & Advanced Guides

Starmux began with the [community request for a self-hosted Desktop Commander workbench](https://github.com/wonderwhy-er/DesktopCommanderMCP/issues/714) and is evolving into a universal MCP router and programmable middleware for multi-server environments.

Explore the `docs/` guides by topic:

- **🌐 Remote Networking & Auth**
  - [Remote Setup (HTTPS & Tunnel)](docs/REMOTE_SETUP.md) — Step-by-step Caddy reverse proxy, custom TLS / port `8443`, IPv6, and Tunnel setup.
  - [Access Control & API Keys](docs/ACCESS_CONTROL.md) — Creating/revoking Bearer API keys, expiration policies, and using the local Web Access Console.
  - [ChatGPT Web & OAuth 2.0](docs/OAUTH.md) & [Connect ChatGPT](docs/CONNECT_CHATGPT.md) — Configuring Keycloak OAuth 2.0 + PKCE and OpenAI Secure MCP Tunnel.
- **⚙️ Advanced Configuration & Security**
  - [Multi-Instance & JSONC Config](docs/INSTANCES.md) — Managing multiple isolated workspaces, hot-reloading `config.jsonc`, mounting extra `stdio` MCP upstreams, and secrets.
  - [Security & Workspace Permissions](docs/SECURITY.md) — Understanding Read-Only vs. Coding Mode, directory grants, tool deny rules, and macOS privacy boundaries.
  - [Client Compatibility](docs/CLIENTS.md) & [Platform Details](docs/PLATFORMS.md) — Tested AI client matrix and macOS / Linux / Windows runtime specifics.
- **🛠️ Reference & Project**
  - [Documentation Index](docs/README.md) · [Installation](docs/INSTALL.md) · [Contributing](CONTRIBUTING.md)

## License

Starmux original code is [MIT Licensed](LICENSE). [Desktop Commander](https://github.com/wonderwhy-er/DesktopCommanderMCP) is bundled as a pinned dependency and retains its own license and notices. Starmux is an independent open-source project and is not endorsed by Desktop Commander or AI client vendors.
