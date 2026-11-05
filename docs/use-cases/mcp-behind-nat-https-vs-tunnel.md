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

| Situation | Connection | Inbound access | Tradeoff |
| --- | --- | --- | --- |
| Public IPv4/IPv6 and a domain | **Your own HTTPS reverse proxy** | Usually TCP 443 | You operate DNS, TLS, firewall and authentication. |
| NAT/CGNAT or inbound ports unavailable | **Outbound tunnel** | No inbound port required | Depends on tunnel provider and client compatibility. |
| Laptop AI coding client with SSH access | **SSH local forwarding** | SSH access only | Laptop-local forwarding is not reachable from ChatGPT Web. |
| Two machines on a trusted LAN | LAN proxy or SSH | LAN-specific | Restrict access to authorized clients. |

NAT, TLS encryption and an obscure hostname are **not substitutes for caller authentication**.

## 3. Option A — Direct HTTPS with Caddy

Point `mcp.example.com` to your publicly reachable host and configure a reverse proxy:

~~~caddyfile
{
    admin off
}
mcp.example.com {
    handle /mcp {
        reverse_proxy 127.0.0.1:18893 {
            header_up Host 127.0.0.1:18893
        }
    }
    handle {
        respond "Not found" 404
    }
}
~~~

The AI client's MCP URL is `https://mcp.example.com/mcp`. The `Host` rewrite matters because Starmux validates the HTTP authority. The example does not expose the local management dashboard.

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

## Related guides

- [Self-hosted Remote MCP gateway](self-hosted-remote-mcp-gateway.md)
- [ChatGPT accessing a local computer](chatgpt-access-local-computer.md)
- [ChatGPT to Linux / Jetson](chatgpt-linux-jetson.md)
- [OAuth for Remote MCP](self-hosted-mcp-oauth.md)
- [Detailed networking documentation](../INSTALL.md)
- [Use-case index](README.md)
