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
- **Safe by Default:** Starts in strict **Read-Only** mode (`starmux up`). Explicitly opt into **Coding Mode** (`starmux up --code`) only when you want AI to edit files or run terminal commands.
- **Your Network, Your Keys:** No vendor-hosted relay required. Protect your gateway with Bearer **API Keys**, browser-based **OAuth**, or your existing **Tunnel/Ingress** access controls. Revoke access instantly at any time.

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

Starmux initializes itself and runs in the background on `127.0.0.1:18893`. Coding mode asks for confirmation the first time (`--code` and `--write` are equivalent):

```text
Starmux · default · running
Workspace  /path/to/your/project
Mode       Read-only
Runtime    background
MCP        http://127.0.0.1:18893/mcp
Dashboard  http://127.0.0.1:18893/access
Logs       starmux logs -f
```

### 3. Create an API Key (optional)

For clients that support Bearer token authentication:

```bash
starmux auth key "My AI Client"
```

This generates a key and enables API-key authentication immediately. Copy the key into your AI client's configuration.

---

## Connecting AI Clients

```text
Remote AI Client
    → Direct HTTPS or Secure MCP Tunnel
    → Authentication (Ingress | API Key | OAuth)
    → Starmux at 127.0.0.1:18893/mcp
    → Your Local Files, Terminal & Git
```

Because Starmux listens locally on `127.0.0.1:18893/mcp`, remote AI clients connect through an **HTTPS reverse proxy** (e.g., Caddy) or an outbound **Tunnel** (e.g., OpenAI Secure MCP Tunnel, Cloudflare Tunnel, Tailscale).

Choose the setup guide matching your AI client:

| AI Client | Recommended Connection & Auth | Status | Setup Guide |
| :--- | :--- | :--- | :--- |
| **ChatGPT Web** | Secure Tunnel + OAuth (Browser Login) | ✅ Tested | [ChatGPT OAuth Guide](docs/OAUTH.md) |
| **Claude App** | Remote MCP Custom Connector | 🎯 Target | [Client Compatibility](docs/CLIENTS.md) |
| **Codex** | Protected Tunnel (Ingress Auth) | ✅ Tested | [Remote Setup Guide](docs/REMOTE_SETUP.md) |
| **WorkBuddy** | Direct HTTPS + Bearer API Key | ✅ Tested | [HTTPS + API Key Guide](docs/REMOTE_SETUP.md#2-https--bearer-api-key) |
| **Doubao (豆包)** | HTTPS / Tunnel | ✅ Community Verified | [Client Compatibility](docs/CLIENTS.md) |


See [Client Compatibility](docs/CLIENTS.md) and [Remote Setup](docs/REMOTE_SETUP.md) for DNS, TLS, OAuth, and tunnel configuration details.

---

## Everyday CLI & Multi-Workspace

Manage your local gateway with simple commands:

```bash
starmux status          # Check health, port, and active permission mode
starmux verify          # Test local MCP handshake and directory read
starmux doctor          # Run environment and configuration checks
starmux dashboard       # Open the local Web Access Console
starmux logs -f         # Stream live gateway logs
starmux down            # Stop the gateway (alias: stop)
```

After initialization, `starmux up` reuses your saved workspace. Use `starmux up .` to switch it to your current directory, or pass `--foreground` to keep the process in your terminal.

### Running multiple workspaces (`-i`)

Need to expose multiple projects or run different permission modes on the same machine? Use `-i <name>` to create isolated instances with their own ports, credentials, policies, and logs:

```bash
starmux up ~/work/repo-a -i work --code
starmux up ~/personal/blog -i blog --read
starmux ls
starmux down -i work

starmux config edit -i blog
starmux config apply -i blog
```

See [Instances and Configuration](docs/INSTANCES.md) for JSONC configuration and hot-reload workflows.

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
| **macOS** | ✅ Tested | 🧪 Development Build ([App Build Guide](app/README.md)) |
| **Linux** | ✅ Tested | — |
| **Windows** | ✅ Tested | — |

---

## Roadmap & Documentation

Starmux began with the [community request for a self-hosted Desktop Commander workbench](https://github.com/wonderwhy-er/DesktopCommanderMCP/issues/714) and is evolving into a universal MCP router and programmable middleware for multi-server environments.

- 📖 **Core Guides:** [Documentation Index](docs/README.md) · [Installation](docs/INSTALL.md) · [Access Control](docs/ACCESS_CONTROL.md) · [Security Boundaries](docs/SECURITY.md)
- 🛠️ **Project & Dev:** [Architecture](docs/ARCHITECTURE.md) · [Platform Details](docs/PLATFORMS.md) · [Release Status](docs/RELEASE_STATUS.md) · [Contributing](CONTRIBUTING.md)

## License

Starmux original code is [MIT Licensed](LICENSE). [Desktop Commander](https://github.com/wonderwhy-er/DesktopCommanderMCP) is bundled as a pinned dependency and retains its own license and notices. Starmux is an independent open-source project and is not endorsed by Desktop Commander or AI client vendors.