# OAuth for ChatGPT and other MCP clients

Gateway is the OAuth **resource server**. A separate authorization server owns user login, consent, PKCE authorization codes, token issuance and refresh. The Core remains loopback-only; HTTPS/Tunnel transport is independent of authorization. Existing ingress and API-key installations remain unchanged until the owner explicitly selects OAuth.

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
- [ ] Real ChatGPT Tunnel: same flow, including separate authorization endpoint reachability.
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

## Remote acceptance deployment checkpoint (2026-10-22)

A separate macOS acceptance deployment now uses Keycloak 26.8.1 with PostgreSQL 17, a public IPv6 HTTPS ingress, and an OAuth-only Core. This is an infrastructure checkpoint, **not a passed ChatGPT end-to-end acceptance**.

Verified on the deployment host:

- The public issuer discovery document returns HTTP 200 with normal TLS certificate verification.
- The Core returns HTTP 401 without a bearer token; protected-resource metadata remains discoverable.
- The official tunnel-client 0.0.16 reports OAuth discovery complete and its configured Harpoon catalog settled.
- The existing API-key Core uses a separate port and access store.

Operational findings:

- Local Fake-IP DNS can break issuer discovery even when direct IPv6 HTTPS works. Correct the deployment host's resolution for the issuer without disabling TLS verification. A host mapping must be updated when the public IPv6 changes.
- Configure the issuer origin with `--mcp.oauth-trusted-origin`. Trusting an origin alone does not prove that OAuth HTTP callouts are available through the tunnel. Inspect the Harpoon catalog as well as discovery status. In this deployment, an empty catalog produced `unsupported channel "harpoon"` during a ChatGPT discovery retry; explicit targets were then configured for protected-resource metadata and the authorization-server realm. The webpage retry remains pending.
- `--harpoon.allow-plaintext-http` is needed only for an explicitly configured loopback HTTP target here. Keep targets narrowly scoped; it does not justify arbitrary private-network access.
- Run the acceptance Core and authorization server independently of disposable debugging terminals. The test jobs are manually bootstrapped into the current login session, with private logs and no automatic login installation. PostgreSQL data persists; the HTTPS proxy still needs its privileged process to remain running.
- Keep client secrets, owner credentials, database passwords, access stores, deployment-specific launchers and logs outside the repository.

Still required: successful ChatGPT discovery or validated manual settings, login and consent with the exact current callback, token exchange, authenticated tool discovery and a controlled coding call, followed by revocation rejection. A callback displayed in the configuration dialog is not evidence that the authorization redirect has succeeded.
