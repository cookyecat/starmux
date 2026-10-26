# Security and permissions

Starmux is a self-hosted connection and routing layer around real upstream MCP tools. Treat exposure to remote clients as a powerful privilege.

- The default **restricted read-only** role enforces project-scoped access and disables arbitrary Shell/write operations.
- The **trusted coding** role (`starmux up --code`) can edit files and run commands using your OS account permissions. Migrated macOS Home-only configurations keep their previous sandbox until explicitly changed.
- HTTP MCP listens on loopback (`127.0.0.1`) by default. **Never expose the raw loopback port publicly.** Direct HTTPS requires a publicly reachable TLS endpoint **and caller authentication**. DNS/TLS alone are insufficient.
- OpenAI Tunnel is outbound and uses OpenAI's forwarding infrastructure. Tunnel readiness alone is **not** caller authorization unless paired with tunnel access controls or Starmux authentication.
- **OAuth** mode validates tokens and allowed accounts/clients, and supports local session revocation, including refreshed tokens in that session. A fresh authorized session can restore access; session revocation is not an account ban.
- **Bearer API key** mode authenticates a client credential on every MCP request and supports instant revocation. The default **`none` (`ingress`)** mode does not verify a token in Starmux. See [access control](ACCESS_CONTROL.md). Keys inherit your instance's workspace permissions.
- Filesystem permissions, macOS TCC/FDA and permissions in the actual upstream Desktop Commander remain relevant.
- Do not commit API keys, tunnel runtime profiles, passwords or protected files; use personal private configuration and report vulnerabilities privately.
- Multi-user/multi-host orchestration and user-defined policy scripts are **not shipped** in this preview.

See [connection steps](CONNECT_CHATGPT.md) and [platform support](PLATFORMS.md).
