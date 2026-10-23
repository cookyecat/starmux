# OAuth for ChatGPT and other MCP clients

Gateway is the OAuth **resource server**. A separate authorization server owns user login, consent, PKCE authorization codes, token issuance and refresh. The Core remains loopback-only; HTTPS/Tunnel transport is independent of authorization. Existing ingress and API-key installations remain unchanged until the owner explicitly selects OAuth.

**Start here:** [step-by-step remote installation](REMOTE_SETUP.md) covers Keycloak, HTTPS proxy, CLI configuration, ChatGPT fields and the tested Tunnel layout. This document describes contracts and historical acceptance evidence.

**Current result:** ChatGPT web OAuth through the official Tunnel passed real coding, session revocation and fresh-login recovery. The owner additionally confirmed a real read-only disk scan. Direct-HTTPS OAuth and native Linux/Windows OAuth acceptance remain open.

## Current implementation and acceptance boundaries

- Implemented: protected-resource discovery, Bearer challenges, JWT validation, owner subject/client allowlists, tool security metadata, live local session revocation, CLI and Dashboard management.
- The first provider contract uses JWT access tokens with `sub`, `azp` (OAuth client ID), `sid` (stable authorization-server session ID), `iat`, `exp`, audience and scope. Opaque tokens/introspection and providers without this contract are not supported.
- Resource metadata is available without a token only in OAuth mode at `/.well-known/oauth-protected-resource` and the resource-path-specific location. MCP initialization, listing, tools and resources all require authentication. Mixed anonymous/OAuth tools are not enabled.
- Local signed-token tests do not establish real ChatGPT compatibility. HTTPS and Tunnel end-to-end acceptance must be recorded separately.
- A reference Keycloak realm generator is provided. Keycloak's resource-indicator and CIMD features are experimental; do not claim full provider compatibility based only on successful discovery.

## Configure an existing authorization server

Create a dedicated owner account and an OAuth client with authorization-code flow, PKCE S256, the exact ChatGPT callback URL and explicit consent. Disable password grants, implicit grants and public account registration. The issuer must issue a token for this Gateway resource with `gateway:access`. The scope means access to **Owner default**, not a filesystem sandbox.

```sh
mac-mcp-gateway access oauth configure \
  --issuer https://auth.example.com/realms/gateway \
  --resource https://gateway.example.com/mcp \
  --client-id gateway-chatgpt \
  --token-auth client_secret_basic \
  --subjects OWNER_SUBJECT_ID
mac-mcp-gateway access oauth doctor
mac-mcp-gateway access mode oauth
mac-mcp-gateway access oauth status
```

For an explicitly approved alternate resource identifier, append `--resource-aliases 'https://exact-resource.example/mcp'` (comma-separated, maximum eight). Include all intended aliases on reconfiguration; omitting the option removes them. `doctor` checks discovery separately from these owner-configured aliases.

`configure` fetches standard OAuth/OIDC discovery, checks exact issuer and PKCE S256, validates HTTPS endpoints on the same origin, and saves configuration without changing the active mode. Cross-origin authorization/JWKS endpoints are deliberately not supported in this first adapter. Redirecting discovery endpoints are rejected. `--allow-loopback-http` is explicitly for isolated development, never remote deployment.

The default registration method is `provided` and token endpoint method is `none` (public client + PKCE). `--registration cimd|dcr` is accepted only when the provider advertises support; use the actual OAuth client ID emitted as `azp`. For CIMD that may be the exact client document URL shown by ChatGPT. DCR client IDs must be explicitly approved after registration; automatic enrollment of arbitrary clients is intentionally not implemented. `--token-auth` also accepts `client_secret_basic`, `client_secret_post`, and `private_key_jwt`. Gateway never needs the OAuth client's secret; configure it with the provider and ChatGPT only.

Configure ChatGPT with OAuth, the corresponding registration mode and client ID. `none` means no **client secret**, not no user authentication. Use `gateway:access` as the base scope. Leave OIDC/domain-claim features off unless your provider is configured for them. Tool names, input schemas and results retain upstream semantics; OAuth security metadata is added to advertised descriptors without replacing other `_meta` entries.

