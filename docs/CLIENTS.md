# AI Client Configuration Guides

Starmux exposes a standard **MCP Streamable HTTP** endpoint (`/mcp`). Choose your AI client below for step-by-step connection instructions.

---

## Table of Contents

1. [Client Compatibility Overview](#1-client-compatibility-overview)
2. [ChatGPT Web (Tunnel, Direct HTTPS & OAuth)](#2-chatgpt-web-tunnel-direct-https--oauth)
3. [AI Coding Agents (Claude Code, Antigravity, Codex, Cursor, WorkBuddy, DSH-Harness, Kimi Code, Minimax Code, ZCode)](#3-ai-coding-agents-claude-code-antigravity-codex-cursor-workbuddy-dsh-harness-kimi-code-minimax-code-zcode)
4. [Codex CLI (`config.toml`)](#4-codex-cli-configtoml)
5. [Claude App & Doubao (豆包)](#5-claude-app--doubao-豆包)

---

## 1. Client Compatibility Overview

| AI Client | Status | Recommended Connection & Auth | Section |
| :--- | :--- | :--- | :--- |
| **ChatGPT Web** | ✅ Tested | **OpenAI Secure MCP Tunnel** or **Direct HTTPS** (+ `None` or `OAuth 2.0`) | [2. ChatGPT Web](#2-chatgpt-web-tunnel-direct-https--oauth) |
| **Claude App / Code** | ✅ Tested | **Prompt Auto-Setup** (`Claude Code`) or **Remote MCP Custom Connector** (`Claude App`) | [3. AI Coding Agents](#3-ai-coding-agents-claude-code-antigravity-codex-cursor-workbuddy-dsh-harness-kimi-code-minimax-code-zcode) · [5. Claude App](#5-claude-app--doubao-豆包) |
| **Antigravity** | ✅ Tested | **Prompt Auto-Setup** or `mcp.json` (Local / Direct LAN `--allow-lan` / SSH / HTTPS) | [3. AI Coding Agents](#3-ai-coding-agents-claude-code-antigravity-codex-cursor-workbuddy-dsh-harness-kimi-code-minimax-code-zcode) |
| **Codex** | ✅ Tested | **Prompt Auto-Setup**, **Direct LAN (`--allow-lan`)**, **OpenAI Tunnel**, or **HTTPS + Bearer API Key** | [4. Codex CLI](#4-codex-cli-configtoml) |
| **Cursor** | ✅ Tested | **Prompt Auto-Setup** or `mcp.json` (Local / Direct LAN `--allow-lan` / SSH / HTTPS) | [3. AI Coding Agents](#3-ai-coding-agents-claude-code-antigravity-codex-cursor-workbuddy-dsh-harness-kimi-code-minimax-code-zcode) |
| **WorkBuddy** | ✅ Tested | **Prompt Auto-Setup** or `mcp.json` (Direct LAN `--allow-lan` / HTTPS / SSH; `streamable-http`) | [WorkBuddy → Linux / Jetson](use-cases/workbuddy-linux-jetson.md) · [3. AI Coding Agents](#3-ai-coding-agents-claude-code-antigravity-codex-cursor-workbuddy-dsh-harness-kimi-code-minimax-code-zcode) |
| **DSH-Harness** | ✅ Tested | **Prompt Auto-Setup** or `mcp.json` (Local / Direct LAN `--allow-lan` / SSH / HTTPS) | [3. AI Coding Agents](#3-ai-coding-agents-claude-code-antigravity-codex-cursor-workbuddy-dsh-harness-kimi-code-minimax-code-zcode) |
| **Kimi Code** | ✅ Tested | **Prompt Auto-Setup** or `mcp.json` (Local / Direct LAN `--allow-lan` / SSH / HTTPS) | [3. AI Coding Agents](#3-ai-coding-agents-claude-code-antigravity-codex-cursor-workbuddy-dsh-harness-kimi-code-minimax-code-zcode) |
| **Minimax Code** | ✅ Tested | **Prompt Auto-Setup** or `mcp.json` (Local / Direct LAN `--allow-lan` / SSH / HTTPS) | [3. AI Coding Agents](#3-ai-coding-agents-claude-code-antigravity-codex-cursor-workbuddy-dsh-harness-kimi-code-minimax-code-zcode) |
| **ZCode** | ✅ Tested | **Prompt Auto-Setup** or `mcp.json` (Local / Direct LAN `--allow-lan` / SSH / HTTPS) | [3. AI Coding Agents](#3-ai-coding-agents-claude-code-antigravity-codex-cursor-workbuddy-dsh-harness-kimi-code-minimax-code-zcode) |
| **Doubao (豆包)** | ✅ Tested | **Direct HTTPS** or **Secure Tunnel** | [5. Claude & Doubao](#5-claude-app--doubao-豆包) |

**End-to-end validation (November 2026):** The project maintainer reports successful **read and write MCP operations** using **Antigravity, Cursor, Codex, DSH-Harness, ZCode, Minimax Code, WorkBuddy, and Kimi Code**. A separate WorkBuddy-to-Jetson test verified live tool discovery and read-only operations on Linux ARM64. The tested WorkBuddy desktop loader expects `"type": "streamable-http"`; remote entries accept only `type`, `url`, and optional `headers`. See the [WorkBuddy Linux / Jetson Use Case](use-cases/workbuddy-linux-jetson.md).

---

## 2. ChatGPT Web (Tunnel, Direct HTTPS & OAuth)

ChatGPT Web runs in the cloud and cannot connect to `http://127.0.0.1:18893/mcp` directly. Because both `tunnel-client` and Caddy run on your host and forward traffic to `127.0.0.1:18893` locally, Starmux itself only needs `starmux up` (or `starmux up --code`—no `--allow-lan` required). Choose either **Path A (Tunnel)** or **Path B (Direct HTTPS / Server URL)**:

| | **Path A: OpenAI Secure MCP Tunnel** *(No Domain / Behind NAT)* | **Path B: Direct HTTPS or Cloudflare Tunnel** *(Server URL)* |
| :--- | :--- | :--- |
| **Best for** | Home Wi-Fi, NAT/CGNAT, or hosts without a domain name | Hosts with a public IPv4/IPv6 + domain (Caddy), or Cloudflare Tunnel |
| **Inbound ports** | ❌ None *(outbound connection from your host to `127.0.0.1:18893`)* | ✅ Inbound `TCP 443` for Caddy *(or none for Cloudflare Tunnel)* |
| **ChatGPT "Connection" tab** | Switch to **Tunnel (隧道)** and select/enter `tunnel_<ID>` | Keep **Server URL (服务器 URL)** and enter `https://mcp.example.com/mcp` |

### Path A — Connect ChatGPT Web via OpenAI Secure MCP Tunnel

1. **Create a Tunnel in OpenAI Platform:**
   Visit [OpenAI Platform Tunnel Settings](https://platform.openai.com/settings/organization/tunnels), create a Tunnel in the organization linked to your ChatGPT workspace (`Tunnels Read + Manage`), and save your `tunnel_id` and restricted runtime API key (see [OpenAI Secure MCP Tunnel Docs](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)).
2. **Start Starmux and `tunnel-client` on your machine:**
   ```bash
   starmux up --code

   export MAC_MCP_TUNNEL_KEY="your_restricted_runtime_api_key"
   tunnel-client run \
     --control-plane.tunnel-id "tunnel_YOUR_TUNNEL_ID" \
     --control-plane.api-key "env:MAC_MCP_TUNNEL_KEY" \
     --mcp.server-url "http://127.0.0.1:18893/mcp" \
     --health.listen-addr "127.0.0.1:18891" \
     --log.level info
   ```
   *(Behind a local HTTP proxy? Append `--control-plane.http-proxy "http://127.0.0.1:PROXY_PORT"`.)*
3. **Add the connector in ChatGPT Web:**
   Open **ChatGPT Web → Plugins / Settings → + → Add custom MCP server**, choose **Connection: Tunnel**, select your Tunnel, and create the connector.

### Path B — Connect ChatGPT Web via Direct HTTPS

1. Point your domain's DNS `A` or `AAAA` record (e.g., `mcp.example.com`) to your machine's public IP and forward `/mcp` to `127.0.0.1:18893` using Caddy (see [Installation & Networking — Option A](INSTALL.md#42-option-a--direct-proxy-with-caddy-public-domain-custom-port-ipv6-or-lan)).
2. Open **ChatGPT Web → Plugins / Settings → + → Add custom MCP server** and enter `https://mcp.example.com/mcp`.

### Configuring OAuth 2.0 in ChatGPT Web

When using OAuth 2.0 browser sign-in with ChatGPT Web, first deploy Keycloak following **[Security & Authentication — OAuth 2.0](SECURITY.md#4-oauth-20--pkce-oauth-with-keycloak)**, then enter these values in ChatGPT:

| ChatGPT Field | Value to Enter |
| :--- | :--- |
| **Authentication** | `OAuth` |
| **Client registration** | `Custom / provided OAuth client` *(do not select DCR or CIMD)* |
| **Callback URL** | Must match the `--callback` URL passed to `starmux auth oauth init-keycloak` |
| **OAuth client ID** | `gateway-chatgpt` |
| **OAuth client secret** | Paste the secret generated by Keycloak for `gateway-chatgpt` |
| **Token endpoint authentication** | `client_secret_basic` |
| **Base / Default scopes** | `gateway:access` |
| **Authorization server base / Issuer** | `https://auth.example.com/realms/gateway` |
| **Resource** | `https://auth.example.com/mcp` |
| **PKCE** | `S256` |
| **OIDC / domain claim** | Leave disabled |

*(Authorization URL `{issuer}/protocol/openid-connect/auth` and Token URL `{issuer}/protocol/openid-connect/token` are populated automatically via discovery.)*

#### Special Step for OAuth 2.0 + OpenAI Secure MCP Tunnel (`--resource-aliases`)
When pairing OAuth 2.0 with `tunnel-client` (`0.0.16+`):
1. Run `tunnel-client` with `--mcp.server-url url=https://auth.example.com/mcp` and `--mcp.oauth-trusted-origin https://auth.example.com`.
2. In ChatGPT, select your Tunnel and trigger OAuth metadata discovery.
3. Because Tunnel discovery rewrites the MCP resource identifier, copy the exact discovered **Resource** URL shown in ChatGPT:
   - In Keycloak (`gateway` realm), create a bearer-only OIDC client (e.g., `gateway-tunnel-resource`) with attribute `resource_url` equal to that exact URL, and add an **Audience** mapper in client scope `gateway:access` granting `gateway-tunnel-resource`.
   - Re-run `starmux auth oauth setup` with `--resource-aliases 'EXACT_DISCOVERED_RESOURCE_URL'` appended, then run `starmux auth oauth doctor`.

---

## 3. AI Coding Agents (Claude Code, Antigravity, Codex, Cursor, WorkBuddy, DSH-Harness, Kimi Code, Minimax Code, ZCode)

**WorkBuddy + Linux / Jetson:** See the [WorkBuddy remote Linux / NVIDIA Jetson guide](use-cases/workbuddy-linux-jetson.md) for direct LAN access with `--allow-lan`, HTTPS setup, auto-configuration prompt, manual MCP JSON, and LAN versus public HTTPS access.

All mainstream agentic coding clients—including **Claude Code**, **Antigravity**, **Codex**, **Cursor**, **WorkBuddy**, **DSH-Harness**, **Kimi Code**, **Minimax Code**, and **ZCode**—support Starmux's `streamable-http` MCP endpoint.

### Fastest Setup: Ask Your AI Agent to Configure Itself (Prompt Auto-Setup)

You don't even need to locate your client's config file manually. Just paste the following prompt into your AI coding agent's chat box (replace `127.0.0.1:18893` with your LAN/Tailscale IP or domain if connecting remotely):

```text
Create this MCP Server connector:
"starmux": {
  "type": "streamable-http",
  "url": "http://127.0.0.1:18893/mcp"
}
```

The AI agent will automatically write the configuration into its own `mcp.json` / MCP settings and connect to Starmux.

---

### Manual `mcp.json` Configuration Scenarios

If you prefer editing your client's JSON configuration file directly (e.g., `~/.workbuddy/mcp.json` or `.cursor/mcp.json`), choose the template matching your network setup. Protect files containing API keys with owner-only permissions (`chmod 600`).

#### Scenario A — Same Computer (`localhost`) or Direct LAN / Tailscale (`--allow-lan`)

- **On the Same Computer (`starmux up`):**
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

- **Across LAN / Tailscale / WireGuard (`starmux up --allow-lan` — no Caddy or tunnel needed):**
  ```json
  {
    "mcpServers": {
      "starmux": {
        "type": "streamable-http",
        "url": "http://192.168.50.114:18893/mcp"
      }
    }
  }
  ```

#### Scenario B — Laptop Client $\rightarrow$ Remote Linux / NVIDIA Jetson via SSH

Many desktop AI clients only ship macOS and Windows apps. You can run your AI client on your laptop and develop directly on a **Linux (`x64`/`ARM64`)** server or **NVIDIA Jetson** device over SSH with zero domain or TLS setup:

1. On the Linux / Jetson host, start Starmux:
   ```sh
   starmux up --code
   ```
2. On your laptop, forward local port `18894` to the remote host's `127.0.0.1:18893`:
   ```sh
   ssh -N -o ExitOnForwardFailure=yes \
     -L 127.0.0.1:18894:127.0.0.1:18893 \
     -p 2222 nvidia@192.168.1.2
   ```
3. In your laptop AI client's `mcp.json`, add:
   ```json
   {
     "mcpServers": {
       "nvidia-nx": {
         "type": "streamable-http",
         "url": "http://127.0.0.1:18894/mcp"
       }
     }
   }
   ```

#### Scenario C — Internet / Public HTTPS or Tunnel (with Bearer API Key)

1. On the target host running Starmux, generate a Bearer API key:
   ```sh
   starmux auth key "My AI Agent"
   ```
2. Expose Starmux via [Caddy HTTPS or a Tunnel](INSTALL.md#4-remote-network-forwarding--ingress-engineering).
3. Merge this entry into your client's `mcp.json`:
   ```json
   {
     "mcpServers": {
       "starmux": {
         "type": "streamable-http",
         "url": "https://mcp.example.com/mcp",
         "headers": {
           "Authorization": "Bearer smx_REPLACE_WITH_YOUR_API_KEY"
         }
       }
     }
   }
   ```

---

## 4. Codex CLI (`config.toml`)

You can either ask Codex in chat to add the `starmux` MCP connector, or configure it in `config.toml`:

- **Without API Key (Local / Direct LAN `--allow-lan` / Tailscale / SSH):**
  ```toml
  [mcp_servers.starmux]
  url = "http://192.168.50.114:18893/mcp"
  ```
- **With Bearer API Key (Public HTTPS / Tunnel):**
  ```toml
  [mcp_servers.starmux]
  url = "https://mcp.example.com/mcp"
  bearer_token_env_var = "STARMUX_TOKEN"
  ```
  Export `STARMUX_TOKEN=smx_YOUR_GENERATED_API_KEY` in the shell environment where you launch Codex. See [official Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

---

## 5. Claude App & Doubao (豆包)

- **Claude App:** Add a Remote MCP Custom Connector using Transport `Streamable HTTP` and your `https://mcp.example.com/mcp` URL (or `http://127.0.0.1:18893/mcp` locally). See [Claude's custom connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).
- **Doubao (豆包):** Connect via Direct HTTPS or a Secure Tunnel using `Streamable HTTP` and your `/mcp` endpoint URL.

---

[Documentation Index](README.md) · [Installation & Networking](INSTALL.md) · [Gateway & Middleware](GATEWAY.md) · [Security & Authentication](SECURITY.md) · [Multi-Instance & Config](INSTANCES.md)
