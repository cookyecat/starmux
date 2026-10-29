# Security and permissions

Starmux is a self-hosted connection and routing layer around real upstream MCP tools. Treat exposure to remote clients as a powerful privilege.

- The default **global read-only** mode (`starmux up --read`) allows reading files wherever the OS account and upstream server permit it. Starmux blocks write operations and arbitrary execution; it does not add per-directory grants or sensitive-path exclusions in this mode.
- **Coding** mode (`starmux up --code`) forwards native operations with your OS account permissions, including file editing and command execution.
- `Project` is context for relative file paths in Read-only mode, not a filesystem boundary. Multiple instances have separate ports, credentials, configuration and logs, but share the same OS account.
- Global modes ignore saved Starmux directory grants and path filters; those files are preserved. Explicit instance configurations can retain workspace policies, including the macOS Home-only scope.
- Read-only batch reads retain the 20-file and 4 MiB combined-size limits. Missing files are reported by the upstream server individually, so they do not discard successful contents in the same batch.
- HTTP MCP listens on loopback (`127.0.0.1`) by default. **Never expose the raw loopback port publicly.** Direct HTTPS requires a publicly reachable TLS endpoint **and caller authentication**. DNS/TLS alone are insufficient.
- OpenAI Tunnel is outbound and uses OpenAI's forwarding infrastructure. Tunnel readiness alone is **not** caller authorization unless paired with tunnel access controls or Starmux authentication.
- **OAuth** mode validates tokens and allowed accounts/clients, and supports local session revocation, including refreshed tokens in that session. A fresh authorized session can restore access; session revocation is not an account ban.
- **Bearer API key** mode authenticates a client credential on every MCP request and supports instant revocation. The default **`none` (`ingress`)** mode does not verify a token in Starmux. See [access control](ACCESS_CONTROL.md). Keys inherit the instance's global permission mode.
- Filesystem permissions, macOS TCC/FDA and permissions in the actual upstream Desktop Commander remain relevant.
- Do not commit API keys, tunnel runtime profiles, passwords or protected files; use personal private configuration and report vulnerabilities privately.

See [connection steps](CONNECT_CHATGPT.md) and [platform support](PLATFORMS.md).