Forward the MCP route and the protected-resource metadata routes through your HTTPS ingress, preserving Authorization and WWW-Authenticate headers. The local upstream Host header must match the loopback endpoint; the Core retains its loopback Host validation. Keep `/access`, `/dashboard`, `/permissions` and other local management endpoints private. Do not derive issuer/resource from an untrusted Host or forwarded header.

For Secure MCP Tunnel, verify metadata discovery through the tunnel separately. The authorization server's browser-facing login and token endpoints are not automatically made reachable by an MCP tunnel.

## Reference self-hosted provider: Keycloak 26.8.1

Generate a realm import using your real HTTPS MCP resource and the exact callback shown by ChatGPT:

```sh
mac-mcp-gateway access oauth keycloak-realm \
  --resource https://gateway.example.com/mcp \
  --callback https://chatgpt.com/connector/oauth/YOUR_CALLBACK_ID > gateway-realm.json
```

Import into a dedicated Keycloak instance/realm. The generator contains no users or passwords, enables explicit client consent, requires S256, disables password/implicit grants, uses short-lived access tokens and refresh-token rotation, and registers only the exact callback. Create the owner account using Keycloak's admin interface; take its user ID as `--subjects`. The reference client ID is `gateway-chatgpt`, using `client_secret_basic`. Obtain its generated secret from the Keycloak admin interface and enter it only into ChatGPT. Keycloak 26.8.1 does not advertise `none` in token endpoint authentication metadata, so this reference uses a confidential client rather than claiming public-client discovery support.

Start Keycloak with `--features=resource-indicators` so it processes and validates the resource parameter. The import explicitly maps the subject (`sub`) into access tokens and declares a `gateway-resource` client with `resource_url` and a `gateway:access` audience mapper targeting that client. This feature is experimental in 26.8.1. Production deployments require a persistent database, HTTPS/hostname settings, protected administration and backups; do not expose `start-dev` publicly. CIMD is not enabled by this template.

## What to enter in ChatGPT

Three addresses have different jobs. Your existing website can keep its current address. The **MCP resource** is the externally reachable Gateway endpoint (for example, `https://mcp.example.com/mcp`); it must match the audience configured above. The **issuer** is the authorization server (for example, `https://auth.example.com/realms/gateway`). Owning a website or running a tunnel does not automatically provide an issuer. You can host the issuer on a separate hostname or a carefully routed path; it does not need to run on the same machine as the Core.

For the reference Keycloak configuration:

| ChatGPT field | Value |
| --- | --- |
| Authentication | OAuth |
| Client registration | Custom/provided OAuth client |
| Callback URL | Copy the exact URL shown by ChatGPT into the realm generator |
| OAuth client ID | `gateway-chatgpt` |
| OAuth client secret | Generated by Keycloak; enter directly in ChatGPT, never in Gateway CLI or chat |
| Token endpoint authentication | `client_secret_basic` |
| Base authorization scopes | `gateway:access` |
| Default requested scopes | `gateway:access` |
| Authorization URL | `{issuer}/protocol/openid-connect/auth` |
| Token URL | `{issuer}/protocol/openid-connect/token` |
| Authorization server base / issuer | The exact configured issuer |
| Resource | The exact configured public MCP resource URL |
| Registration URL | Not required for the provided-client method; do not select DCR for this template |
| PKCE | S256 |
| OIDC/domain claim | Leave disabled for this first setup |

The endpoints should normally be discovered rather than entered manually. If discovery fails, first check that the resource metadata routes and the issuer discovery document are reachable from outside your machine. Manually filling fields does not fix missing network routes. Public plain HTTP is not accepted by this configuration.

For OpenAI's official tunnel, keep tunnel provisioning separate: the tunnel credential is not an OAuth client secret or an issuer. Complete the provider setup first, then verify discovery and authorization through the actual tunnel. Do not assume a regular website URL is the MCP resource URL used by the tunnel client.

## View and revoke

Use Dashboard → Access control (also reachable from the macOS App), or:

```sh
mac-mcp-gateway access list
mac-mcp-gateway access revoke-oauth CONNECTION_ID
```

