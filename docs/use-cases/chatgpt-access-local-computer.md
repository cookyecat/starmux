# How can ChatGPT access files and tools on my local computer?

**Short answer:** Run [Starmux](https://github.com/cookyecat/starmux) on the computer you want to access, then connect ChatGPT to its MCP endpoint through **OpenAI Secure MCP Tunnel** or your own **HTTPS reverse proxy**. Starmux exposes local file and development tools through the Model Context Protocol (MCP). You can start in read-only mode before choosing whether to allow edits or shell commands.

## 1. Start Starmux on the target computer

Install [Node.js 22.12 or newer](https://nodejs.org/) and run:

```bash
npm install -g starmux
cd /path/to/your/project
starmux up
starmux verify
starmux status
```

Starmux starts a local MCP endpoint at `http://127.0.0.1:18893/mcp` by default. `starmux up` uses **read-only mode**; use `starmux up --code` only if you intend to grant file-writing and shell/Git execution using the host OS account's permissions.

> **Important:** The default project directory helps organize operations, but it is **not a filesystem sandbox**. Read-only mode prevents writes and shell execution; files still depend on the permissions of the OS account and upstream tools.

## 2. Make the MCP endpoint reachable from ChatGPT

**ChatGPT Web runs in the cloud.** It cannot reach the `127.0.0.1` address on your computer directly. Choose one route:

| Connection | Best when | How it works |
| --- | --- | --- |
| **OpenAI Secure MCP Tunnel** | Your computer is behind NAT, CGNAT, or a firewall | A tunnel client on your machine connects outward; ChatGPT selects the registered Tunnel. |
| **Direct HTTPS** | You control a reachable domain and reverse proxy | ChatGPT connects to `https://mcp.example.com/mcp`, which forwards to local Starmux. |

### Option A — OpenAI Secure MCP Tunnel

Create a Tunnel and obtain its runtime key using the [OpenAI Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels). With Starmux running, start the tunnel client on the **same computer**:

```bash
export MAC_MCP_TUNNEL_KEY="your_restricted_runtime_api_key"

tunnel-client run \
  --control-plane.tunnel-id "tunnel_YOUR_TUNNEL_ID" \
  --control-plane.api-key "env:MAC_MCP_TUNNEL_KEY" \
  --mcp.server-url "http://127.0.0.1:18893/mcp" \
  --health.listen-addr "127.0.0.1:18891" \
  --log.level info
```

In ChatGPT's custom MCP connection setup, select **Tunnel** and choose the registered connection. Tunnel availability and permissions depend on your ChatGPT/OpenAI setup. This route relies on OpenAI's tunnel infrastructure; **Starmux itself remains self-hosted**.

### Option B — Direct HTTPS

Point a domain at your reachable host and configure a reverse proxy such as Caddy:

```caddyfile
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
```

In ChatGPT's custom MCP connection setup, enter `https://mcp.example.com/mcp` as the server URL. Before making an endpoint publicly reachable, configure **OAuth login or another effective upstream access-control layer**. Starmux can validate OAuth 2.0 tokens with a self-hosted Keycloak authorization server; the details are in [Security & Authentication](../SECURITY.md).

## 3. Verify from the actual ChatGPT conversation

After connecting the MCP server, ask ChatGPT:

> List the tools provided by my Starmux connection. Then show the names of files in my project directory, without modifying anything.

A successful local `starmux verify` is **not** proof that ChatGPT can reach the remote endpoint; confirm both the ChatGPT connection and an actual read-only tool call.

## Where to go next

- [ChatGPT Web setup: Tunnel, HTTPS and OAuth](../CLIENTS.md) — full client-specific instructions.
- [Installation & networking](../INSTALL.md) — DNS, NAT, Caddy, HTTPS, tunnels and troubleshooting.
- [Security & authentication](../SECURITY.md) — read-only vs coding permissions, API keys and OAuth.
- [Use-case index](README.md) · [Starmux on GitHub](https://github.com/cookyecat/starmux).
