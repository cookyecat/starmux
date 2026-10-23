# AI client compatibility

Choose a client you already use, then check its tested connection below. Transport, authentication and host platform are separate parts of a deployment; success with one combination does not certify the others.

**Labels:** Tested means a recorded project workflow; owner-reported means a successful user report without a complete recorded test matrix; pending means a compatibility target, not a completed Gateway test.


| Client | Current project validation | Connection guide |
| --- | --- | --- |
| **ChatGPT web** | Tested: Tunnel + OAuth; coding, session revocation and fresh login | [ChatGPT OAuth](REMOTE_SETUP.md#4-configure-core-and-chatgpt) |
| **Claude App** | Remote MCP supported by the client; Gateway end-to-end validation pending | [Official custom connector setup](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) |
| **Codex** | Tested: installed Gateway plugin through protected Tunnel | [Tunnel](CONNECT_CHATGPT.md#2-secure-mcp-tunnel--no-inbound-port) · [HTTP API-key example](REMOTE_SETUP.md#configure-workbuddy-or-another-header-capable-client) |
| **WorkBuddy** | Tested: remote HTTPS + IPv6 + API-key file reads/writes to macOS | [API Key setup](REMOTE_SETUP.md#2-https--bearer-api-key) |
| **Doubao (豆包)** | Owner-reported successful use; exact connection combination not recorded | [Deployment options](REMOTE_SETUP.md) |

A client listing does not imply every authentication or transport combination has passed. In particular, Claude App is a compatibility target, and ChatGPT direct-HTTPS OAuth remains unverified. [OAuth evidence](OAUTH.md) · [WorkBuddy evidence](VALIDATION_WORKBUDDY.md) · [Protected Tunnel evidence](VALIDATION_TUNNEL.md)

## Use WorkBuddy with a Linux workspace


**Your AI app's operating system does not have to be your tools' operating system.** Keep WorkBuddy on your Mac or Windows computer and deploy Gateway Core with Desktop Commander on a Linux machine. Connect to that machine's authenticated HTTPS MCP endpoint to work with its files and development tools.

For example, ask WorkBuddy to inspect a Linux project's configuration, update an approved file, and run its tests on that Linux host. WorkBuddy itself does not need to be installed there. This is remote MCP tool access, not remote desktop control or automatic file synchronization.

**Validation:** remote WorkBuddy file reads/writes on a Mac have passed; the Linux Core has independently passed real Desktop Commander file-write and Shell tests. The combined **WorkBuddy → Linux** deployment is an intended use case, with end-to-end acceptance still pending. [WorkBuddy evidence](VALIDATION_WORKBUDDY.md) · [Linux setup and permissions](PLATFORMS.md)

WorkBuddy's [official desktop downloads](https://www.codebuddy.cn/docs/workbuddy/Download-History) currently list macOS and Windows. This deployment separates the client installation from the machine that executes tools.


[Choose authentication](ACCESS_CONTROL.md#choose-an-authentication-mode) · [Remote deployment](REMOTE_SETUP.md) · [All documentation](README.md)