The connection ID hashes issuer, subject, client and session. The Core never stores access/refresh tokens. Revocation is persistent: an old session stays denied even if the provider refreshes its token or the Core restarts. The provider may still issue tokens, but they cannot restore Gateway access for the revoked session. A fresh, authorized login can create a new session; remove the subject from the configured allowlist to block that account entirely. This is not provider-wide logout. Already running tools are not canceled.

A maximum of 512 remembered OAuth sessions is enforced without evicting revocation records. At capacity, new sessions fail closed. Missing/invalid local state fails closed. Signing keys are cached for up to five minutes; unknown key IDs can refresh JWKS after a short cooldown. Cached valid keys may continue validating unexpired tokens during provider downtime; every call still checks the local allowlist and revocation state.

JWT verification checks signatures, issuer, audience, expiry/not-before, issued-at, client, owner subject, session and scope. A wrong scope/owner is denied before MCP dispatch. The Core does not retry tools when authentication fails. Locally trusted Shell tools remain capable of accessing owner files; OAuth admission does not isolate them from the owner account.

Existing Tunnel coding acceptance in ingress mode is recorded separately in [the Tunnel validation report](VALIDATION_TUNNEL.md); it is not OAuth acceptance.

## Acceptance checklist

- [x] Default/API-key regression tests and signed-token HTTP tests.
- [x] Metadata, PKCE discovery validation, wrong issuer/audience/scope/client rejection.
- [x] Tool discovery/read behavior, restricted write denial and unchanged invocation policy.
- [x] Local revocation rejects refreshed token claims with the same session ID.
- [x] Real Keycloak 26.8.1 authorization code, PKCE, consent, refresh and replay tests (local macOS).
- [ ] Real ChatGPT HTTPS: discovery → authorization → coding → refresh → revoke.
- [x] Real ChatGPT Tunnel: discovery, provided-client authorization, coding, token-endpoint updates, local revocation rejection and fresh-login recovery. Long-idle unattended operation remains outside this acceptance.
- [ ] Native Linux/Windows validation of the new OAuth feature.

## Reproduce the local provider test

Use a **disposable** unpacked Keycloak 26.8.1 distribution and Java 21. The test starts Keycloak only on loopback with an in-memory database, imports a temporary realm into that distribution, generates temporary credentials, and stops it afterward. Do not point this test at an existing provider installation.

```sh
GATEWAY_KEYCLOAK_HOME=/absolute/path/to/disposable/keycloak-26.8.1 npm run test:oauth:keycloak
```

The test exercises exact callback checks, consent rejection, PKCE mismatch, authorization-code replay rejection, real token audience, MCP discovery and reading, token expiry, refresh rotation, and Gateway revocation surviving a provider refresh. It does not connect to ChatGPT or deploy a public authorization server. The normal `npm test` suite does not require Keycloak.

## Sources

