# How can I use WorkBuddy to control Linux or NVIDIA Jetson remotely?

**Short answer:** Install [Starmux](https://github.com/cookyecat/starmux) and Caddy **on the Linux server or NVIDIA Jetson**, then add its remote MCP endpoint to **WorkBuddy**. WorkBuddy runs on your usual computer, while files and tools are accessed **on the Linux host**. You do not have to install the WorkBuddy desktop application on Linux.

~~~text
WorkBuddy (your desktop) -> Caddy (Linux / Jetson) -> Starmux MCP -> Files / Terminal / Tools
~~~

This is a self-hosted MCP connection, not a hosted remote desktop service. The simplest **no-token** path is for a trusted private LAN; remote internet access should use **Direct HTTPS with authentication**.

## 1. Install Starmux on Linux / Jetson

Requires Node.js **22.12+**; Starmux supports Linux x64 and ARM64 (including NVIDIA Jetson).

~~~bash
node --version
npm install -g starmux
cd /path/to/your/project
starmux up
starmux verify
starmux status
~~~

The MCP endpoint on the Linux host is `http://127.0.0.1:18893/mcp` by default. The default **read-only** mode lets you verify file discovery and browsing. To intentionally grant edits, shell commands and development operations, run **on the Linux host**:

~~~bash
starmux up --code
~~~

Coding mode uses the Linux account's actual filesystem and process permissions. The project path is a working context, **not a filesystem sandbox**.

## 2. Expose Starmux with Caddy

Install [Caddy](https://caddyserver.com/docs/install) on the Linux/Jetson host according to your distribution. Choose one of these network options.

### A. Trusted LAN — quickest, without an MCP token

For a WorkBuddy computer **on the same trusted LAN** as the Linux host, suppose the Linux host IP is `192.168.1.2`. Run Caddy on **Linux**:

~~~bash
caddy run --adapter caddyfile --config - <<'EOF'
http://192.168.1.2 {
    handle /mcp {
        reverse_proxy 127.0.0.1:18893 {
            header_up Host 127.0.0.1:18893
        }
    }
    handle {
        respond "Not found" 404
    }
}
EOF
~~~

The WorkBuddy MCP URL is `http://192.168.1.2/mcp`. Replace the sample IP with the Linux host's actual LAN IP. Restrict port 80 to trusted LAN clients in your firewall. **Never port-forward an unauthenticated endpoint to the public internet.** For private-network HTTPS, configure a certificate trusted by the WorkBuddy computer and retain network access restrictions.

### B. Public Direct HTTPS — authentication required

If WorkBuddy needs to connect from outside your LAN, use a publicly reachable domain and an HTTPS reverse proxy. First create a Starmux API key **on Linux**:

~~~bash
starmux auth key "WorkBuddy"
~~~

Save the generated `smx_...` key privately. Point the domain's DNS to the reachable host and configure Caddy:

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

With TCP 443 reachable, WorkBuddy uses `https://mcp.example.com/mcp` **and** the key in the `Authorization` header. HTTPS encryption is not caller authentication; publishing an unauthenticated remote MCP endpoint could expose file tools, and Coding mode could expose shell execution. Direct HTTPS **does not require a third-party hosted MCP relay**, but it does require secure ingress.

See [Installation & Networking](../INSTALL.md) for Caddy, DNS, IPv6 and NAT, and [Security & Authentication](../SECURITY.md) for API keys and OAuth.

## 3. Configure MCP automatically in WorkBuddy

WorkBuddy supports a user-wide config file at `~/.workbuddy/mcp.json`, or a project-level `.workbuddy/mcp.json`. **Use `"type": "streamable-http"` in the tested WorkBuddy desktop build.** Its MCP loader was directly inspected and accepts remote transport types `"streamable-http"` or `"sse"`. The camelCase `"streamableHttp"` is unsupported and causes the server to be skipped, even though some online examples use it.

For the **trusted LAN** example, send WorkBuddy this instruction:

> Add the following MCP server to my WorkBuddy user-level MCP configuration (`~/.workbuddy/mcp.json`). Merge it with existing `mcpServers` entries—**keep the two existing entries and all their settings (including Authorization headers and disabled flags) unchanged**. Only add the new `linux-jetson` entry with `type` and `url`. Then check the connection, discover tools and make a harmless read-only tool call.
>
> ~~~json
> {
>   "mcpServers": {
>     "linux-jetson": {
>       "type": "streamable-http",
>       "url": "http://192.168.1.2/mcp"
>     }
>   }
> }
> ~~~

If WorkBuddy cannot edit its own configuration in the current session, use the manual method below. Change the address to the actual reachable Linux host before submitting the prompt.

## 4. Or configure the connection manually

Open WorkBuddy's **Connectors / MCP** configuration interface and add a custom MCP server, or edit `~/.workbuddy/mcp.json` directly. Menu labels can vary with WorkBuddy versions. **Merge** the entry below with any existing servers. In the tested WorkBuddy loader, a **remote** MCP entry accepts only `type`, `url` and optional `headers`; an unsupported extra key triggers `unknown remote field`. Leave other already-configured servers unchanged.

**Trusted LAN, no token:**

~~~json
{
  "mcpServers": {
    "linux-jetson": {
      "type": "streamable-http",
      "url": "http://192.168.1.2/mcp"
    }
  }
}
~~~

**Public Direct HTTPS, authenticated:**

~~~json
{
  "mcpServers": {
    "linux-jetson": {
      "type": "streamable-http",
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer smx_REPLACE_WITH_YOUR_PRIVATE_KEY"
      }
    }
  }
}
~~~

