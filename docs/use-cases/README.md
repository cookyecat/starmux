# Starmux Use Cases — Solve a Problem with MCP

**Start with the task you want to accomplish.** These short, standalone guides answer common questions about connecting AI clients to tools on computers you control. Each guide provides the shortest practical starting point and links to the detailed configuration references.

| Question | Guide | What you'll achieve |
| --- | --- | --- |
| **How can ChatGPT access my local computer?** | [ChatGPT to local files and tools](chatgpt-access-local-computer.md) | Start Starmux, choose OpenAI Tunnel or HTTPS, and verify a ChatGPT tool call. |
| **How do I self-host a remote MCP gateway?** | [Self-hosted remote MCP gateway](self-hosted-remote-mcp-gateway.md) | Run MCP on your own host, choose remote transport, secure access, and connect extra local MCP servers. |
| **How can I use Desktop Commander remotely?** | [Remote Desktop Commander with Starmux](remote-desktop-commander.md) | Use Starmux's bundled Desktop Commander-derived tools remotely without using the official hosted plugin. |
| **Can ChatGPT access a Linux server or NVIDIA Jetson?** | [ChatGPT to Linux / Jetson](chatgpt-linux-jetson.md) | Connect ChatGPT Web to a Linux or ARM64 tool host without a native ChatGPT app on that host. |
| **How do I connect an MCP server behind NAT?** | [HTTPS vs Tunnel vs SSH](mcp-behind-nat-https-vs-tunnel.md) | Choose a secure transport for public IPs, NAT/CGNAT and laptop-based clients. |
| **How can I secure an MCP endpoint with OAuth?** | [Self-hosted MCP OAuth](self-hosted-mcp-oauth.md) | Configure Keycloak, PKCE, protected-resource metadata and browser login for Starmux. |

## Technical reference

- [Installation, networking and tunnels](../INSTALL.md)
- [Security, permissions and OAuth](../SECURITY.md)
- [ChatGPT, Claude and other client configuration](../CLIENTS.md)
- [Multiple instances and additional MCP upstreams](../INSTANCES.md)

[Main Starmux README](../../README.md) · [Documentation home](../README.md) · [Source repository](https://github.com/cookyecat/starmux)
