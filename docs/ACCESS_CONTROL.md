# Gateway access control

The Core keeps network connectivity, credential authentication and tool authorization separate. HTTPS or Tunnel carries MCP requests to the loopback Core. The optional authentication component checks a Gateway key; the existing owner policy still controls tool execution.

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

Configure the client to send `Authorization: Bearer <key>` on every MCP request. Use a protected HTTPS or encrypted Tunnel connection remotely, and ensure the ingress preserves the header. Not every MCP client's configuration UI supports arbitrary Bearer credentials. Verify your particular client before switching modes. No OAuth authorization server or client-specific login adapter is included.

Changes take effect for subsequent requests without restarting. Missing, invalid, expired and revoked keys receive HTTP 401; an unreadable, unsafe or invalid access store receives 503. Neither failure falls back to ingress mode. Revoking the final credential leaves API key mode enabled and blocks all MCP access until the owner creates another credential or explicitly switches modes. Already executing tool calls are not canceled or replayed.

```sh
mac-mcp-gateway access list
mac-mcp-gateway access revoke CREDENTIAL_ID
mac-mcp-gateway access status --json
# Explicitly delegate access control back to the ingress:
mac-mcp-gateway access mode ingress
```

When running `mac-mcp-gateway verify` in key mode, provide the credential through `MAC_MCP_API_KEY` in its environment. Do not put a secret in a command argument, shared log or screenshot. Verification never prints the key. The Core does not use this variable as a fallback credential for requests.

## Dashboard and macOS App

Open the running Core's Dashboard, then **Access control**, at `/access`. The macOS App's existing **Open Dashboard** action reaches the same management interface. No separate native credentials screen is included in this iteration.

The page shows access mode, credential names/IDs, creation/use/expiry/revocation information, and Owner default permission. It supports creating and revoking keys and changing mode. Mutations require a separate local owner management token and a same-origin form submission. Obtain the token locally:

```sh
mac-mcp-gateway access owner-token
```

A client API key is not an owner management token. The owner token is stored separately and is never accepted as an MCP credential. Do not give it to remote clients. Dashboard responses are not cached; newly created client secrets appear only in the creation response, never in credential listings.

## Files and security boundary

The default store is `~/.config/mac-mcp-gateway/access-v1.json`, shared by CLI and Core for the same OS user. `access-v1.json.owner-token` is created only when the owner requests a management token. Files are owner-only (Unix permissions or Windows ACL checks); symlinks and multiple hard links are refused. Atomic replacement and an exclusive lock directory serialize CLI/Core writes. A leftover `.lock` after an abnormal process crash causes updates to fail closed; stop all processes using that store before removing a verified stale lock.

For isolated instances/tests, set the absolute path `MAC_MCP_ACCESS_FILE` consistently on the CLI and Core. A persistent `access-v1.json.initialized` marker prevents deletion of an initialized store from silently restoring unauthenticated mode on restart. Back up the private store as sensitive configuration. Do not delete it as a way to revoke credentials; use the revoke command.

This is a single-owner workstation, not an isolation boundary against tools running with that owner's OS privileges. Trusted native Shell/file tools may access owner-readable configuration and alter it. API keys control admission to those already approved capabilities; they do not sandbox them. Per-credential workspaces, billing and arbitrary role policies are not implemented.

On macOS, Home-only restrictions apply to the configured sandboxed Desktop Commander process and its subprocesses. They do not cover every optional upstream or external application. Linux/Windows trusted mode uses OS-account permissions and does not provide the macOS Home-only sandbox.
