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

| Your situation | Suggested connection | Dependency |
| --- | --- | --- |
| AI client on the same machine | `http://127.0.0.1:18893/mcp` | None beyond Starmux |
| AI coding client on your laptop; tools on a Linux/Jetson host | SSH local port forwarding | SSH access to the host |
| Cloud AI client; public domain or reachable IPv6/IPv4 | Your own HTTPS reverse proxy | DNS, TLS and network reachability |
| Cloud AI client; computer behind NAT/CGNAT | OpenAI Secure MCP Tunnel or another compatible tunnel | The selected tunnel provider |

For example, if Starmux runs on an SSH-accessible remote server, execute this on your **laptop**:

```bash
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:18894:127.0.0.1:18893 \
  user@remote-host
```

Then point a laptop-based MCP client to `http://127.0.0.1:18894/mcp`. Replace `user@remote-host` with your actual SSH destination.

A browser-hosted cloud client such as ChatGPT Web **cannot use your laptop's localhost forward directly**; configure an appropriate HTTPS or supported tunnel endpoint instead. See [Installation & Networking](../INSTALL.md) and [AI Client Setup Guides](../CLIENTS.md).

## 3. Secure remote ingress

For an AI client that supports Bearer tokens, create a key:

```bash
starmux auth key "My AI Client"
```

This enables API-key authentication on that instance. Enter the emitted token into the client's secure MCP connection settings. For clients requiring browser login, use the documented OAuth 2.0 / Keycloak setup. Never rely on HTTPS encryption alone as caller authentication.

Starmux does not expose its local management dashboard as part of the remote `/mcp` endpoint. Keep management and authentication secrets private; see [Security & Authentication](../SECURITY.md).

## 4. Optionally mount additional MCP servers

A Starmux instance includes Desktop Commander-based tools and can route to **up to 12 additional local `stdio` MCP upstreams**. Additional tools are namespaced, and each upstream has an explicit `allowTools` list. For example, the `sqlite` route's `read_query` tool is exposed as `sqlite__read_query`.

Configure upstreams in the instance's `config.jsonc`; see [Multiple Instances & Configuration](../INSTANCES.md) for supported fields, secrets and apply instructions.

## What is actually self-hosted?

Starmux and its tool execution run on **your machine**. A direct, owner-operated HTTPS path does not require a vendor-hosted MCP relay. Choosing a provider-operated tunnel is convenient behind NAT, but that transport **does depend on the tunnel provider**. Starmux does not require replacing the official Remote Desktop Commander ChatGPT plugin or its hosted backend.

For multiple computers, deploy and connect to the appropriate Starmux instance on each host; don't assume that several installations form one central cross-machine control plane.

**Next:** [How ChatGPT accesses local files](chatgpt-access-local-computer.md) · [Desktop Commander remotely](remote-desktop-commander.md) · [Full networking guide](../INSTALL.md).
