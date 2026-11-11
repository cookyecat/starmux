# How can I use Desktop Commander remotely from ChatGPT or another AI client?

**Short answer:** Use [Starmux](https://github.com/cookyecat/starmux) as a 100% self-hosted, zero-telemetry MCP gateway on the computer you want to operate. Starmux bundles a purified Desktop Commander tool engine (stripped of all upstream telemetry, phone-home tracking, and cloud-relay code at build time), so remote MCP clients can access file and development tools directly without setting up the official **Remote Desktop Commander hosted service**.

This is an **independent integration approach**, not a replacement-backend setting in Desktop Commander's official ChatGPT plugin.

## 1. Start the tool host

On your macOS, Windows or Linux computer (Node.js **22.12+**):

```bash
npm install -g starmux
cd /path/to/your/project
starmux up
starmux verify
starmux status
```

The gateway listens at `http://127.0.0.1:18893/mcp` on the machine running Starmux. The default read-only mode permits appropriate file reads and discovery while blocking writes and shell execution. Starmux does not install the official Remote Desktop Commander cloud service.

## 2. Connect your AI client to that computer

- **If your AI coding client runs on the same host:** Connect directly to `http://127.0.0.1:18893/mcp`.
- **If the client runs on another machine on the same LAN or Tailscale / WireGuard:** Run `starmux up --allow-lan` on the host and connect directly to `http://<lan-or-tailscale-ip>:18893/mcp` (run `starmux status` to see the detected IP—no Caddy or tunnel needed).
- **If you prefer SSH port forwarding without opening `0.0.0.0`:** Keep `starmux up` on the host and run on your laptop:
  ```bash
  ssh -N -o ExitOnForwardFailure=yes \
    -L 127.0.0.1:18894:127.0.0.1:18893 \
    user@remote-host
  ```
  Then connect the laptop's MCP client to `http://127.0.0.1:18894/mcp`.
- **If the client is ChatGPT Web (cloud browser AI):** Keep `starmux up` (listening on `127.0.0.1:18893`) and forward `127.0.0.1:18893` via an OpenAI Secure MCP Tunnel (select **Tunnel `tunnel_...`** in ChatGPT) or your own protected HTTPS / Cloudflare Tunnel endpoint (enter **Server URL `https://.../mcp`**). Follow the [ChatGPT connection walkthrough](chatgpt-access-local-computer.md) or [AI Client Setup Guides](../CLIENTS.md).

## 3. Choose read-only or coding access

Start with a discovery task:

> List the tools available through my Starmux MCP connection, and read the README in the connected workspace.

If you intentionally want the agent to edit code, run commands or operate Git on your host, switch modes **on the host**:

```bash
starmux up --code
```

Coding mode runs tools with permissions available to your OS account. Keep public endpoints protected by API-key, OAuth or trusted upstream access control, and review the [Security Guide](../SECURITY.md) before authorizing remote tool execution.

## How Starmux compares to upstream `DesktopCommanderMCP` & the hosted Remote Desktop Commander service

| Capability | **Starmux** *(Self-Hosted & Zero-Telemetry)* | **Upstream `DesktopCommanderMCP`** *(`stdio`)* | **Official Hosted Remote Desktop Commander** |
| --- | --- | --- | --- |
| **Telemetry & Analytics** | ✅ **Zero telemetry** *(stripped at build time)* | ⚠️ Includes `track-installation` & telemetry | ⚠️ Vendor-managed cloud telemetry |
| **Cloud Relay Dependency** | ✅ **100% self-hosted** *(zero vendor relay)* | ✅ Local `stdio` | ❌ Routes through official cloud service |
| **Transport Protocol** | ✅ Native **`Streamable HTTP`** (`/mcp`) + `--allow-lan` | ❌ `stdio` only *(needs `supergateway` / `mcp-proxy` for HTTP)* | ✅ Hosted cloud endpoint |
| **Global Read-Only vs. Coding Mode** | ✅ 1-command switch (`--read` / `--code`) | ❌ No unified read-only gate | ⚠️ Vendor-defined |
| **Multi-MCP Gateway & Middleware** | ✅ Connect 12+ extra `stdio`/HTTP servers + middleware | ❌ Single server only | ❌ No |
| **Authentication** | ✅ Per-client Bearer API keys & self-hosted OAuth 2.0 | ❌ None | ✅ Vendor OAuth |

Starmux is not affiliated with or endorsed by Desktop Commander. Consult the upstream [Desktop Commander MCP repository](https://github.com/wonderwhy-er/DesktopCommanderMCP) for its own project documentation.

## Common Questions (FAQ)

### Q: Does Starmux send any telemetry, installation tracking, or usage data to Desktop Commander or third parties?
No. During Starmux's build pipeline (`scripts/vendor-desktop-commander.mjs`), all upstream telemetry and cloud modules—including `track-installation.js`, `capture.js`, `capture_call_tool`, `remote-device` cloud-relay hooks, and interactive onboarding/feedback surveys—are physically deleted and replaced with inert no-op stubs, verified by automated build tests (`tests/vendor-telemetry.test.mjs`).

### Q: Which Desktop Commander tools are built into Starmux out of the box?
Starmux bundles 25+ host tools across file operations (`read_file`, `read_multiple_files`, `write_file`, `create_directory`, `list_directory`, `move_file`, `get_file_info`, `write_pdf`), surgical code edits (`edit_block`), streaming ripgrep search (`start_search`, `get_more_search_results`, `stop_search`, `list_searches`), interactive PTY/Shell execution (`start_process`, `read_process_output`, `interact_with_process`, `force_terminate`, `list_sessions`), system process management (`list_processes`, `kill_process`), and runtime diagnostics (`get_config`, `set_config_value`, `get_recent_tool_calls`).

### Q: Do I need `supergateway`, `mcp-proxy`, or Caddy to use Desktop Commander across my LAN or Tailscale?
No. Starmux natively serves Desktop Commander over **MCP Streamable HTTP** (`/mcp`). On a trusted LAN or Tailscale network, simply run `starmux up --code --allow-lan` and point your AI client to `http://<lan-or-tailscale-ip>:18893/mcp`.

## Related guides

- [Run a self-hosted remote MCP gateway](self-hosted-remote-mcp-gateway.md).
- [Expose `stdio` MCP servers over HTTP & aggregate multiple servers](stdio-to-http-multi-mcp-gateway.md).
- [ChatGPT to a local computer](chatgpt-access-local-computer.md).
- [Installation & networking](../INSTALL.md) · [Security & authentication](../SECURITY.md).
