# How can ChatGPT access a Linux server or NVIDIA Jetson remotely?

**Short answer:** Install [Starmux](https://github.com/cookyecat/starmux) on the **Linux server or NVIDIA Jetson** whose files and tools you want to use. Connect ChatGPT Web to the Starmux MCP endpoint through **OpenAI Secure MCP Tunnel** or a protected **Direct HTTPS** endpoint. You do not need a native ChatGPT application on that Linux/ARM64 host.

Starmux runs the MCP server and Desktop Commander-derived tools **on your own computer**. ChatGPT supplies the AI interface; tool execution takes place on the target host.

## 1. Run Starmux on the Linux or Jetson host

Requires Node.js **22.12+**. The Starmux Core and CLI support Linux x64 and ARM64, including NVIDIA Jetson devices.

~~~bash
node --version
npm install -g starmux
cd /path/to/your/project
starmux up
starmux verify
starmux status
~~~

Starmux listens on `http://127.0.0.1:18893/mcp` **on that machine**, not on every network interface. The default is **read-only**. When you deliberately want the AI to edit files or run shell/Git commands, enable Coding mode **on the tool host** with `starmux up --code`.

The project path organizes operations; it is not a filesystem sandbox. Files and processes remain subject to the host OS account's permissions.

## 2. Make the host reachable from ChatGPT Web

ChatGPT Web runs in the cloud. Its `127.0.0.1` is **not** the localhost address of your Linux or Jetson machine.

| Network situation | Recommended path | Client connection |
| --- | --- | --- |
| Jetson or home server behind NAT/CGNAT | **OpenAI Secure MCP Tunnel** | Select the registered Tunnel in ChatGPT. |
| Linux server with a reachable public IP and domain | **Direct HTTPS** with a reverse proxy | Connect to `https://mcp.example.com/mcp`. |
| MCP coding client on a laptop with SSH access | **SSH local port forwarding** | Connect that laptop client to its forwarded localhost port (not directly usable by ChatGPT Web). |

### Option A: OpenAI Secure MCP Tunnel

Create a Tunnel and restricted runtime API key using [OpenAI's tunnel documentation](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels). With Starmux running, execute this on the **Linux/Jetson host**:

~~~bash
export MAC_MCP_TUNNEL_KEY="your_restricted_runtime_api_key"

tunnel-client run \
  --control-plane.tunnel-id "tunnel_YOUR_TUNNEL_ID" \
  --control-plane.api-key "env:MAC_MCP_TUNNEL_KEY" \
  --mcp.server-url "http://127.0.0.1:18893/mcp" \
  --health.listen-addr "127.0.0.1:18891" \
  --log.level info
~~~

Select that Tunnel in ChatGPT's custom MCP connection setup. Tunnel availability depends on your ChatGPT/OpenAI configuration. **Tool execution remains self-hosted; the OpenAI tunnel transport depends on OpenAI infrastructure.**

### Option B: Your own HTTPS endpoint

On a publicly reachable host, point your domain to the host and reverse-proxy HTTPS to Starmux using Caddy:

~~~caddyfile
mcp.example.com {
    handle /mcp {
        reverse_proxy 127.0.0.1:18893
    }
    handle {
        respond "Not found" 404
    }
}
~~~

Connect ChatGPT to `https://mcp.example.com/mcp`. Before exposing the endpoint publicly, configure **OAuth or another effective authentication layer**; HTTPS encryption alone does not authenticate callers. See [Installation & Networking](../INSTALL.md) and [ChatGPT Web configuration](../CLIENTS.md).

## 3. Verify from the real ChatGPT conversation

After `starmux verify` succeeds on the host, ask ChatGPT:

> List the tools available through my Starmux connection, then list filenames in my Linux/Jetson project directory. Do not modify anything.

A local health check does **not** prove ChatGPT's remote connection is working. Verify an actual read-only MCP tool invocation from the cloud client.

## Alternative: an AI coding client on your laptop

For **Cursor**, **Claude Code**, **Codex**, **WorkBuddy**, or another laptop-based MCP client:

- **Direct over LAN / Tailscale (simplest):** Run `starmux up --code --allow-lan` on the Linux/Jetson host and connect your laptop client directly to `http://<linux-or-jetson-ip>:18893/mcp` (run `starmux status` to see the detected IP).
- **Via SSH port forwarding (without opening `0.0.0.0`):** Keep `starmux up --code` on the Linux/Jetson host and run **on your laptop**:
  ~~~bash
  ssh -N -o ExitOnForwardFailure=yes \
    -L 127.0.0.1:18894:127.0.0.1:18893 \
    user@linux-host
  ~~~
  Then connect your laptop client to `http://127.0.0.1:18894/mcp`.

*(Neither LAN IPs nor laptop-local SSH forwards are directly reachable from ChatGPT Web in the cloud.)*

## Common Questions (FAQ)

### Q: Does Starmux run natively on `ARM64` (`aarch64`) Linux boards like NVIDIA Jetson Orin or Raspberry Pi?
Yes. Starmux Core and CLI (`npm install -g starmux`) support both Linux `x64` (`amd64`) and `ARM64` (`aarch64`)—including **NVIDIA Jetson Orin / AGX / Nano** running Ubuntu/JetPack and Raspberry Pi OS (64-bit)—with Node.js `22.12+`.

### Q: Do I need `--allow-lan` on my Linux or Jetson machine when connecting ChatGPT Web via OpenAI Tunnel or Caddy?
No. Because `tunnel-client` and Caddy run locally on the Linux/Jetson host and forward traffic to `127.0.0.1:18893`, you only need `starmux up` (or `starmux up --code`). Use `--allow-lan` only when connecting a desktop AI client (like Codex, Cursor, or WorkBuddy) directly across your LAN or Tailscale network.

## Related guides

- [Codex, Cursor & Claude Code to Linux / NVIDIA Jetson](codex-cursor-linux-jetson.md)
- [WorkBuddy to Linux / NVIDIA Jetson](workbuddy-linux-jetson.md)
- [ChatGPT accessing a local computer](chatgpt-access-local-computer.md)
- [MCP behind NAT: HTTPS vs Tunnel](mcp-behind-nat-https-vs-tunnel.md)
- [AI Client Setup Guides](../CLIENTS.md)
- [Permissions and authentication](../SECURITY.md)
- [Use-case index](README.md)