Configure the real key **privately** in WorkBuddy's MCP settings or local config file. Don't paste secrets into public repositories or shared AI conversations. Keep existing MCP entries when editing the file. **Transport compatibility:** This guide follows the verified WorkBuddy desktop loader, which accepts `"streamable-http"` and `"sse"` as remote transports. Do **not** use `"streamableHttp"` in this tested build; it causes `Skipping MCP server linux-jetson: unsupported transport`. Other clients and older online examples may differ.

## 5. Verify that WorkBuddy can use the Linux host

On Linux, confirm `starmux verify` and `starmux status` succeed. Then ask WorkBuddy:

> Connect to the `linux-jetson` MCP server. Show the available tools and list files in the connected Linux project directory. **Do not modify files or run shell commands.**

A local Starmux health check does **not** prove that WorkBuddy has connected: verify an actual MCP tool call in WorkBuddy. If you explicitly enable `starmux up --code`, WorkBuddy can perform permitted development actions through the tools on that Linux host.

## Troubleshooting

| Problem | Check |
| --- | --- |
| WorkBuddy cannot connect | Use the Linux host's real LAN IP or public domain—not WorkBuddy's own `127.0.0.1`. Check Caddy, firewall and reachability from the WorkBuddy computer. |
| MCP server is silently skipped | Use `"type": "streamable-http"` (not `"streamableHttp"`); the latter triggers `Skipping MCP server linux-jetson: unsupported transport`. |
| `unknown remote field` | Remote server entries support only `type`, `url` and optional `headers` in the tested build. Remove extra properties from the new entry. |
| HTTP 401 | Check Starmux's auth mode and the Bearer key in WorkBuddy's `headers`. |
| HTTP 403 / invalid Host | Keep `header_up Host 127.0.0.1:18893` in Caddy. |
| Reads work but commands fail | Starmux defaults to read-only. Only opt into `--code` when you intend to grant execution privileges. |
| Public HTTPS is unreachable | Check DNS, TCP 443, NAT/CGNAT and IPv6 firewall rules. |

## Validated on NVIDIA Jetson Orin (November 2026)

In a real **WorkBuddy → Caddy → Starmux → NVIDIA Jetson Orin** LAN test, WorkBuddy added `linux-jetson` to `~/.workbuddy/mcp.json` while preserving two existing MCP server entries, and connected over `http://<jetson-lan-ip>/mcp`.

WorkBuddy discovered **26 tools**. The `health_check` result reported `status: ok`, `mode: coding`, and **25 tools ready**; these are different reported counters, not necessarily equal totals. Read-only calls to `get_config`, `list_processes`, and `list_sessions` all succeeded on Linux ARM64. This trace verifies connection and read operations in Coding mode; exact tool counts can change by release.

## Related guides

- [WorkBuddy official MCP guide](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide)
- [WorkBuddy MCP configuration reference](https://open.workbuddy.cn/docs/connector)
- [Starmux AI Client Setup](../CLIENTS.md)
- [Starmux Caddy and networking](../INSTALL.md)
- [Starmux permissions and authentication](../SECURITY.md)
- [ChatGPT to Linux / Jetson](chatgpt-linux-jetson.md)
- [Use-case index](README.md)

Starmux is an independent open-source project and is not affiliated with WorkBuddy.
