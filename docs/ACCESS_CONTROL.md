# Gateway access control

The Core keeps network connectivity, credential authentication and tool authorization separate. HTTPS or Tunnel carries MCP requests to the loopback Core. The optional authentication component checks a Gateway key or OAuth token; the existing owner policy still controls tool execution.

For complete HTTPS proxy and client setup, follow [Remote installation and deployment](REMOTE_SETUP.md).

## Choose an authentication mode

Choose the mode your client supports and your deployment can operate. These are alternatives, not three setup stages or increasing tool-permission levels.

| Mode | Who checks access? | Client experience | Operator work | Where to revoke |
| --- | --- | --- | --- | --- | --- |
| **Ingress-managed** (`ingress`, default) | Your protected ingress; Core does not verify an individual caller | Connect through the existing controlled connection; no Gateway key | Configure the ingress's access policy and keep Core private | At the ingress |
| **API Key** (`api-key`) | Core checks a client credential | Configure a Bearer key once in a compatible client | Create a key per client and operate HTTPS or a protected Tunnel | Gateway CLI or Dashboard |
| **OAuth** (`oauth`) | Authorization server handles login/consent; Core validates tokens and session access | Sign in and approve access in the browser | Deploy/configure the authorization server and remote connection first | Gateway CLI or Dashboard for a session; provider/account policy for wider denial |

- Already have a protected Tunnel for your own use? Ingress-managed access avoids another Gateway credential. A Tunnel is suitable only when its access controls restrict callers; encryption alone is insufficient.
- Have a client that accepts an Authorization header? API Key avoids operating an OAuth server. Possession of the key grants access; it does not prove a person's real identity.
- Need a browser authorization flow, as in the tested ChatGPT setup? Use OAuth. The recurring client experience is simple, but initial host deployment remains operator-oriented.

**One Core uses one active mode.** Keys and OAuth tokens are not simultaneous fallbacks. Configure the selected method before switching; changes affect subsequent requests. Ingress mode delegates authentication rather than inventing a default shared key.

**Authentication and permissions are separate.** All currently allowed credentials and OAuth accounts use the same **Owner default** tool policy. An allowed subject list restricts which accounts can connect; it does not assign each account a workspace. Choose the permission profile during [installation](INSTALL.md), and check [platform differences](PLATFORMS.md).

[Client compatibility](CLIENTS.md) · [Complete remote deployment](REMOTE_SETUP.md)

## Default: managed by ingress

A new installation does not require a Gateway key. Existing setup profiles keep working without a migration. This is an explicit `ingress` mode, not a shared factory key, and the Core does not claim to know the caller's identity.

Keep the loopback endpoint private. For remote use, configure an ingress that restricts who can connect. HTTPS encryption alone does not authenticate callers. Forward only the MCP endpoint remotely; the Dashboard, health and management routes are local owner interfaces, not remote APIs protected by the MCP key.

```sh
mac-mcp-gateway access status
```

## Optional: Gateway API key

Create one credential for each client. The complete secret is displayed once; the private store contains only its SHA-256 digest. All credentials currently use **Owner default** permissions. Creating a credential does not turn on authentication.

```sh
mac-mcp-gateway access create "My AI client"
# Optional expiry, expressed in UTC:
mac-mcp-gateway access create "Temporary client" --expires 2027-01-01T00:00:00.000Z
mac-mcp-gateway access mode api-key
```

Configure the client to send `Authorization: Bearer <key>` on every MCP request. Use a protected HTTPS or encrypted Tunnel connection remotely, and ensure the ingress preserves the header. Not every MCP client's configuration UI supports arbitrary Bearer credentials. Verify your particular client before switching modes. An optional OAuth resource-server adapter is available separately; see [OAuth setup](OAUTH.md). Gateway does not embed an authorization server.

Changes take effect for subsequent requests without restarting. Missing, invalid, expired and revoked keys receive HTTP 401; an unreadable, unsafe or invalid access store receives 503. Neither failure falls back to ingress mode. Revoking the final credential leaves API key mode enabled and blocks all MCP access until the owner creates another credential or explicitly switches modes. Already executing tool calls are not canceled or replayed.

