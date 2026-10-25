# OAuth validation archive

Historical investigation notes. For current setup, see [OAuth](OAUTH.md).

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
