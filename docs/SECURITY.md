# Security and permissions

Mac MCP Gateway is a self-hosted connection and routing layer around real upstream MCP tools. Treat exposure to remote clients as a powerful privilege.

- The default **restricted read-only** role enforces project-scoped access and disables arbitrary Shell/write operations.
- The **trusted developer** role can run commands using your Mac account. In the owner-tested configuration, macOS process sandboxing restricts direct Desktop Commander writes to Home; it is **not** a universal filesystem or IPC sandbox.
- HTTP MCP listens on loopback by default. **Never expose the raw loopback port publicly.** Direct HTTPS requires a publicly reachable TLS endpoint **and real caller authentication, authorization and revocation**. DNS/TLS alone are insufficient.
- OpenAI Tunnel is outbound and uses OpenAI's forwarding infrastructure. Tunnel readiness is **not** proof of independent caller authorization.
- Optional **Gateway API key** mode authenticates a client credential on every MCP request and supports independent revocation. The default **managed by ingress** mode does not authenticate callers in Core. See [access control](ACCESS_CONTROL.md). Keys inherit owner permissions and do not isolate trusted tools from owner-readable configuration.
- Filesystem permissions, macOS TCC/FDA and permissions in the actual upstream Desktop Commander remain relevant.
- Do not commit API keys, tunnel runtime profiles, passwords or protected files; use personal private configuration and report vulnerabilities privately.
- Multi-user/multi-host orchestration and user-defined policy scripts are **not shipped** in this preview.

See [connection steps](CONNECT_CHATGPT.md) and [release status](RELEASE_STATUS.md).
