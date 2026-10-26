# AI client compatibility

Choose a client you already use, then check its recommended connection below. Transport, authentication and host platform are configured independently.

| Client | Validation status | Connection guide |
| --- | --- | --- |
| **ChatGPT Web** | ✅ Tested: Secure Tunnel + OAuth (coding, session revocation and login) | [ChatGPT OAuth](REMOTE_SETUP.md#4-configure-starmux-and-chatgpt) |
| **Claude App** | 🎯 Target: Remote MCP Custom Connector | [Official custom connector setup](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) |
| **Codex** | ✅ Tested: Protected Tunnel | [Tunnel setup](CONNECT_CHATGPT.md#2-secure-mcp-tunnel--no-inbound-port) · [HTTP API-key example](REMOTE_SETUP.md#configure-workbuddy-or-another-header-capable-client) |
| **WorkBuddy** | ✅ Tested: Direct HTTPS + IPv6 + Bearer API key | [API Key setup](REMOTE_SETUP.md#2-https--bearer-api-key) |
| **Doubao (豆包)** | ✅ Community verified | [Deployment options](REMOTE_SETUP.md) |

See [OAuth setup](OAUTH.md) and [remote setup](REMOTE_SETUP.md) for step-by-step configuration.

## Use WorkBuddy or Desktop AI Clients with a Linux / NVIDIA Jetson Host

**Your AI client's operating system does not have to match your target machine's operating system.** Many AI clients (such as WorkBuddy or ChatGPT Desktop) only offer macOS and Windows desktop apps. You can keep your AI client on your Mac or Windows laptop, run `starmux up --code` on a **Linux (`x64` / `ARM64`)** server or **NVIDIA Jetson** device, and connect over HTTPS + Bearer API Key or Tunnel to edit code and run terminal commands on the target machine remotely.

See [platform support](PLATFORMS.md) for Linux and cross-platform details.


[Choose authentication](ACCESS_CONTROL.md#choose-an-authentication-mode) · [Remote deployment](REMOTE_SETUP.md) · [All documentation](README.md)