```sh
mac-mcp-gateway access list
mac-mcp-gateway access revoke CREDENTIAL_ID
mac-mcp-gateway access status --json
# Explicitly delegate access control back to the ingress:
mac-mcp-gateway access mode ingress
```

When running `mac-mcp-gateway verify` in key mode, provide the credential through `MAC_MCP_API_KEY` in its environment. Do not put a secret in a command argument, shared log or screenshot. Verification never prints the key. The Core does not use this variable as a fallback credential for requests.

## OAuth mode

Follow [OAuth deployment](REMOTE_SETUP.md#3-oauth-deploy-the-authorization-server) to configure the authorization server, allowed owner and client. The Gateway is the resource server, not the login server. For protocol details and test evidence, see [OAuth contracts](OAUTH.md).

After configuring the provider:

```sh
mac-mcp-gateway access oauth doctor
mac-mcp-gateway access mode oauth
mac-mcp-gateway access list
mac-mcp-gateway access revoke-oauth CONNECTION_ID
```

`doctor` checks discovery; it does not prove a real client login. Verify the connection from the actual client before considering deployment complete.

Revoking a connection blocks subsequent requests for that authorization-server session, including tokens refreshed within it. It does not cancel executing tools or undo completed operations. A new authorized login with a fresh session can restore access. To deny an account, remove its subject from the configured allowlist; local session revocation alone is not an account ban. Do not delete revocation records to recover access.

## Dashboard and macOS App

Open the running Core's Dashboard, then **Access control**, at `/access`. The macOS App's existing **Open Dashboard** action reaches the same management interface. No separate native credentials screen is included in this iteration.

The page shows access mode, credential names/IDs, creation/use/expiry/revocation information, and Owner default permission. It supports creating and revoking keys, viewing and revoking OAuth connections, and changing mode. OAuth provider configuration uses the CLI; there is no native App OAuth setup wizard. Mutations require a separate local owner management token and a same-origin form submission. Obtain the token locally:

```sh
mac-mcp-gateway access owner-token
```

A client API key is not an owner management token. The owner token is stored separately and is never accepted as an MCP credential. Do not give it to remote clients. Dashboard responses are not cached; newly created client secrets appear only in the creation response, never in credential listings.

## Files and security boundary

For named instances, use `--instance NAME` on access commands; each instance stores access state under `instances/<id>/state/`. The App and instance Dashboard use the same store. Copies exclude credentials and preserve the requirement to configure authentication. See [Instances](INSTANCES.md).

For unmigrated installations, the default store is `~/.config/mac-mcp-gateway/access-v1.json`, shared by CLI and Core for the same OS user. `access-v1.json.owner-token` is created only when the owner requests a management token. Files are owner-only (Unix permissions or Windows ACL checks); symlinks and multiple hard links are refused. Atomic replacement and an exclusive lock directory serialize CLI/Core writes. A leftover `.lock` after an abnormal process crash causes updates to fail closed; stop all processes using that store before removing a verified stale lock.

For isolated instances/tests, set the absolute path `MAC_MCP_ACCESS_FILE` consistently on the CLI and Core. A persistent `access-v1.json.initialized` marker prevents deletion of an initialized store from silently restoring unauthenticated mode on restart. Back up the private store as sensitive configuration. Do not delete it as a way to revoke credentials; use the revoke command.

This is a single-owner workstation, not an isolation boundary against tools running with that owner's OS privileges. Trusted native Shell/file tools may access owner-readable configuration and alter it. API keys control admission to those already approved capabilities; they do not sandbox them. Per-credential workspaces, billing and arbitrary role policies are not implemented.

On macOS, Home-only restrictions apply to the configured sandboxed Desktop Commander process and its subprocesses. They do not cover every optional upstream or external application. Linux/Windows trusted mode uses OS-account permissions and does not provide the macOS Home-only sandbox.
