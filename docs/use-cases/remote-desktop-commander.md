# How can I use Desktop Commander remotely from ChatGPT or another AI client?

**Short answer:** Use [Starmux](https://github.com/cookyecat/starmux) as a self-hosted MCP gateway on the computer you want to operate. Starmux bundles a Desktop Commander-derived tool engine, so remote MCP clients can access file and development tools through the Starmux endpoint without setting up the official **Remote Desktop Commander hosted service**.

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

**If your AI coding client runs on the same host**, connect it to:

```text
http://127.0.0.1:18893/mcp
```

**If the client runs on a different laptop**, use SSH forwarding if you can SSH to the tool host:

```bash
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:18894:127.0.0.1:18893 \
  user@remote-host
```

Connect the laptop's MCP client to `http://127.0.0.1:18894/mcp`. This forwards calls to the host machine without exposing a public MCP port.

**If the client is ChatGPT Web**, use an OpenAI Secure MCP Tunnel or your own protected HTTPS endpoint. ChatGPT Web cannot directly dial your computer's `127.0.0.1`. Follow the [ChatGPT connection walkthrough](chatgpt-access-local-computer.md) or [AI Client Setup Guides](../CLIENTS.md).

## 3. Choose read-only or coding access

Start with a discovery task:

> List the tools available through my Starmux MCP connection, and read the README in the connected workspace.

If you intentionally want the agent to edit code, run commands or operate Git on your host, switch modes **on the host**:

```bash
starmux up --code
```

Coding mode runs tools with permissions available to your OS account. Keep public endpoints protected by API-key, OAuth or trusted upstream access control, and review the [Security Guide](../SECURITY.md) before authorizing remote tool execution.

## How this differs from the official Remote Desktop Commander plugin

| | Starmux | Official hosted Remote Desktop Commander plugin |
| --- | --- | --- |
| Entry point | Your Starmux MCP endpoint | Official plugin's hosted integration |
| Tool execution | Your computer, via the bundled Desktop Commander-derived engine | Device connected through the official remote product |
| Remote transport | Your HTTPS ingress or selected tunnel | Official product's remote transport |
| Changes to the official plugin | Not required | Backend selection is controlled by the official product |

Starmux is not affiliated with or endorsed by Desktop Commander. Consult the upstream [Desktop Commander MCP repository](https://github.com/wonderwhy-er/DesktopCommanderMCP) for its own project documentation.

## Related guides

- [Run a self-hosted remote MCP gateway](self-hosted-remote-mcp-gateway.md).
- [ChatGPT to a local computer](chatgpt-access-local-computer.md).
- [Installation & networking](../INSTALL.md) · [Security & authentication](../SECURITY.md).
