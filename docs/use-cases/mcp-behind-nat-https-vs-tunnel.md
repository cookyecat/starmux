# How do I connect an MCP server behind NAT? HTTPS vs Tunnel

**Short answer:** Run [Starmux](https://github.com/cookyecat/starmux) on the computer hosting your MCP tools. For a **publicly reachable domain/IP**, use an authenticated HTTPS reverse proxy. Behind **NAT, CGNAT or blocked inbound ports**, use an outbound tunnel compatible with your AI client. If your AI coding client is on a laptop and can SSH into the host, an **SSH local port forward** is often simpler.

Starmux provides a Streamable HTTP MCP server at `http://127.0.0.1:18893/mcp` by default, bound to loopback rather than a public interface.

## 1. Start with a locally working gateway

On the computer that owns the tools:

~~~bash
npm install -g starmux
cd /path/to/your/project
starmux up
starmux verify
starmux status
~~~

Start read-only. Check local MCP health and tool discovery before attempting a remote connection.

## 2. Pick the right remote access path

| Situation | Starmux Command | Connection | Inbound access | Tradeoff |
| --- | --- | --- | --- | --- |
| Two of your own machines (LAN or **Tailscale / WireGuard**) | `starmux up --allow-lan` | **Direct HTTP over LAN / Tailscale IP** (`http://<ip>:18893/mcp`) | LAN / Tailscale interface only | Simplest cross-machine setup; no Caddy or tunnel needed. |
| Laptop AI coding client with SSH access | `starmux up` | **SSH local forwarding** (`http://127.0.0.1:18894/mcp`) | SSH access only | Laptop-local forwarding is not reachable from ChatGPT Web. |
| Cloud AI (ChatGPT Web) behind NAT/CGNAT (no domain) | `starmux up` | **Outbound tunnel** (OpenAI Tunnel `tunnel_...` or Cloudflare Tunnel) | No inbound port required | Forwards to `127.0.0.1:18893` locally; depends on tunnel provider. |
| Cloud AI; public IPv4/IPv6 and a domain | `starmux up` | **Your own HTTPS reverse proxy** (`https://mcp.example.com/mcp`) | Usually TCP 443 | Caddy forwards to `127.0.0.1:18893` locally; you operate DNS, TLS and auth. |

NAT, TLS encryption and an obscure hostname are **not substitutes for caller authentication**.

## 3. Option A — Direct HTTPS with Caddy

Point `mcp.example.com` to your publicly reachable host and configure a reverse proxy:

~~~caddyfile
{
    admin off
}
mcp.example.com {
    handle /mcp {
        reverse_proxy 127.0.0.1:18893
    }
    handle {
        respond "Not found" 404
    }
}
~~~

The AI client's MCP URL is `https://mcp.example.com/mcp`. Starmux accepts the original public Host on MCP and discovery routes; no Host rewrite is needed. The example does not expose the local management dashboard.

**Secure the endpoint before publishing it.** Use a Starmux Bearer API key for clients that support one, OAuth for browser-login clients, or a trusted ingress that actually authenticates callers. If using OAuth, its public discovery/authorization routes need additional configuration; see [Security & Authentication](../SECURITY.md).

If your ISP uses IPv4 CGNAT, ordinary router port forwarding cannot create a public IPv4 path. Consider reachable IPv6 or a tunnel.

## 4. Option B — Outbound Secure MCP Tunnel

For **ChatGPT Web**, register an OpenAI Secure MCP Tunnel and obtain a restricted runtime API key. Run on the same machine as Starmux:

~~~bash
export MAC_MCP_TUNNEL_KEY="your_restricted_runtime_api_key"

tunnel-client run \
  --control-plane.tunnel-id "tunnel_YOUR_TUNNEL_ID" \
  --control-plane.api-key "env:MAC_MCP_TUNNEL_KEY" \
  --mcp.server-url "http://127.0.0.1:18893/mcp" \
  --health.listen-addr "127.0.0.1:18891" \
  --log.level info
~~~

Select the registered Tunnel in ChatGPT. The Tunnel uses OpenAI infrastructure; Starmux's MCP tools still run on your own host. The client must support the selected tunnel route.

Other providers, such as an owner-configured Cloudflare Tunnel, can expose a remote HTTPS MCP URL to compatible clients. Do not treat an unauthenticated public tunnel URL as production access control. See [Networking & Tunnels](../INSTALL.md).

## 5. Option C — SSH for a laptop-based MCP client

Run on your laptop, connecting to the Starmux host:

~~~bash
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:18894:127.0.0.1:18893 \
  user@remote-host
~~~

Connect your **laptop** AI client's MCP configuration to `http://127.0.0.1:18894/mcp`.

**ChatGPT Web cannot use your laptop's localhost forward:** it runs in a cloud environment and needs a reachable HTTPS endpoint or supported Tunnel.

## 6. Verify end-to-end

1. Run `starmux verify` locally on the host.
2. Confirm the proxy, tunnel or SSH forward is connected.
3. Configure your actual AI client using [Client Setup Guides](../CLIENTS.md).
4. From that client, discover tools and perform a harmless read-only operation.

If local verification succeeds but remote tool calls fail, first inspect the transport and authentication boundary, not just Starmux's process status.

## Common Questions (FAQ)

### Q: Why don't OpenAI Tunnel (`tunnel-client`), Cloudflare Tunnel (`cloudflared`), or Caddy require `--allow-lan`?
Because `tunnel-client`, `cloudflared`, and Caddy run on the same machine as Starmux and connect to `http://127.0.0.1:18893/mcp` over local loopback (`127.0.0.1`). You only need `starmux up --allow-lan` when a remote desktop AI client connects directly to your machine's LAN or Tailscale IP (`http://<lan-or-tailscale-ip>:18893/mcp`) without a local forwarder.

### Q: In ChatGPT Web, when should I choose the "Tunnel (隧道)" tab vs. the "Server URL (服务器 URL)" tab?
- Choose **Tunnel (隧道)** when using **OpenAI Secure MCP Tunnel** (`tunnel-client`)—then select or enter your `tunnel_<ID>` identifier.
- Choose **Server URL (服务器 URL)** when using **Caddy Direct HTTPS** or **Cloudflare Tunnel (`cloudflared`)**—then enter the full `https://<your-domain-or-tunnel>/mcp` URL.

### Q: Does Starmux require rewriting the HTTP `Host` header behind Caddy or a tunnel?
No. Starmux's client-facing routes (`/mcp`, `/healthz`, and `/.well-known/oauth-protected-resource*`) accept any single valid HTTP `Host` header (IPv4, domain name, or bracketed IPv6). Meanwhile, owner-only management routes (`/access`, `/dashboard`) strictly require both a `127.0.0.1` loopback socket peer and a localhost `Host` header, so they are never exposed by reverse proxies or tunnels.

## Related guides

- [Self-hosted Remote MCP gateway](self-hosted-remote-mcp-gateway.md)
- [ChatGPT accessing a local computer](chatgpt-access-local-computer.md)
- [ChatGPT to Linux / Jetson](chatgpt-linux-jetson.md)
- [OAuth for Remote MCP](self-hosted-mcp-oauth.md)
- [Detailed networking documentation](../INSTALL.md)
- [Use-case index](README.md)
