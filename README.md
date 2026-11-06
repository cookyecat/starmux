<div align="center">

# Starmux — All-in-One Self-Hosted Remote MCP Server & Gateway

### One turnkey daemon for remote filesystem, terminal, background processes, auth, and `stdio` MCP multiplexing—no manual component assembly required.

**All-in-One Remote MCP Server · Streamable HTTP Gateway · Built-in Filesystem, Terminal, Process & Git Tools · `stdio` Multiplexer · MIT**

[Why Starmux?](#why-starmux) · [All-in-One vs. DIY Stacks](#all-in-one-vs-fragmented-diy-stacks) · [Quick Start](#quick-start) · [Auth & Multi-Instance Permissions](#securing-remote-access-auth--multi-instance-permissions) · [Use Cases](#common-use-cases--faq) · [macOS App](#native-macos-app) · [Documentation](docs/README.md)

</div>

---

## Why Starmux?

Cloud AI assistants (like **ChatGPT Web**, **Claude**, or **Doubao**) are isolated in the browser, and many desktop coding agents (like **WorkBuddy**, **Cursor**, **Claude Code**, **Codex**, **Antigravity**, **DSH-Harness**, **Kimi Code**, **Minimax Code**, or **ZCode**) lack native apps for headless Linux servers or ARM64 edge boards.

Normally, solving this requires **manually assembling 3–4 separate open-source tools**: a local tool server (`DesktopCommanderMCP` or `filesystem-mcp`), a `stdio`-to-HTTP transport adapter (`supergateway` or `mcp-proxy`), an authentication/aggregation gateway (`MCPHub` or `ContextForge`), and a process supervisor.

**Starmux** (`Star` topology + `Multiplexer`) replaces that entire fragmented chain with a **single, turnkey self-hosted daemon** (`starmux up`):

```text
Traditional DIY Stack:  [Filesystem/Terminal MCP] + [supergateway / mcp-proxy] + [Auth/Aggregator Gateway] + [Supervisor]
Starmux (All-in-One):   [                   Single 'starmux up' Daemon (127.0.0.1:18893/mcp)                   ]
```

<div align="center">
  <img src="https://raw.githubusercontent.com/cookyecat/starmux/main/docs/assets/starmux-architecture.svg" width="100%" alt="Starmux architecture: Many AI clients connecting to self-hosted computers via Direct HTTPS or Secure MCP Tunnel" />
</div>

- **Turnkey Filesystem, Diff File Editing, Terminal & Process Management ([Desktop Commander](https://github.com/wonderwhy-er/DesktopCommanderMCP) Engine):** Out of the box—with zero external MCP servers to install—AI clients can read/write local files (`read_file`, `write_file`, `list_directory`), run ripgrep code searches (`start_search`), perform surgical diff edits (`edit_block`), control interactive PTY/Shell terminal sessions (`start_process`, `interact_with_process`, `read_process_output`), manage background processes (`list_processes`, `kill_process`, `force_terminate`), and run Git workflows.
- **Operate Headless Linux, NVIDIA Jetson (`ARM64`), macOS & Windows Remotely:** Desktop AI clients like **WorkBuddy** or **ChatGPT** have no native Linux or ARM64 desktop app. Run Starmux on your target Linux workstation, **NVIDIA Jetson Orin**, or server, and drive its filesystem and terminal remotely from your Mac/PC or browser.
- **Built-in `stdio`-to-`Streamable HTTP` Bridge & Multi-Server Aggregator:** Exposes a native `Streamable HTTP` (`/mcp`) endpoint directly and can multiplex your own extra local `stdio` MCP servers (`upstreams`) behind the same port—no separate `supergateway` or `mcp-proxy` wrapper needed.
- **Integrated Read-Only Safety Gate, Revocable API Keys, OAuth 2.0 & Local Admin UI:** Starts in **Global Read-Only mode** (`readOnly`) by default so AI can safely inspect files and directories without running shell commands or modifying disk. Switch to **Coding mode** (`--code`) when needed, lock down remote access with **per-client revocable Bearer API keys** or **OAuth 2.0 + PKCE**, and manage everything from the CLI or private local **Admin UI / Web Dashboard**.

---

## All-in-One vs. Fragmented DIY Stacks

Instead of wiring together separate tool backends, transport bridges, and auth proxies—or deploying heavy control planes that still lack host tools—Starmux provides a unified end-to-end runtime:

| Capability | **Starmux** *(All-in-One Daemon)* | **DIY Stack** *(`DesktopCommanderMCP` + `supergateway` / `mcp-proxy`)* | **Pure MCP Gateways** *(`MCPHub` / `ContextForge` / `MetaMCP`)* | **SSH MCP Bridges** *(`ssh-mcp` / `ssh-mcp-server`)* | **Vendor-Hosted Relays** *(Hosted Remote Desktop Commander)* |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Built-in Filesystem, Diff Edit, Terminal & Process Tools** | ✅ Built-in (25+ tools) | ⚠️ Requires separate tool server | ❌ None (must wire external servers first) | ✅ Via OpenSSH / SFTP | ✅ Built-in |
| **Native `Streamable HTTP` `/mcp` Endpoint** | ✅ Built-in | ⚠️ Requires transport adapter | ✅ Built-in | ❌ Local `stdio` only (no direct Cloud AI HTTP) | ✅ Hosted cloud endpoint |
| **Works with Cloud/Browser AI (ChatGPT Web, Claude)** | ✅ Direct HTTPS or Tunnel | ⚠️ Manual proxy + auth wiring | ✅ With external tool backends | ❌ Requires local `stdio` host | ✅ Via vendor cloud |
| **Headless Linux `x64` / `ARM64` & NVIDIA Jetson Support** | ✅ Single-command CLI (`starmux up`) | ⚠️ Manual multi-process setup | ⚠️ Often requires Docker / DB stack | ✅ Via SSH target | ⚠️ Depends on host agent |
| **Enforced Global Read-Only vs. Coding Mode Switch** | ✅ 1-command switch (`--read` / `--code`) | ❌ No unified read-only gate | ❌ No host-tool read/code mode | ❌ Relies on OS SSH user | ⚠️ Vendor-defined |
| **Per-Client Revocable Bearer API Keys & OAuth 2.0** | ✅ Built-in + Local Admin UI | ❌ Requires external auth proxy | ✅ Built-in | ❌ SSH keys only | ✅ Vendor OAuth |
| **Multiplex Extra Local `stdio` MCP Servers (`upstreams`)** | ✅ Built-in namespaced router | ⚠️ Adapter-dependent | ✅ Built-in | ❌ No | ❌ No |
| **100% Self-Hosted (Zero Mandatory Third-Party Relay)** | ✅ Your network & keys | ✅ Self-hosted | ✅ Self-hosted | ✅ Self-hosted | ❌ Traffic routes via vendor relay |

---

## Quick Start

### 1. Install

Requires **Node.js 22.12+** on **macOS**, **Linux** (`x64` / `ARM64` / **NVIDIA Jetson**), or **Windows**.

```bash
npm install -g starmux
```

*(Upgrading? Run `starmux down` before installing the new version—see the [Upgrade Guide](docs/INSTALL.md#upgrade).)*

### 2. Start in your project directory

```bash
cd /path/to/your/project

# Option 1: Read-only mode (default — safely inspect files, folders & code)
starmux up

# or, Option 2: Coding mode (enable file edits, interactive terminal, process management & Git)
starmux up --code
```

Starmux starts in the background on `http://127.0.0.1:18893/mcp` with **Authentication: `None`** by default for immediate local connection:

```text
● Starmux is running  (instance: default)
  Instance        <instance UUID>
  Listen          http://127.0.0.1:18893/mcp  (this computer only)
  Project         /path/to/your/project
  Mode            Read-only (global · OS account)  (run 'starmux up --code' to enable edits & shell)
  Auth            None (no token required)
```

*(Switch between Read-only and Coding permissions anytime with `starmux up --code` and `starmux up --read`.)*

### 3. Expose for Remote / Cloud AI *(Skip if your AI client runs on this same computer)*

Because Starmux binds strictly to `127.0.0.1:18893` for local security, choose the forwarding method that matches your network when connecting from a cloud AI client (**ChatGPT Web**) or another computer (**WorkBuddy / Cursor on Mac $\rightarrow$ Linux / Jetson**):

| Network Scenario | Best For | Recommended Method | Quick Setup Command |
| :--- | :--- | :--- | :--- |
| **A. Reachable IP / LAN / VPN** *(Host IP or domain can be reached directly)* | • **All AI clients** over LAN (`http://LAN_IP/mcp`), Tailscale, or public domain (`https://mcp.example.com/mcp`)<br/>• **Desktop AI on Laptop** controlling a remote Linux / Jetson host over SSH | **Option A1:** [Caddy](https://caddyserver.com) Reverse Proxy<br/>**Option A2:** OpenSSH Port Forwarding (`ssh -L`, zero extra install on host) | • **A1 (Caddy):** See collapsible block below<br/>• **A2 (SSH):** `ssh -N -L 127.0.0.1:18893:127.0.0.1:18893 user@remote-host` |
| **B. Behind NAT / CGNAT** *(No inbound port or connecting to Cloud AI)* | Home/office PC or lab server behind a firewall/CGNAT connecting to **ChatGPT Web** or remote agents without opening inbound ports | [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) | See **Option B** in collapsible block below |

<details>
<summary><b>Copy-paste commands for Option A1 (Caddy Reverse Proxy) & Option B (Outbound Tunnels)</b></summary>

- **Option A1: Reachable IP (LAN or Public Domain) with [Caddy](https://caddyserver.com):**
  Replace `mcp.example.com` with your public domain (or `http://YOUR_LAN_IP` on a trusted private LAN):
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

- **Option B: Behind NAT / CGNAT — Outbound Tunnel (No inbound port forwarding required):**
  - **[OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) (for ChatGPT Web / Codex):**
    ```bash
    tunnel-client run \
      --control-plane.tunnel-id "tunnel_YOUR_TUNNEL_ID" \
      --control-plane.api-key "env:MAC_MCP_TUNNEL_KEY" \
      --mcp.server-url "http://127.0.0.1:18893/mcp" \
      --health.listen-addr "127.0.0.1:18891" \
      --log.level info
    ```
  - **or, Cloudflare Quick Tunnel:**
    ```bash
    cloudflared tunnel --url http://127.0.0.1:18893 --http-host-header 127.0.0.1:18893
    ```

*(See [Installation & Networking](docs/INSTALL.md#4-remote-network-forwarding--ingress-engineering) for Tailscale, frp, rathole, ngrok, and IPv6 TLS setups.)*
</details>

### 4. Connect your AI client

With default settings (`Auth: None`), connect your AI client using any of the 3 options below:

#### Option 1 — Ask your AI coding agent to add it for you *(Zero manual config)*

For agentic coding clients (**Claude Code**, **Antigravity**, **Codex**, **Cursor**, **WorkBuddy**, **DSH-Harness**, **Kimi Code**, **Minimax Code**, **ZCode**), send this prompt in the AI chat (replace the URL with your LAN IP, domain, or `http://127.0.0.1:18893/mcp`):

```text
Create this MCP Server connector:
"starmux": {
  "type": "streamable-http",
  "url": "http://192.168.50.114/mcp"
}
```

#### or, Option 2 — AI clients with a Form UI (e.g., ChatGPT Web, Claude, Doubao)

| MCP Client Field | Value to Fill In |
| :--- | :--- |
| **Transport** | `Streamable HTTP` *(or select your **Tunnel** in ChatGPT Web)* |
| **URL** | `https://mcp.example.com/mcp` *(Remote HTTPS / Tunnel)* — or `http://127.0.0.1:18893/mcp` *(same computer)* |
| **Authentication** | `None` *(default for local/LAN; use Bearer API Key or OAuth 2.0 for public endpoints)* |

#### or, Option 3 — Manually paste into `mcp.json`

- **Same-computer connection (or when using local `ssh -L` port forwarding):**
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

---

## Securing Remote Access: Auth & Multi-Instance Permissions

When exposing Starmux beyond `127.0.0.1`, lock down your endpoint with per-client credentials and permission controls:

### 1. Per-Client Bearer API Keys & OAuth 2.0

1. **Per-Client Bearer API Keys (with instant revocation & private Admin UI):**
   Create a named credential for each AI client so you can audit or revoke them independently without exposing the local admin interface:
   ```bash
   starmux auth key "My AI Client"
   starmux auth                    # List active API keys, OAuth sessions, and auth status
   starmux dashboard               # Open the private local Admin UI / Web Access Console (127.0.0.1 only)
   ```
   Then add the `Authorization` header to your client's `mcp.json`:
   ```json
   {
     "mcpServers": {
       "starmux": {
         "type": "streamable-http",
         "url": "https://mcp.example.com/mcp",
         "headers": {
           "Authorization": "Bearer smx_YOUR_GENERATED_API_KEY"
         }
       }
     }
   }
   ```
2. **OAuth 2.0 + PKCE Browser Login (for ChatGPT Web):**
   Acts as a standard OAuth 2.0 protected resource server with PKCE and session revocation (via self-hosted Keycloak). See [Security & Authentication — OAuth 2.0](docs/SECURITY.md#4-oauth-20--pkce-oauth-with-keycloak).

### 2. Advanced: Multiple Instances, Separate Project Folders & `stdio` Multiplexing (`-i`)

*(Optional)* By default, Starmux runs a single `default` instance. If you want **separate remote MCP endpoints on one computer**—each with its own port, project directory / folder context, credentials, mounted `stdio` MCP servers, and **Read-Only vs. Coding** permission mode—pass `-i <name>`:

```bash
# Instance 1: Coding mode on port 18893 for repo-a
starmux up ~/work/repo-a -i work --code

# Instance 2: Strict Read-Only mode on an auto-assigned port for docs/blog folder
starmux up ~/personal/blog -i blog --read

starmux ls                      # List all instances with status, mode, port, and project folder
starmux config edit -i work     # Mount extra local stdio MCP servers (upstreams) or customize settings
starmux config apply -i work    # Hot-reload configuration changes
starmux down -i work            # Stop a specific instance
```

> **Security & Trust Boundary Note:** Starmux's default **Read-Only mode** (`--read`) blocks write tools, shell execution, and Git mutations across the instance. In **Coding mode** (`--code`), terminal and file tools run with your OS account's permissions (the configured project directory sets the working context, not an OS chroot sandbox; an optional home-directory write sandbox is available on macOS). See [Instances & Upstream Multiplexing](docs/INSTANCES.md) and [Security Model](docs/SECURITY.md).

---

## Everyday CLI Commands

```bash
starmux status          # Check health, endpoints, active permission mode, and recent tool activity
starmux up .            # Switch active project folder context to current directory
starmux auth            # View auth mode, create/revoke per-client API keys, and inspect OAuth sessions
starmux verify          # Run an end-to-end local MCP handshake, tool discovery, and read probe
starmux doctor          # Run environment, port lease, and configuration diagnostics
starmux dashboard       # Open the local Web Admin UI / Access Console to manage access & tool deny rules
starmux logs -f         # Stream live MCP gateway and tool invocation logs
starmux down            # Stop the gateway (alias: stop)
```

---

## Tested AI Client Matrix

| AI Client | Recommended Setup | Status | Detailed Guide |
| :--- | :--- | :--- | :--- |
| **ChatGPT Web** | Direct HTTPS or OpenAI Tunnel (+ OAuth 2.0) | ✅ Tested | [ChatGPT Web Setup](docs/CLIENTS.md#2-chatgpt-web-tunnel-direct-https--oauth) |
| **Claude App / Code** | Chat Prompt (`Claude Code`) or Remote MCP Custom Connector (`Claude App`) | ✅ Tested | [AI Coding Agents](docs/CLIENTS.md#3-ai-coding-agents-claude-code-antigravity-codex-cursor-workbuddy-dsh-harness-kimi-code-minimax-code-zcode) · [Claude App](docs/CLIENTS.md#5-claude-app--doubao-豆包) |
| **WorkBuddy** | Chat Prompt / Local / LAN / SSH / Caddy HTTPS (Mac $\rightarrow$ Linux / Jetson) | ✅ Tested | [WorkBuddy to Linux / Jetson Guide](docs/use-cases/workbuddy-linux-jetson.md) |
| **Antigravity** | Chat Prompt / Local / LAN / SSH / HTTPS | ✅ Tested | [AI Coding Agents Setup](docs/CLIENTS.md#3-ai-coding-agents-claude-code-antigravity-codex-cursor-workbuddy-dsh-harness-kimi-code-minimax-code-zcode) |
| **Codex CLI / App** | Chat Prompt / Tunnel or HTTPS + Bearer API Key | ✅ Tested | [Codex CLI Setup](docs/CLIENTS.md#4-codex-cli-configtoml) |
| **Cursor** | Chat Prompt / Local / LAN / SSH / HTTPS | ✅ Tested | [AI Coding Agents Setup](docs/CLIENTS.md#3-ai-coding-agents-claude-code-antigravity-codex-cursor-workbuddy-dsh-harness-kimi-code-minimax-code-zcode) |
| **DSH-Harness / Kimi / Minimax / ZCode** | Chat Prompt / Local / LAN / SSH / HTTPS | ✅ Tested | [AI Coding Agents Setup](docs/CLIENTS.md#3-ai-coding-agents-claude-code-antigravity-codex-cursor-workbuddy-dsh-harness-kimi-code-minimax-code-zcode) |
| **Doubao (豆包)** | Direct HTTPS or Tunnel | ✅ Tested | [Claude & Doubao Setup](docs/CLIENTS.md#5-claude-app--doubao-豆包) |

---

## Common Use Cases & FAQ

- **[How can ChatGPT access files and terminal tools on my local computer?](docs/use-cases/chatgpt-access-local-computer.md)**
  Run `starmux up` locally and expose `127.0.0.1:18893/mcp` via OpenAI Secure MCP Tunnel or Direct HTTPS so ChatGPT Web can inspect folders or run tools without manual file uploads.
- **[How can WorkBuddy on Mac/Windows operate a headless Linux server or NVIDIA Jetson remotely?](docs/use-cases/workbuddy-linux-jetson.md)**
  Install Starmux on the Linux `x64`/`ARM64` or NVIDIA Jetson Orin host, expose `/mcp` over LAN or HTTPS with Caddy, and add `"type": "streamable-http"` in WorkBuddy—no Linux desktop app required.
- **[Is there a self-hosted, open-source alternative to the hosted Remote Desktop Commander service?](docs/use-cases/remote-desktop-commander.md)**
  Yes. Starmux bundles the open-source Desktop Commander tool engine with a built-in Streamable HTTP server, read-only controls, and self-hosted auth so your tools execute without a third-party cloud relay.
- **[How do I aggregate multiple local `stdio` MCP servers behind one Streamable HTTP endpoint?](docs/use-cases/self-hosted-remote-mcp-gateway.md)**
  Configure `upstreams` in your Starmux instance (`starmux config edit`) to multiplex extra `stdio` MCP servers alongside built-in filesystem/terminal tools on a single port.
- **[How do I connect a cloud AI client to an MCP server behind NAT / CGNAT?](docs/use-cases/mcp-behind-nat-https-vs-tunnel.md)**
  Compare outbound tunnels (OpenAI Tunnel, Cloudflare Tunnel, `frp`, `rathole`), Direct IPv6/IPv4 HTTPS with Caddy, and SSH port forwarding.
- **[How can I secure a self-hosted remote MCP server with OAuth 2.0 or revocable API keys?](docs/use-cases/self-hosted-mcp-oauth.md)**
  Use `starmux auth key` for per-client Bearer tokens or configure Keycloak OAuth 2.0 + PKCE for browser-based AI connectors.

> **中文场景速览（一站式自托管远程 MCP 服务与网关）：** Starmux 将 **Desktop Commander 风格的文件读写、代码搜索、Diff 编辑、交互式终端、进程管理与 Git 工具**、**`stdio` 转 `Streamable HTTP` 网关**、**多本地 `stdio` MCP 服务聚合**、**只读（Read-Only）与 Coding 权限切换**、以及 **API Key / OAuth 2.0 鉴权** 一体化内置于单个守护进程中。无需手工拼装 `DesktopCommanderMCP + supergateway`，即可让网页版 **ChatGPT**、**Claude**、**豆包** 或桌面端 **WorkBuddy**、**Cursor**、**Codex**、**Antigravity** 通过局域网 Caddy、Direct HTTPS（支持公网 IPv4/IPv6）、SSH 转发或内网穿透（NAT/CGNAT Tunnel）安全操作 **Linux (`x64`/`ARM64`)**、**NVIDIA Jetson**、**macOS** 与 **Windows** 上的本地文件与终端。

---

## Native macOS App

Prefer a visual interface? The native SwiftUI menu bar App puts service health, Read-Only vs. Coding mode toggles, live MCP connection topology, and recent tool calls in one compact panel.

<div align="center">
  <img src="https://raw.githubusercontent.com/cookyecat/starmux/main/docs/assets/starmux-app-en.png" width="380" alt="Starmux native macOS menu bar app showing service status, MCP connection topology, and recent tool calls" />
  <p><sub>Native macOS Menu Bar App (English & Chinese) · Controls the same instances as the CLI</sub></p>
</div>

The App and CLI manage the same underlying instances. Quitting the App stops only instances started by the App; background instances started via CLI keep running.

| Host Platform | Core & CLI (`starmux`) | Native Menu Bar App |
| :--- | :--- | :--- |
| **macOS** (`Apple Silicon` / `Intel`) | ✅ Tested | 🧪 Development Build ([App Build Guide](app/README.md)) |
| **Linux** (`x64` / `ARM64` / **NVIDIA Jetson**) | ✅ Tested | — |
| **Windows** (`x64`) | ✅ Tested | — |

---

## Documentation & Architecture Guides

Explore the [Documentation Index](docs/README.md) by topic:

- **📦 [Installation, Platforms & Network Forwarding](docs/INSTALL.md)** — Supported hosts (`macOS`, `Linux`, `NVIDIA Jetson`, `Windows`), everyday CLI commands, upgrades, source builds, and Caddy / Tunnel / SSH forwarding.
- **🔒 [Security, Access Control & Authentication](docs/SECURITY.md)** — Global Read-Only vs. Coding permissions, trust boundaries, per-client Bearer API keys (`starmux auth key`), private local Admin UI, and self-hosted Keycloak OAuth 2.0 + PKCE.
- **🤖 [AI Client Configuration Guides](docs/CLIENTS.md)** — End-to-end setup (including 1-step Prompt Auto-Setup) for **ChatGPT Web**, **Claude App / Code**, **WorkBuddy**, **Antigravity**, **Codex**, **Cursor**, **DSH-Harness**, **Kimi Code**, **Minimax Code**, **ZCode**, and **Doubao (豆包)**.
- **⚙️ [Multi-Instance & JSONC Configuration](docs/INSTANCES.md)** — Running multiple isolated instances (`-i NAME`), hot-reloading `config.jsonc`, mounting extra local `stdio` MCP servers (`upstreams`), and managing secrets.

## License

Starmux original code is [MIT Licensed](LICENSE). [Desktop Commander](https://github.com/wonderwhy-er/DesktopCommanderMCP) is bundled as a pinned dependency and retains its own license and notices. Starmux is an independent open-source project and is not endorsed by Desktop Commander or AI client vendors.
