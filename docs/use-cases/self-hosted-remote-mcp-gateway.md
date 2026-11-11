# How do I self-host a remote MCP gateway?

**Short answer:** Install [Starmux](https://github.com/cookyecat/starmux) on a computer that owns the tools you want AI clients to use. It provides a local **Streamable HTTP MCP** endpoint, built-in Desktop Commander tools and optional routes to additional local `stdio` MCP servers. You choose how clients reach the endpoint: local access, SSH forwarding, your own HTTPS ingress, or a compatible tunnel.

This is useful when you want your own computer, workstation, Linux server or NVIDIA Jetson to run the tools instead of moving your files or execution environment into an AI vendor's cloud.

## 1. Run the gateway on your machine

Requires Node.js **22.12+**:

```bash
npm install -g starmux
cd /path/to/your/project
starmux up
starmux verify
starmux status
```

The default MCP endpoint is `http://127.0.0.1:18893/mcp`. It listens on **loopback**, not the public network. The default is read-only; intentionally opt into coding permissions with `starmux up --code` when needed.

## 2. Choose your remote connection

Because SSH port forwarding, tunnels (`tunnel-client` / `cloudflared`), and Caddy all forward traffic to `127.0.0.1:18893` locally on the host, **only direct LAN / Tailscale connections across machines require `--allow-lan`**:

| Your situation | Starmux command | Suggested connection | Extra dependency |
| --- | --- | --- | --- |
| AI client on the same machine | `starmux up` *(or `--code`)* | `http://127.0.0.1:18893/mcp` | None |
| Two machines on the same LAN or Tailscale / WireGuard | `starmux up --code --allow-lan` | `http://<lan-or-tailscale-ip>:18893/mcp` | None (no Caddy needed) |
| AI coding client on your laptop; tools on an SSH-accessible host | `starmux up --code` | `http://127.0.0.1:18894/mcp` (via `ssh -L`) | SSH access to the host |
| Cloud AI client; computer behind NAT/CGNAT (no domain) | `starmux up --code` | OpenAI Tunnel (`tunnel_...`) or Cloudflare Tunnel URL | Selected tunnel client |
| Cloud AI client; public domain or reachable IPv6/IPv4 | `starmux up --code` | `https://mcp.example.com/mcp` (via Caddy) | DNS, TLS and Caddy |

For example, on a trusted LAN or Tailscale virtual network, simply run `starmux up --code --allow-lan` on the host and connect your remote desktop AI client directly to `http://<lan-or-tailscale-ip>:18893/mcp` (run `starmux status` to see the detected IP).

Alternatively, if you prefer SSH port forwarding without opening `0.0.0.0`, keep `starmux up --code` on the remote server and execute this on your **laptop**:

```bash
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:18894:127.0.0.1:18893 \
  user@remote-host
```

Then point a laptop-based MCP client to `http://127.0.0.1:18894/mcp`. Replace `user@remote-host` with your actual SSH destination.

A browser-hosted cloud client such as ChatGPT Web **cannot use your LAN IP or laptop's localhost forward directly**; configure an outbound tunnel or HTTPS endpoint instead. See [Installation & Networking](../INSTALL.md) and [AI Client Setup Guides](../CLIENTS.md).

## 3. Secure remote ingress

For an AI client that supports Bearer tokens, create a key:

```bash
starmux auth key "My AI Client"
```

This enables API-key authentication on that instance. Enter the emitted token into the client's secure MCP connection settings. For clients requiring browser login, use the documented OAuth 2.0 / Keycloak setup. Never rely on HTTPS encryption alone as caller authentication.

Starmux does not expose its local management dashboard as part of the remote `/mcp` endpoint. Keep management and authentication secrets private; see [Security & Authentication](../SECURITY.md).

## 4. Optionally connect additional MCP servers & middleware

A Starmux instance includes Desktop Commander-based tools and can unify **up to 12 additional local `stdio` or remote HTTP/SSE MCP upstreams**. Additional tools are namespaced (`<serverId>__<toolName>`), and each upstream has an explicit `allowTools` list:

```bash
starmux server add 'npx --yes @modelcontextprotocol/server-memory' --name memory
starmux server add 'https://your-server.example/mcp' --name remote
starmux server import ./mcp.json --prepare
```

You can also manage servers and programmable middleware visually from `starmux dashboard`. See [Gateway Services & Programmable Middleware](../GATEWAY.md) and [Multiple Instances & Configuration](../INSTANCES.md).

## What is actually self-hosted?

Starmux and its tool execution run on **your machine**. A direct, owner-operated HTTPS path does not require a vendor-hosted MCP relay. Choosing a provider-operated tunnel is convenient behind NAT, but that transport **does depend on the tunnel provider**. Starmux does not require replacing the official Remote Desktop Commander ChatGPT plugin or its hosted backend.

For multiple computers, deploy and connect to the appropriate Starmux instance on each host; don't assume that several installations form one central cross-machine control plane.

## Common Questions (FAQ)

### Q: Why use Starmux instead of manually wiring `DesktopCommanderMCP + supergateway + MCPHub + Caddy`?
Assembling a remote MCP stack from separate open-source tools requires maintaining 4 independent layers: a `stdio` host tool server, a `stdio`-to-HTTP transport adapter, an authentication/aggregation gateway, and a reverse proxy or supervisor. Starmux combines all four—25+ built-in zero-telemetry host tools, a native `Streamable HTTP` listener (`--allow-lan`), per-client Bearer API keys / OAuth 2.0, and a multi-MCP gateway with programmable middleware—into a single `starmux up` daemon.

### Q: When do I need `--allow-lan` vs. plain `starmux up`?
Only direct cross-machine connections over LAN, Tailscale, or WireGuard (`http://<lan-or-tailscale-ip>:18893/mcp`) require `starmux up --allow-lan`. Because SSH port forwarding (`sshd`), tunnel clients (`tunnel-client` / `cloudflared`), and Caddy all run on the Starmux host and forward traffic to `127.0.0.1:18893` locally, plain `starmux up` (or `starmux up --code`) is all you need for localhost, SSH, tunnels, and public HTTPS.

### Q: Can I switch between Read-Only mode and Coding mode without reconfiguring my AI client?
Yes. Run `starmux up --read` or `starmux up --code` on the host at any time. The `/mcp` endpoint URL and client credentials stay unchanged while Starmux updates its active permission boundary and tool catalog.

**Next:** [Expose `stdio` MCP servers over HTTP & aggregate multiple servers](stdio-to-http-multi-mcp-gateway.md) · [How ChatGPT accesses local files](chatgpt-access-local-computer.md) · [Desktop Commander remotely](remote-desktop-commander.md) · [Full networking guide](../INSTALL.md).