- [OpenAI authentication](https://developers.openai.com/plugins/build/auth)
- [OpenAI custom MCP setup](https://developers.openai.com/api/docs/guides/custom-mcp-server)
- [OpenAI Tunnel OAuth](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels#oauth)
- [Keycloak MCP integration](https://www.keycloak.org/securing-apps/mcp-authz-server)
- [Keycloak Docker setup](https://www.keycloak.org/getting-started/getting-started-docker)

## Historical acceptance checkpoints

The following entries preserve the investigation chronology. Statements such as “pending” describe that checkpoint only; use the current result and checklist above for present status.

### Remote acceptance deployment checkpoint (2026-10-22)

A separate macOS acceptance deployment now uses Keycloak 26.8.1 with PostgreSQL 17, a public IPv6 HTTPS ingress, and an OAuth-only Core. This is an infrastructure checkpoint, **not a passed ChatGPT end-to-end acceptance**.

Verified on the deployment host:

- The public issuer discovery document returns HTTP 200 with normal TLS certificate verification.
- The Core returns HTTP 401 without a bearer token; protected-resource metadata remains discoverable.
- The official tunnel-client 0.0.16 reports OAuth discovery complete and ten OAuth targets automatically registered.
- A real ChatGPT Tunnel connector now automatically discovers the authorization URL, tunneled token endpoint, resource and `gateway:access` scope. The pre-registered client configuration has been prepared; secret submission and login/consent are pending.
- The existing API-key Core uses a separate port and access store.

Operational findings:

- Local Fake-IP DNS can break issuer discovery even when direct IPv6 HTTPS works. Correct the deployment host's resolution for the issuer without disabling TLS verification. A host mapping must be updated when the public IPv6 changes.
- In tunnel-client 0.0.16, trusting an issuer for discovery does not automatically allow registration of its HTTP callout targets. The original loopback MCP URL plus public resource/issuer origin produced `private-host-registration-disabled`. Generic manually configured targets also lacked the OAuth categories/tags used by discovery. The verified fix was to point the tunnel at the same-origin HTTPS MCP endpoint served by the local proxy. The proxy still forwards MCP to the loopback-only Core. Ten typed OAuth targets were then auto-registered, and ChatGPT discovery succeeded. Temporary generic targets and hostname-classification overrides were removed.
- The HTTPS proxy and valid issuer hostname resolution are now dependencies of the local Tunnel route. This does not require the ChatGPT backend to reach the host over public IPv6: MCP and registered token callouts still traverse the outbound tunnel. Browser login remains a direct HTTPS navigation to the issuer.
- The final same-origin HTTPS configuration does not enable `--harpoon.allow-plaintext-http`. Keep auto-registered OAuth endpoints behind the narrow proxy allowlist; do not expose authorization-server administration.
- Run the acceptance Core and authorization server independently of disposable debugging terminals. The test jobs are manually bootstrapped into the current login session, with private logs and no automatic login installation. PostgreSQL data persists; the HTTPS proxy still needs its privileged process to remain running.
- Keep client secrets, owner credentials, database passwords, access stores, deployment-specific launchers and logs outside the repository.

Still required: client-secret submission, login and consent with the exact current callback, token exchange, authenticated tool discovery and a controlled coding call, followed by revocation rejection. A callback displayed in the configuration dialog is not evidence that the authorization redirect has succeeded.

Reference: [tunnel-client 0.0.16 configuration](https://github.com/openai/tunnel-client/blob/v0.0.16/docs/configuration.md), including OAuth shim rewriting and Harpoon OAuth target metadata.

### Login and token exchange checkpoint

The real ChatGPT authorization request used the configured client, exact registered callback, `gateway:access`, and PKCE S256. Owner login and explicit consent completed, and the browser returned to ChatGPT. Client-secret authentication reached Keycloak successfully. This proves the login/callback path, not a usable MCP authorization.

The first code-to-token exchange returned HTTP 400: Keycloak reported an invalid/unknown requested resource. ChatGPT's Tunnel discovery had replaced the resource with the exact Tunnel MCP URL; the reference realm knew only the canonical Gateway resource. The deployment now registers that exact Tunnel resource as an additional bearer-only resource client. Core issuer/audience validation remains enabled and unchanged. Successful token exchange and the resulting token audience still need verification; registering a resource alone is not proof of acceptance.

Keycloak's default user profile also required an email even though this deployment does not use OIDC email claims. The deployment made email optional instead of inventing a user email. The previous profile configuration was backed up privately.

After the failed exchange, ChatGPT's association button remained disabled. The failed plugin installation was removed while preserving its definition and OAuth settings. Reinstallation through the browser remains pending; do not report the plugin as connected until that succeeds. No credential values or authorization codes are recorded here.

### Tunnel resource aliases and successful association (2026-10-22)

Keycloak 26.8.1's `ResourceIndicatorsPostProcessor` first checks that the requested resource matches an audience granted to the client. Registering a resource client alone is insufficient: add an audience mapper for that resource to the granted scope. It then narrows the token audience to the requested resource URL. The Tunnel shim supplies a different resource URL from the canonical HTTPS endpoint.

Core now supports an optional `oauth.resourceAliases` array in the private access configuration: at most eight exact HTTPS resource URLs identifying this same Gateway. Owners must explicitly configure these identifiers; they are never derived from request headers or automatically trusted from discovery. Issuer, signature, client, subject, scope, lifetime and session revocation checks still apply. Protected-resource metadata continues to advertise the canonical resource. Do not add arbitrary service audiences or wildcard hosts. Removing an alias immediately rejects tokens addressed only to that alias.

The deployment added an exact Tunnel audience mapper and the matching Core resource alias. Reinstallation of the existing ChatGPT plugin then succeeded without changing the callback. The page now offers “Try in chat”, and Core recorded real `verified-oauth` requests. This proves token exchange and authenticated MCP initialization/discovery; coding and revocation acceptance are tracked separately below.

Regression coverage checks default rejection of an unconfigured alias, explicit acceptance, rejection of a neighboring URL, wrong issuer/subject/scope, and rejection after alias removal. Build and the OAuth integration fixture pass.

Source: [Keycloak resource indicator processing](https://github.com/keycloak/keycloak/blob/26.8.1/services/src/main/java/org/keycloak/protocol/oidc/resourceindicators/ResourceIndicatorsPostProcessor.java).

### Acceptance boundary and network dependency

The ChatGPT settings page confirms a connected account using OAuth. The OAuth connector is now independently exposed to the agent, but its first real `health_check` attempt failed before reaching Core: the Tunnel could not complete a token-endpoint call after the host's global IPv6 connectivity was disabled. Keycloak remained healthy on loopback, while the canonical HTTPS issuer was unreachable. This is distinct from the earlier audience mismatch. Do not count this attempt as a successful coding or refresh test.

For this IPv6-hosted deployment, keep the issuer reachable from both the user's login browser and the local Tunnel/Core. An outbound Tunnel does not remove the local dependency on the configured HTTPS issuer. If the host address changes, update the proxy bind address, DNS and any local host mapping together; never disable TLS verification to compensate. An IPv4-only deployment instead needs a reachable HTTPS authorization endpoint or a separately designed local HTTPS route.

The full `npm test` suite passed after the resource-alias change, including all 20 Node test-runner tests plus the preceding compatibility scripts. Real connector file read/write, process execution, token refresh and remote revocation rejection remain pending.

### Real ChatGPT coding and revocation acceptance (2026-10-22 UTC)

After IPv6 was restored, the HTTPS issuer returned 200 and the previously configured address was present again. The earlier idle session's refresh token had expired (`Token is not active`); signing in again with the unchanged callback restored the association.

A fresh ChatGPT web conversation using only the OAuth plugin completed:

- `health_check`, followed by genuine Desktop Commander calls under a new `verified-oauth` connection.
- `create_directory`, `write_file`, and `read_file` in a dedicated Downloads acceptance directory.
- `start_process` running the written Python file. Desktop Commander's recorded output contained `GATEWAY_OAUTH_OK_20261022` and process completion. The file was independently checked locally; the local executor did not create or run it as a substitute for the connector.
- CLI revocation of that exact connection. Subsequent real `tools/call` and `initialize` requests returned HTTP 401. Token-endpoint calls still returned 200, but did not restore access to the revoked session. ChatGPT displayed a reconnect prompt.

Evidence was correlated between Core request IDs/`verified-oauth` audit entries, Desktop Commander's per-tool history and Tunnel status codes. No bearer tokens, secrets or private login data are included here. The coding sequence ran at approximately 18:33 UTC, and revocation rejection at 18:34 UTC.

Observed limitations: the interactive shell printed Homebrew initialization warnings before successfully executing Python; ChatGPT's final answer/app rendering also displayed loading failures even though the tool calls completed. These UI/environment issues must not be confused with failed tool execution or treated as resolved. Long-idle refresh expiry is expected to require a new login; unattended long-duration session behavior has not been accepted as a release guarantee.

Restoration checkpoint (2026-10-23 03:25 UTC): after the interrupted acceptance run, a fresh login using the unchanged callback created a new session. ChatGPT web successfully called `health_check`; Core recorded `verified-oauth` and `DC_BRIDGE_HEALTH_CHECK` with the same request ID. The earlier revoked session remains revoked. The plugin was restored by reauthentication, without undoing the revocation or relaxing access checks. The current Codex thread's dynamically loaded tool handle remained stale after plugin reinstallation, so restoration was verified through the actual ChatGPT web client and Core audit evidence rather than that handle.
