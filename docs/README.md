# Documentation

Mac MCP Gateway connects an AI client to tools on your own computer. Start with local installation, then choose how remote access will be authenticated.

## Start here

| I want to… | Read |
| --- | --- |
| Install the CLI or build the macOS App | [Install](INSTALL.md) |
| Decide whether to use ingress-managed access, API Key or OAuth | [Choose authentication](ACCESS_CONTROL.md#choose-an-authentication-mode) |
| Connect WorkBuddy or another Bearer-header client | [HTTPS + API Key deployment](REMOTE_SETUP.md#2-https--bearer-api-key) |
| Connect ChatGPT with browser login and consent | [OAuth deployment](REMOTE_SETUP.md#3-oauth-deploy-the-authorization-server) |
| Use an existing protected Tunnel without a Gateway key | [Ingress-managed access](ACCESS_CONTROL.md#default-managed-by-ingress), then [Tunnel setup](CONNECT_CHATGPT.md#2-secure-mcp-tunnel--no-inbound-port) |
| Check which clients and combinations have been tested | [Client compatibility](CLIENTS.md) |
| Install on Linux or Windows | [Platform support and permissions](PLATFORMS.md) |

**Three separate decisions:** HTTPS or Tunnel is the network path. Ingress-managed access, API Key or OAuth controls admission. The owner-approved permission profile controls tool operations. Choosing stronger authentication does not automatically narrow file or Shell permissions.

## Operate and troubleshoot

- [Instances and configuration](INSTANCES.md): App/CLI instance management, JSONC editing, import/bind, saved versus active configuration, and legacy migration.

- [Access control](ACCESS_CONTROL.md): modes, key/session management, revocation and private configuration.
- [Remote deployment](REMOTE_SETUP.md): proxy and provider setup, client fields, diagnostics and recovery.
- [Connect ChatGPT](CONNECT_CHATGPT.md): HTTPS and Tunnel networking.
- [Security and permissions](SECURITY.md): what the access controls do and do not isolate.
- [Preview status](RELEASE_STATUS.md): shipped features and remaining release work.

## Implementation and evidence

- [OAuth](OAUTH.md): resource-server contract and acceptance history.
- [WorkBuddy validation](VALIDATION_WORKBUDDY.md) and [protected Tunnel validation](VALIDATION_TUNNEL.md).
- [Architecture](ARCHITECTURE.md) and [contributing](../CONTRIBUTING.md).

The deployment guides describe the current operator workflow. They do not imply one-click installation or acceptance of every client, host and network combination.

[Project overview](../README.md)
