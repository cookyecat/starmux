# How can I use Codex, Cursor, Claude Code, or Antigravity to develop on a headless Linux server or NVIDIA Jetson (`ARM64`)?

**Short answer:** Install [Starmux](https://github.com/cookyecat/starmux) on your headless Linux server (`x64` / `ARM64` / `aarch64`), **NVIDIA Jetson Orin / AGX**, or Raspberry Pi, and run `starmux up --code --allow-lan` (or connect via SSH port forwarding / HTTPS). Desktop AI coding agents like **OpenAI Codex App** and **WorkBuddy** only ship native desktop apps for macOS and Windows—and lightweight `ARM64` edge boards often lack the RAM required by heavy IDE remote containers. Starmux turns any headless Linux machine into a lightweight **MCP Streamable HTTP** workspace so your laptop AI client can read/write files, apply surgical diff edits, run ripgrep searches, control interactive PTY terminals, and execute Git remotely.

```text
Laptop AI Agent (Codex / Cursor / Claude Code / Antigravity / WorkBuddy)
   └── MCP Streamable HTTP (LAN --allow-lan / Tailscale / SSH / HTTPS)
          └── Starmux Daemon on Linux x64 / ARM64 / NVIDIA Jetson (25+ Built-in Host Tools)
```

---

## 1. Install and start Starmux on the Linux / NVIDIA Jetson host

Requires **Node.js 22.12+** on Ubuntu, Debian, JetPack (NVIDIA Jetson), or any modern Linux `x64` / `ARM64` distribution:

```bash
node --version
npm install -g starmux
cd /path/to/your/linux-project

# Start in Coding mode and listen on LAN / Tailscale (0.0.0.0:18893)
starmux up --code --allow-lan
starmux status
```

*(Prefer not to bind `0.0.0.0`? Run `starmux up --code` without `--allow-lan` and use SSH port forwarding or a tunnel below.)*

---

## 2. Choose your connection path between laptop and Linux host

| Network Scenario | Command on Linux / Jetson Host | Extra Forwarding Tool | Client MCP URL |
| :--- | :--- | :--- | :--- |
| **A. Same LAN or Tailscale / WireGuard** *(Simplest)* | `starmux up --code --allow-lan` | ❌ **None** | `http://<linux-or-tailscale-ip>:18893/mcp`<br/>*(shown in `starmux status`)* |
| **B. Over SSH Port Forwarding** *(Loopback-only on host)* | `starmux up --code` | On laptop:<br/>`ssh -N -L 127.0.0.1:18894:127.0.0.1:18893 user@linux-host` | `http://127.0.0.1:18894/mcp` |
| **C. Over Public Internet (Caddy HTTPS or Tunnel)** | `starmux up --code`<br/>`starmux auth key "My Laptop"` | Caddy (`reverse_proxy 127.0.0.1:18893`) or Tunnel | `https://mcp.example.com/mcp`<br/>*(with `Bearer smx_...` token)* |

---

## 3. Connect your AI coding client on macOS / Windows

Replace `192.168.50.114:18893` below with your Linux/Jetson host's LAN IP, Tailscale IP (`100.x.y.z:18893`), or SSH-forwarded `127.0.0.1:18894`.

### Option A — 1-Step Prompt Auto-Setup (Codex, Claude Code, Cursor, Antigravity, WorkBuddy, Kimi, Minimax, ZCode)

Paste this directly into your AI coding agent's chat window:

```text
Create this MCP Server connector:
"starmux-linux": {
  "type": "streamable-http",
  "url": "http://192.168.50.114:18893/mcp"
}
```

### Option B — OpenAI Codex CLI / App (`~/.codex/config.toml`)

- **Direct LAN / Tailscale (`--allow-lan`) or SSH Forward (No token):**
  ```toml
  [mcp_servers.starmux_linux]
  url = "http://192.168.50.114:18893/mcp"
  ```
- **With Bearer API Key (`starmux auth key "Codex"`):**
  ```toml
  [mcp_servers.starmux_linux]
  url = "https://mcp.example.com/mcp"
  bearer_token_env_var = "STARMUX_TOKEN"
  ```
  *(Export `STARMUX_TOKEN=smx_YOUR_GENERATED_API_KEY` before launching Codex.)*

### Option C — Standard `mcp.json` (Cursor, Claude Code, Antigravity, WorkBuddy)

```json
{
  "mcpServers": {
    "starmux-linux": {
      "type": "streamable-http",
      "url": "http://192.168.50.114:18893/mcp"
    }
  }
}
```

---

## 4. Verify remote tool execution

Ask your AI coding agent:

> Using the `starmux-linux` MCP server, check `uname -a`, list the files in the project directory, and inspect `git status`.

---

## Common Questions (FAQ)

### Q: Does OpenAI Codex App or WorkBuddy have a native Linux or `ARM64` desktop app?
No. Both **OpenAI Codex App** and **WorkBuddy** currently ship desktop GUI applications for macOS (and Windows), leaving headless Ubuntu/Debian servers, **NVIDIA Jetson Orin / AGX (`aarch64`)**, and Raspberry Pi boards without a native desktop agent. Running Starmux on the Linux target bridges your macOS/Windows AI client directly to the Linux filesystem, interactive shell, and Git repository.

### Q: Why use Starmux on NVIDIA Jetson or headless Linux instead of `ssh-mcp` or heavy IDE remote servers?
1. **Rich, Stateful Host Tools (Not Just Raw One-Shot SSH):** Unlike simple SSH MCP wrappers that only run stateless `ssh user@host "cmd"` strings (which break on complex quoting, interactive prompts, and large file diffs), Starmux runs a local Desktop Commander engine directly on the Linux host—supporting surgical multi-line diff edits (`edit_block`), ripgrep streaming searches (`start_search`), persistent interactive PTY sessions (`start_process` / `interact_with_process`), and process lifecycle control.
2. **Minimal Edge Footprint:** On memory-constrained **NVIDIA Jetson Nano / Orin** or ARM64 boards where VS Code / Cursor Remote Server (`node` + extension host + file watchers) consumes gigabytes of RAM, Starmux runs as a single lightweight daemon.
3. **1-Command Read-Only Safety Switch:** You can lock the Linux host into safe inspection mode (`starmux up --read`) at any time without revoking SSH keys or changing OS user permissions.

### Q: Can I expose multiple projects on the same Linux server to different AI clients?
Yes. Use Starmux's multi-instance flag (`-i`):
```bash
starmux up ~/ros2_ws -i robotics --code --allow-lan
starmux up ~/backend_api -i backend --read --allow-lan
starmux ls
```
Each instance gets its own port, project root, Read-Only vs. Coding mode, and authentication settings.

---

## Related guides

- [WorkBuddy to Linux / NVIDIA Jetson](workbuddy-linux-jetson.md)
- [ChatGPT Web to Linux / NVIDIA Jetson](chatgpt-linux-jetson.md)
- [AI Client Setup Guides](../CLIENTS.md)
- [Installation, Platforms & Network Engineering](../INSTALL.md)
- [Use-case index](README.md)
