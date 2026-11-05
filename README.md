<div align="center">

# Starmux Self-hosted MCP Gateway

### Give cloud AI clients secure access to your local machine.

**Self-hosted MCP Gateway · Built-in File, Shell & Git Tools · macOS Menu Bar App · MIT**

[Why Starmux?](#why-starmux) · [Quick Start](#quick-start) · [Use Cases](#common-use-cases) · [Securing & Client Guides](#securing-remote-access--client-guides) · [macOS App](#native-macos-app) · [Documentation](docs/README.md)

</div>

---

## Why Starmux?

AI assistants and coding agents (like **ChatGPT Web**, **Claude App / Code**, **Antigravity**, **Codex**, **Cursor**, **WorkBuddy**, **DSH-Harness**, **Kimi Code**, **Minimax Code**, **ZCode**, or **Doubao**) are powerful, but cloud clients are isolated in the browser and many desktop agents lack native Linux / ARM64 apps.

**Starmux** (`Star` topology + `Multiplexer`) is a self-hosted MCP gateway that connects any AI client to the real tools on your own computers:

<div align="center">
  <img src="https://raw.githubusercontent.com/cookyecat/starmux/main/docs/assets/starmux-architecture.svg" width="100%" alt="Starmux architecture: Many AI clients connecting to self-hosted computers via Direct HTTPS or Secure MCP Tunnel" />
</div>

- **Give ChatGPT & Cloud AI Local "Computer Use":** Turn browser and chat AI into a local coding agent. Out of the box, your AI can read/edit local files, search code, run Shell commands, and manage Git via the built-in [Desktop Commander](https://github.com/wonderwhy-er/DesktopCommanderMCP) engine.
- **Code on Any Host (macOS, Linux, NVIDIA Jetson & Windows):** Desktop AI clients like **WorkBuddy** or **ChatGPT** have no native Linux or ARM64 app. Run Starmux on your target Linux server, **NVIDIA Jetson**, or workstation, and drive it remotely from your laptop or browser.
- **Programmable MCP Multiplexer & Middleware:** Aggregate built-in workspace tools and your own local `stdio` MCP servers behind a single Streamable HTTP `/mcp` endpoint—complete with unified authentication, tool allowlists, and live activity logs.
- **100% Self-Hosted — Your Network, Your Keys:** Totally self-hosted. No vendor-hosted relay required. Connect over Localhost, SSH, Direct HTTPS, or your own Tunnel, and lock down access with Bearer API Keys or OAuth 2.0 whenever you need.

---

## Quick Start

### 1. Install

Requires **Node.js 22.12+**.

```bash
npm install -g starmux
```

*(Upgrading? Run `starmux down` before installing the new version—see the [Upgrade Guide](docs/INSTALL.md#upgrade).)*

### 2. Start in your project directory

```bash
cd /path/to/your/project

# Option 1: Read-only mode (default — safely inspect files & code)
starmux up

# or, Option 2: Coding mode (edit files, run Shell & Git)
starmux up --code
```

Starmux starts in the background on `http://127.0.0.1:18893/mcp` with **Authentication: `None`** by default so you can connect immediately:

```text
● Starmux is running  (instance: default)
  Instance        <instance UUID>
  Listen          http://127.0.0.1:18893/mcp  (this computer only)
  Project         /path/to/your/project
  Mode            Read-only (global · OS account)  (run 'starmux up --code' to enable edits & shell)
  Auth            None (no token required)
```

*(Switch modes anytime with `starmux up --code` and `starmux up --read`.)*

### 3. Expose for Remote / Cloud AI *(Skip if your AI client is on this same computer)*

Because Starmux only listens on `127.0.0.1:18893`, forward traffic to it if your AI client is in the cloud (e.g., **ChatGPT Web**) or on another computer:

- **Option 1: Reachable IP (Public or LAN) — Direct Proxy with [Caddy](https://caddyserver.com):**
  Run in your terminal (replace `mcp.example.com` with your public domain, or `http://YOUR_LAN_IP` on a local network):
  ```bash
  caddy run --adapter caddyfile --config - << 'EOF'
  mcp.example.com {
  	handle /mcp {
  		reverse_proxy 127.0.0.1:18893 {
  			header_up Host 127.0.0.1:18893
  		}
  	}
  }
  EOF
  ```

- **Option 2: Behind NAT / Firewall — Use a Tunnel or SSH:**
  - **[OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) (for ChatGPT Web / Codex):**
    ```bash
    tunnel-client run \
      --control-plane.tunnel-id "tunnel_YOUR_TUNNEL_ID" \
      --control-plane.api-key "env:MAC_MCP_TUNNEL_KEY" \
      --mcp.server-url "http://127.0.0.1:18893/mcp" \
      --health.listen-addr "127.0.0.1:18891" \
      --log.level info
    ```
    *(Behind a proxy? Append `--control-plane.http-proxy "http://127.0.0.1:PROXY_PORT"`.)*
  - **or, Cloudflare Quick Tunnel:** `cloudflared tunnel --url http://127.0.0.1:18893 --http-host-header 127.0.0.1:18893`
  - **or, SSH Forwarding (Laptop $\rightarrow$ Linux / Jetson):** `ssh -N -L 127.0.0.1:18893:127.0.0.1:18893 user@remote-host` *(add `-p PORT` if SSH uses a non-default port; change the first `18893` to `18894` if port `18893` is already used on your laptop)*

*(See [Installation & Networking](docs/INSTALL.md#4-remote-network-forwarding--ingress-engineering) for Tailscale, ngrok, and custom TLS ports.)*

### 4. Connect your AI client

With default settings (`Auth: None`), connect your AI client using any of the options below:

#### Option 1 — Ask your AI coding agent to add it for you *(Zero manual config)*

For agentic coding clients (**Claude Code**, **Antigravity**, **Codex**, **Cursor**, **WorkBuddy**, **DSH-Harness**, **Kimi Code**, **Minimax Code**, **ZCode**), simply send this prompt in the AI chat (replacing the URL with your LAN IP, domain, or `http://127.0.0.1:18893/mcp`):

```text
Create this MCP Server connector:
"starmux": {
  "type": "streamable-http",
  "url": "http://192.168.50.114/mcp"
}
```

Your AI agent will automatically update its own MCP configuration and connect.

#### or, Option 2 — AI clients with a Form UI (e.g., ChatGPT Web, Claude, Doubao)

| MCP Client Field | Value to Fill In |
| :--- | :--- |
| **Transport** | `Streamable HTTP` *(or select your **Tunnel** in ChatGPT Web)* |
| **URL** | `https://mcp.example.com/mcp` *(Remote HTTPS / Tunnel)* — or `http://127.0.0.1:18893/mcp` *(same computer)* |
| **Authentication** | `None` *(default)* |

#### or, Option 3 — Manually paste into `mcp.json`

If you prefer editing your client's `mcp.json` / `mcpServers` settings manually:

- **Remote / LAN connection (via Direct Proxy or Tunnel — do NOT use `127.0.0.1` across separate machines):**
  ```json
  {
    "mcpServers": {
      "starmux": {
        "type": "streamable-http",
        "url": "https://mcp.example.com/mcp"
      }
    }
  }
  ```

- **or, Same-computer connection (or when using local `ssh -L` port forwarding):**
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

## Common Use Cases

- [How can ChatGPT access my local computer?](https://github.com/cookyecat/starmux/blob/main/docs/use-cases/chatgpt-access-local-computer.md)
- [How do I self-host a remote MCP gateway?](https://github.com/cookyecat/starmux/blob/main/docs/use-cases/self-hosted-remote-mcp-gateway.md)
- [How can I use Desktop Commander remotely?](https://github.com/cookyecat/starmux/blob/main/docs/use-cases/remote-desktop-commander.md)
- [Can ChatGPT access a Linux server or NVIDIA Jetson?](https://github.com/cookyecat/starmux/blob/main/docs/use-cases/chatgpt-linux-jetson.md)
- [How do I connect an MCP server behind NAT — HTTPS or Tunnel?](https://github.com/cookyecat/starmux/blob/main/docs/use-cases/mcp-behind-nat-https-vs-tunnel.md)
- [How can I secure a remote MCP endpoint with OAuth?](https://github.com/cookyecat/starmux/blob/main/docs/use-cases/self-hosted-mcp-oauth.md)

---

## Securing Remote Access & Client Guides

Once your connection works, **lock down public HTTPS / Tunnel endpoints** so only you can access your gateway:

### Add Authentication *(Recommended for Internet-Facing Endpoints)*

1. **Bearer API Key (10-second setup for Antigravity, Cursor, WorkBuddy, Kimi Code, Codex, etc.):**
   ```bash
   starmux auth key "My AI Client"
   ```
   Then add `"headers": { "Authorization": "Bearer smx_YOUR_GENERATED_API_KEY" }` to your client's JSON config (or `Authorization: Bearer <key>` in Form UI).
2. **OAuth 2.0 Browser Login (for ChatGPT Web):**
   Supports full OAuth 2.0 + PKCE and instant session revocation. See [Security & Authentication — OAuth 2.0](docs/SECURITY.md#4-oauth-20--pkce-oauth-with-keycloak).

### Tested AI Client Matrix

| AI Client | Recommended Setup | Status | Detailed Guide |
| :--- | :--- | :--- | :--- |
| **ChatGPT Web** | Direct HTTPS or OpenAI Tunnel (+ OAuth) | ✅ Tested | [ChatGPT Web Setup](docs/CLIENTS.md#2-chatgpt-web-tunnel-direct-https--oauth) |
| **Claude App / Code** | Chat Prompt (`Claude Code`) or Remote MCP Custom Connector (`Claude App`) | ✅ Tested | [AI Coding Agents](docs/CLIENTS.md#3-ai-coding-agents-claude-code-antigravity-codex-cursor-workbuddy-dsh-harness-kimi-code-minimax-code-zcode) · [Claude App](docs/CLIENTS.md#5-claude-app--doubao-豆包) |
| **Antigravity** | Chat Prompt / Local / LAN / SSH / HTTPS | ✅ Tested | [AI Coding Agents Setup](docs/CLIENTS.md#3-ai-coding-agents-claude-code-antigravity-codex-cursor-workbuddy-dsh-harness-kimi-code-minimax-code-zcode) |
| **Codex** | Chat Prompt / Tunnel or HTTPS + Bearer API Key | ✅ Tested | [Codex CLI Setup](docs/CLIENTS.md#4-codex-cli-configtoml) |
| **Cursor** | Chat Prompt / Local / LAN / SSH / HTTPS | ✅ Tested | [AI Coding Agents Setup](docs/CLIENTS.md#3-ai-coding-agents-claude-code-antigravity-codex-cursor-workbuddy-dsh-harness-kimi-code-minimax-code-zcode) |
| **WorkBuddy** | Chat Prompt / Local / LAN / SSH / HTTPS | ✅ Tested | [AI Coding Agents Setup](docs/CLIENTS.md#3-ai-coding-agents-claude-code-antigravity-codex-cursor-workbuddy-dsh-harness-kimi-code-minimax-code-zcode) |
| **DSH-Harness** | Chat Prompt / Local / LAN / SSH / HTTPS | ✅ Tested | [AI Coding Agents Setup](docs/CLIENTS.md#3-ai-coding-agents-claude-code-antigravity-codex-cursor-workbuddy-dsh-harness-kimi-code-minimax-code-zcode) |
| **Kimi Code** | Chat Prompt / Local / LAN / SSH / HTTPS | ✅ Tested | [AI Coding Agents Setup](docs/CLIENTS.md#3-ai-coding-agents-claude-code-antigravity-codex-cursor-workbuddy-dsh-harness-kimi-code-minimax-code-zcode) |
| **Minimax Code** | Chat Prompt / Local / LAN / SSH / HTTPS | ✅ Tested | [AI Coding Agents Setup](docs/CLIENTS.md#3-ai-coding-agents-claude-code-antigravity-codex-cursor-workbuddy-dsh-harness-kimi-code-minimax-code-zcode) |
| **ZCode** | Chat Prompt / Local / LAN / SSH / HTTPS | ✅ Tested | [AI Coding Agents Setup](docs/CLIENTS.md#3-ai-coding-agents-claude-code-antigravity-codex-cursor-workbuddy-dsh-harness-kimi-code-minimax-code-zcode) |
| **Doubao (豆包)** | Direct HTTPS or Tunnel | ✅ Tested | [Claude & Doubao Setup](docs/CLIENTS.md#5-claude-app--doubao-豆包) |

---

## Everyday CLI & Multiple Instances

Manage your gateway with simple, human-friendly commands:

```bash
starmux status          # Check health, endpoints, and active permission mode
starmux up .            # Switch active project context to current directory
starmux auth            # View auth mode, active API keys, and OAuth sessions
starmux verify          # Test local MCP handshake, tool discovery, and workspace read
starmux doctor          # Run environment and configuration diagnostics
starmux dashboard       # Open the local Web Access Console to copy settings
starmux logs -f         # Stream live gateway logs
starmux down            # Stop the gateway (alias: stop)
```

### Advanced: Running multiple instances (`-i`)

*(Optional)* By default, Starmux manages a single `default` instance so you never have to pass extra flags. To use different project contexts or permission modes on the same machine, pass `-i <name>` to create instances with their own ports, credentials, configuration, and logs:

```bash
starmux up ~/work/repo-a -i work --code
starmux up ~/personal/blog -i blog --read
starmux ls              # List all instances with status, mode, port, and workspace
starmux down -i work    # Stop a specific instance
starmux rm blog         # Stop and archive an instance
```

See [Instances and Configuration](docs/INSTANCES.md) for advanced JSONC configuration (`starmux config edit` / `starmux config apply`), mounting extra `stdio` MCP servers, and hot-reload workflows.

---

## Native macOS App

Prefer a visual interface? The native SwiftUI menu bar App puts service health, workspace permissions, live MCP connection topology, and recent tool calls in one compact panel.

<div align="center">
  <img src="https://raw.githubusercontent.com/cookyecat/starmux/main/docs/assets/starmux-app-en.png" width="380" alt="Starmux native macOS menu bar app showing service status, MCP connection topology, and recent tool calls" />
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

Explore the [Documentation Index](docs/README.md) by category:

- **📦 [Installation, Platforms & Network Forwarding](docs/INSTALL.md)** — Supported hosts (`macOS`, `Linux`, `NVIDIA Jetson`, `Windows`), everyday CLI commands, upgrades, source builds, and advanced Caddy / Tunnel / SSH forwarding.
- **🔒 [Security, Access Control & Authentication](docs/SECURITY.md)** — Global Read-Only vs. Coding permissions, Bearer API keys (`starmux auth key`), Web Access Console, and self-hosted Keycloak OAuth 2.0 + PKCE.
- **🤖 [AI Client Configuration Guides](docs/CLIENTS.md)** — End-to-end setup (including 1-step Prompt Auto-Setup) for **ChatGPT Web**, **Claude App / Code**, **Antigravity**, **Codex**, **Cursor**, **WorkBuddy**, **DSH-Harness**, **Kimi Code**, **Minimax Code**, **ZCode**, and **Doubao (豆包)**.
- **⚙️ [Multi-Instance & JSONC Configuration](docs/INSTANCES.md)** — Running multiple instances (`-i NAME`), hot-reloading `config.jsonc`, mounting extra local `stdio` MCP servers (`upstreams`), and managing secrets.

## License

Starmux original code is [MIT Licensed](LICENSE). [Desktop Commander](https://github.com/wonderwhy-er/DesktopCommanderMCP) is bundled as a pinned dependency and retains its own license and notices. Starmux is an independent open-source project and is not endorsed by Desktop Commander or AI client vendors.
