<div align="center">

# Mac MCP Gateway

### A self-hosted remote workbench for Desktop Commander.

Connect your AI client to files, terminals and development tools on your own computer. **Choose what AI can access. Start, stop and revoke access on your terms.**

**ChatGPT web · Codex · WorkBuddy · Doubao**

**Three authentication choices · Cross-platform CLI preview · Native macOS App · MIT**

[**Get started**](#get-started) · [**Choose authentication**](#choose-authentication) · [**Documentation**](docs/README.md)

</div>

> **Community preview — available from source.** ChatGPT OAuth over Tunnel and WorkBuddy HTTPS + API-key file access have been tested. See [client compatibility](docs/CLIENTS.md) for the exact combinations, including Claude App as a validation target.

## Your AI client here. Your tools there.

Use your preferred AI client to read a project, edit files and run tests on the computer hosting Gateway. In owner-approved coding mode, Desktop Commander's native tools remain available, subject to your permission policy and upstream controls.

- **Keep your development environment.** Work with the repositories, runtimes and tools already on your computer.
- **Host your own MCP connection.** No Desktop Commander hosted relay is required. Use HTTPS or a protected Tunnel for network access.
- **Control the same Core from CLI or App.** The CLI/Core spans macOS, Linux and Windows previews; the native App currently supports macOS.

This is an independent project built around [Desktop Commander](https://github.com/wonderwhy-er/DesktopCommanderMCP). It provides its own MCP connection; it does not replace the backend inside the official Desktop Commander plugin. The first release focuses on the [community request for self-hosting](https://github.com/wonderwhy-er/DesktopCommanderMCP/issues/714).

## How it connects

![Remote AI clients connect through HTTPS or a protected Tunnel to Gateway Core and Desktop Commander.](docs/assets/mcp-gateway-simple.svg)

Install Gateway on the **computer whose files and tools you want to use**. Your AI client can run elsewhere. HTTPS or Tunnel carries the connection; the authentication choice below controls access; your permission profile determines what tools may do.

## Choose authentication

Start with the option your client and deployment support. You do not need to configure all three.

| Your situation | Choose | What setup involves |
| --- | --- | --- |
| You already use a protected Tunnel or another ingress that restricts access | **Access managed by your connection** (`ingress`) | No Gateway key or OAuth server. Configure access in the ingress you already operate. |
| Your client accepts a Bearer key, such as WorkBuddy | **API Key** | Create a key per client, add it to the client configuration and revoke it independently. |
| Your client supports browser login and consent, such as ChatGPT web | **OAuth** | Users sign in and approve access; the client manages tokens. The host operator must first deploy an authorization server. |

**The default is ingress-managed access, with no shared factory key.** For remote use, the ingress must actually restrict who can connect. HTTPS encryption alone is not authentication. One Core uses one active mode.

All three choices retain the same owner-approved tool permissions. A key or OAuth login does not create a separate workspace or sandbox for each user. Manage Gateway keys and OAuth sessions through the CLI or **Dashboard → Access control**; ingress-managed access is revoked at the ingress.

[Compare modes and manage access](docs/ACCESS_CONTROL.md) · [API Key deployment](docs/REMOTE_SETUP.md#2-https--bearer-api-key) · [OAuth deployment](docs/REMOTE_SETUP.md#3-oauth-deploy-the-authorization-server)

## Get started

1. **Install on your tool host.** Follow [local installation](docs/INSTALL.md) to install the CLI and choose a read-only or coding permission profile. Source installation requires Git and Node.js 22.12+.
2. **Connect your AI client.** Follow [remote deployment](docs/REMOTE_SETUP.md) for HTTPS + API Key or ChatGPT OAuth, or the [protected Tunnel guide](docs/CONNECT_CHATGPT.md#2-secure-mcp-tunnel--no-inbound-port) for ingress-managed access.
3. **Verify a real tool call.** Ask the connected client to check Gateway health and read an approved test file. Local health or a connected icon alone does not verify remote tool execution.

After installation, everyday control is simple:

```sh
mac-mcp-gateway run
mac-mcp-gateway status   # In another terminal while the Core runs
mac-mcp-gateway stop
```

Setup configures the local Gateway. It does not provision DNS, TLS, a Tunnel or an OAuth server. [Installation and configuration guides →](docs/README.md)

## AI client compatibility

| Client | Current validation |
| --- | --- |
| **ChatGPT web** | Tested: Tunnel + OAuth, including coding and session revocation |
| **Codex** | Tested: installed Gateway plugin through protected Tunnel |
| **WorkBuddy** | Tested: HTTPS + IPv6 + API-key file reads/writes |
| **Doubao (豆包)** | Owner-reported successful use; connection details not yet recorded |
| **Claude App** | Compatibility target; Gateway end-to-end validation pending |

[Exact test scope, connection guides and pending combinations](docs/CLIENTS.md)

## Platform support

| Gateway host | Core / CLI | Native App |
| --- | --- | --- |
| **macOS** | Tested locally and in recorded remote workflows | SwiftUI source / development builds |
| **Linux** | Preview; Ubuntu arm64 local integration tests passed | Not available |
| **Windows** | Preview implementation; native validation pending | Not available |

[Platform setup and permission differences](docs/PLATFORMS.md). The project retains the `mac-mcp-gateway` name for now.

<div align="center">
  <img src="docs/assets/mac-mcp-gateway-menu-en.png" width="365" alt="Native macOS menu bar App showing Gateway status, controls and tool activity" />
  <p><sub>Native macOS App · English and Chinese supported</sub></p>
</div>

## Before deploying

- **OAuth currently needs operator setup.** Automatic provider deployment and a native OAuth setup wizard are not shipped. A signed, notarized public macOS App download is also not yet available.
- **Choose coding permissions deliberately.** Trusted mode enables native tools and Shell. The macOS Home-write sandbox is specific to the configured Desktop Commander process; Linux/Windows trusted mode uses OS-account permissions. Credentials do not isolate those tools from the owner's account.
- **This is a community preview.** Independent first-user setup and sustained operation across deployment combinations still need validation. [Release status](docs/RELEASE_STATUS.md) · [Security boundaries](docs/SECURITY.md)

## Roadmap and contributing

The first release focuses on a self-hosted Desktop Commander workbench. The longer-term direction is a general-purpose Gateway for more MCP servers and clients, with programmable middleware. A public Middleware SDK and user-script plugins are not shipped.

Core and CLI use strict TypeScript; the macOS App uses SwiftUI. Contributions to setup, client compatibility and platform testing are welcome.

[Contributing and development commands](CONTRIBUTING.md) · [Architecture](docs/ARCHITECTURE.md) · [Report a security issue](SECURITY.md)

## License

Gateway original code is **[MIT licensed](LICENSE)**. Desktop Commander is a separate upstream project with its own license and notices. Mac MCP Gateway is independent of, and not endorsed by, Desktop Commander, OpenAI, Anthropic or Tencent.

### Named instances and configuration

The App and CLI support named local instances with independent configuration, credentials, policies and logs. Start with `mac-mcp-gateway instance create dev --project /absolute/project`, then `mac-mcp-gateway run --instance dev`. Configuration can be edited in the App, imported, or linked to a JSONC file. Saving does not restart an instance; apply changes explicitly. Quitting the App stops only instances started by that App session. See [Instances and configuration](docs/INSTANCES.md) for the full workflow and migration preview.
