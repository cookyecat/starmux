# Remote installation: HTTPS + API key, or ChatGPT OAuth

This guide follows the paths exercised with the real Gateway and Desktop Commander. Start with [local installation](INSTALL.md). Commands use the installed `mac-mcp-gateway` CLI. Shell examples use POSIX syntax; on Windows set environment variables in PowerShell and use the corresponding `.bat` Keycloak commands.

## Choose authentication independently of transport

| Authentication | Choose it when | Validated path |
| --- | --- | --- |
| Ingress-managed | Your existing ingress restricts access and you do not need a Gateway credential | Codex plugin through a protected OpenAI Tunnel |
| Bearer API key | Your client accepts an `Authorization` header | WorkBuddy over public HTTPS + IPv6, including remote reads and writes |
| OAuth | Your client presents a login/consent flow | ChatGPT web through OpenAI Tunnel + Keycloak, including coding and revocation |

HTTPS and Tunnel are transport choices; API key and OAuth are authentication choices. OAuth does not require Tunnel, and HTTPS alone does not authenticate callers. ChatGPT direct-HTTPS OAuth has not received the same end-to-end acceptance as the Tunnel deployment. Doubao compatibility is owner-reported; its precise transport/authentication combination has not been recorded. See the [client matrix](../README.md#ai-client-compatibility).

A Core has one active authentication mode. Switching to OAuth makes existing API keys unusable on that Core, and vice versa. This guide configures one Core at a time, not simultaneous API-key/OAuth listeners. The separate acceptance instances used during development are not a prerequisite for ordinary installation.

## 1. Install locally and choose permissions

Follow [Install](INSTALL.md), then confirm the port in `mac-mcp-gateway status`. Examples below use **18893**; replace it everywhere if your startup panel reports another port.

For the full coding workflow on macOS, explicitly choose the trusted role:

```sh
mac-mcp-gateway setup --access-role trusted --connection https --approve-trusted-developer
mac-mcp-gateway doctor
```

Use `--connection tunnel` for that preference instead. Setup saves a preference; it does not provision DNS, certificates, a proxy, a Tunnel or an authorization server. Existing profiles are not overwritten; follow the replacement instructions in [Install](INSTALL.md). Linux/Windows trusted mode also requires `--approve-unrestricted` and uses OS-account permissions, not the macOS Home-only sandbox.

Authentication grants access to the **existing owner-approved policy**. It does not assign separate workspaces or Shell sandboxes to different keys/accounts.

All commands and the running Core must use the same access store, normally `~/.config/mac-mcp-gateway/access-v1.json`. If using an isolated store, set `MAC_MCP_ACCESS_FILE` to the same absolute path in every management terminal and in the Core launcher. Otherwise you may configure or revoke credentials in a store the server is not using.

## 2. HTTPS + Bearer API key

### Create the credential before exposing MCP

```sh
mac-mcp-gateway access create "WorkBuddy"
mac-mcp-gateway access mode api-key
mac-mcp-gateway access status
mac-mcp-gateway run
```

Save the secret shown once in the client's private configuration. Gateway keeps its digest, not the secret. A credential ID from `access list` is not the Bearer secret.

### Route HTTPS to the loopback Core

Install Caddy, point your own DNS A/AAAA record at a reachable address, and arrange a valid certificate. Save this as your Caddyfile, replacing the hostname and local port:

```caddyfile
{
    admin off
}
mcp.example.com {
    handle /mcp {
        reverse_proxy 127.0.0.1:18893 {
            header_up Host 127.0.0.1:18893
        }
    }
    handle {
        respond "Not found" 404
    }
}
```

```sh
caddy validate --config /absolute/path/Caddyfile --adapter caddyfile
caddy run --config /absolute/path/Caddyfile --adapter caddyfile
```

Caddy's automatic certificate provisioning requires a working ACME validation route. Binding standard ports may require OS service/administrator setup. Keep the process running or install it as a managed service. Keep `/access`, `/dashboard` and all owner-management routes private. The proxy preserves the client's Authorization header; do not replace it with a shared privileged credential.

**Already have a certificate, or using port 8443?** The tested IPv6 variant uses `https://mcp.example.com:8443` as the site address, `bind YOUR_PUBLIC_IPV6` and `tls /absolute/path/cert.crt /absolute/path/cert.key` inside the site block. Include `:8443` in the client URL. Certificate renewal and proxy reload remain your responsibility. An IPv6-only endpoint requires an IPv6-capable client execution environment; test from another network rather than assuming DNS proves reachability.

### Configure WorkBuddy or another header-capable client

For WorkBuddy, merge this entry into `~/.workbuddy/mcp.json` without replacing unrelated servers:

```json
{
  "mcpServers": {
    "my-gateway": {
      "type": "streamable-http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer REPLACE_WITH_YOUR_GATEWAY_KEY" }
    }
  }
}
```

Protect the file with owner-only permissions (Unix `chmod 600`, or equivalent Windows ACLs), then reload the client's MCP configuration. The placeholder is not a working key. Do not commit the real file.

For a Codex HTTP MCP configuration, the official client supports an environment-sourced Bearer value:

```toml
[mcp_servers.my_gateway]
url = "https://mcp.example.com/mcp"
bearer_token_env_var = "MAC_MCP_API_KEY"
```

Set that variable securely in the environment of the actual Codex process; setting it in an unrelated terminal does not configure an already running desktop app. This is a documented configuration example, not a claim that this exact Codex API-key path has received project acceptance. See [official Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

### Verify, then test revocation

1. From the remote client, explicitly select this Gateway and call `health_check`.
2. Read an owner-approved test file. If trusted coding is enabled, create, read back and run a small script in a dedicated test directory. Do not substitute the client's own local tools.
3. Run `mac-mcp-gateway access list`, identify that client's credential, then `mac-mcp-gateway access revoke CREDENTIAL_ID`.
4. The next MCP request with that key must fail with HTTP 401. A missing/wrong key must also fail. Already-running tools are not canceled.
5. Create a new key to restore access; update the client's private configuration.

Local `mac-mcp-gateway verify` in API-key mode reads `MAC_MCP_API_KEY` from its environment. Local PASS is not external acceptance. [WorkBuddy evidence and limits](VALIDATION_WORKBUDDY.md).

## 3. OAuth: deploy the authorization server

This is currently an **operator setup**, not a one-click wizard. The tested provider is Keycloak **26.8.1**, Java **21**, with persistent PostgreSQL **17**. The Gateway package does not install or operate these services for you. Use official distributions and maintain backups/upgrades; the pinned version describes the tested baseline, not a promise of indefinite security support.

For the tested Tunnel layout, use one HTTPS origin for both MCP and the issuer:

```text
https://auth.example.com/mcp                         → Core 127.0.0.1:18893
https://auth.example.com/realms/gateway/...          → Keycloak 127.0.0.1:18080
```

Create your ChatGPT custom MCP definition and copy its **exact callback URL**. Keep that definition while configuring the provider; a callback from another definition is not interchangeable.

### Prepare Keycloak and persistent storage

1. Install Java 21 and unpack the official Keycloak 26.8.1 distribution into a private operator directory. Provision a dedicated persistent PostgreSQL database and role with access only to that database. Do not use the Gateway's disposable in-memory test deployment for real accounts.
2. Generate the realm import; use your hostname and callback:

```sh
mac-mcp-gateway access oauth keycloak-realm \
  --resource https://auth.example.com/mcp \
  --callback https://chatgpt.com/connector/oauth/YOUR_CALLBACK_ID > gateway-realm.json
```

3. Place this file in Keycloak's `data/import/gateway-realm.json`. Configure the following environment variables in a private service environment file or secret manager. Values below are placeholders; do not paste real passwords into shell history or Git:

```text
KC_DB=postgres
KC_DB_URL=jdbc:postgresql://127.0.0.1:5432/gateway
KC_DB_USERNAME=gateway
KC_DB_PASSWORD=<database-role-password>
KC_BOOTSTRAP_ADMIN_USERNAME=gateway-admin
KC_BOOTSTRAP_ADMIN_PASSWORD=<temporary-bootstrap-password>
```

4. With that environment loaded, start the provider:

```sh
/absolute/path/keycloak-26.8.1/bin/kc.sh start \
  --features=resource-indicators \
  --http-enabled=true --http-host=127.0.0.1 --http-port=18080 \
  --hostname=https://auth.example.com \
  --proxy-headers=xforwarded --proxy-trusted-addresses=127.0.0.1 \
  --import-realm
```

Run the provider under a service manager for sustained use. Realm import initializes a new realm; it is not a general update mechanism for an existing realm. Do not use public `start-dev`. Keycloak's resource-indicators feature is experimental in this tested version.

5. Manage Keycloak locally with its admin CLI, or through a separately protected administrative route. The public proxy below intentionally does not expose `/admin`. For local CLI access, authenticate with `bin/kcadm.sh config credentials --server http://127.0.0.1:18080 --realm master --user gateway-admin` and enter the password when prompted. Use an owner-only home/config for the admin CLI's stored credentials.
6. In realm `gateway`, create a dedicated enabled owner account with a non-temporary password; record its user ID. For CLI provisioning, `kcadm.sh create users -r gateway -f /private/path/owner.json` accepts a private user representation with `username`, `enabled: true`, profile fields and `credentials: [{"type":"password","value":"<owner-password>","temporary":false}]`. Create that file with an editor and owner-only permissions. Do not put it in the repository. Meet the realm's required profile fields; if email is unnecessary, explicitly make it optional rather than inventing an address.
7. Obtain the generated secret for client `gateway-chatgpt` using the protected admin interface/CLI and store it securely for entry into ChatGPT. The client requires authorization code + S256 + consent, with no password/implicit grant. Retire bootstrap administrator credentials according to Keycloak's operational guidance.

See [Keycloak deployment](https://www.keycloak.org/server/configuration) and [reverse proxy requirements](https://www.keycloak.org/server/reverseproxy) for platform-specific administration and service hardening.

### Publish only the required HTTPS routes

Use this Caddyfile instead of the API-key-only one:

```caddyfile
{
    admin off
}
auth.example.com {
    @mcp path /mcp /.well-known/oauth-protected-resource /.well-known/oauth-protected-resource/mcp
    handle @mcp {
        reverse_proxy 127.0.0.1:18893 {
            header_up Host 127.0.0.1:18893
        }
    }
    @oauth path /realms/gateway/.well-known/* /realms/gateway/protocol/openid-connect/* /realms/gateway/login-actions/* /resources/*
    handle @oauth {
        reverse_proxy 127.0.0.1:18080 {
            header_up X-Forwarded-Proto https
            header_up X-Forwarded-Host auth.example.com
            header_up X-Forwarded-Port 443
        }
    }
    handle {
        respond "Not found" 404
    }
}
```

Validate and run Caddy as in the API-key section. This allowlist is for the **provided-client** setup; it does not publish DCR registration or administrative APIs. On an IPv6-only host, optionally bind the actual stable IPv6 address and keep its AAAA record current.

Before enabling public MCP access, configure Core authentication as below. If the proxy is already running while Core still uses ingress mode, keep the `/mcp` route disabled until OAuth mode is set. Issuer metadata can be exposed first for configuration.

## 4. Configure Core and ChatGPT

```sh
mac-mcp-gateway access oauth configure \
  --issuer https://auth.example.com/realms/gateway \
  --resource https://auth.example.com/mcp \
  --client-id gateway-chatgpt \
  --token-auth client_secret_basic \
  --subjects OWNER_USER_ID
mac-mcp-gateway access oauth doctor
mac-mcp-gateway access mode oauth
mac-mcp-gateway run
```

If the Core is already running with this same store, configuration changes apply to subsequent requests; do not start a duplicate Core. `doctor` verifies provider discovery, not a remote login. Confirm that unauthenticated `/mcp` requests return 401, while `https://auth.example.com/.well-known/oauth-protected-resource/mcp` is publicly readable.

In ChatGPT's custom MCP definition choose OAuth and **custom/provided client**, client ID `gateway-chatgpt`, its client secret, token authentication `client_secret_basic`, and base/default scope `gateway:access`. Keep OIDC/domain claim off for this setup. Let discovery populate endpoints. Do not select DCR or CIMD for this reference deployment. See the complete [field table](OAUTH.md#what-to-enter-in-chatgpt) and [OpenAI authentication documentation](https://developers.openai.com/plugins/build/auth).

### Direct HTTPS

Use `https://auth.example.com/mcp` as the server URL. Core and Keycloak use that same resource identifier. This configuration is supported by the resource-server design; real ChatGPT direct-HTTPS acceptance is still separate from the tested Tunnel path. Verify reachability from the client's actual network, especially for IPv6-only deployments.

### Official OpenAI Tunnel — tested ChatGPT path

Provision your own Tunnel and runtime credential using [OpenAI's guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels). The existing [Tunnel guide](CONNECT_CHATGPT.md#2-secure-mcp-tunnel--no-inbound-port) explains workspace permissions. For OAuth on the tested tunnel-client **0.0.16** layout:

- Set `--mcp.server-url url=https://auth.example.com/mcp`.
- Set `--mcp.oauth-trusted-origin https://auth.example.com`.
- Keep the Tunnel ID and runtime secret in private client configuration; neither is the OAuth client secret.
- Retain automatic OAuth target registration. Do not substitute generic Harpoon targets or disable TLS checks. The tested layout registered ten typed OAuth targets.
- Choose that Tunnel in ChatGPT, then discover OAuth metadata.

**Important resource-alias step:** Tunnel discovery rewrites the MCP resource identifier. Copy the exact discovered **Resource** value from ChatGPT. Do not invent it, use a wildcard, or copy the maintainer's Tunnel ID.

1. In Keycloak, register a dedicated bearer-only OpenID Connect resource client (e.g. `gateway-tunnel-resource`) with the attribute `resource_url` equal to that exact value; disable login/service-account flows for it.
2. In client scope `gateway:access`, add an **Audience** mapper with Included Client Audience `gateway-tunnel-resource` and Add to access token enabled. Registering only the client is insufficient: Keycloak must grant the audience before it narrows the issued token to the requested resource URL.
3. Re-run the Core configure command above with `--resource-aliases 'EXACT_DISCOVERED_RESOURCE_URL'` appended, then run `mac-mcp-gateway access oauth doctor`. Multiple exact aliases can be comma-separated (maximum eight). Reconfiguration without the option removes existing aliases, so include all intended aliases when updating. The canonical `--resource` remains unchanged.
4. Save the ChatGPT settings, sign in as the allowed owner and consent to the owner-approved tools.

Aliases are explicitly configured identifiers for this same Gateway, not trust in all Tunnel traffic. Core still verifies signature, issuer, client, subject, scope, lifetime and session revocation. No Core network-transport-specific identity inference is introduced.

The browser must reach the HTTPS login page, and the local Tunnel/Core must reach the issuer. With this same-origin layout, turning off IPv6 on an IPv6-only host breaks those dependencies even though the outbound Tunnel control connection may remain alive. Fake-IP DNS/TUN interception can also break resolution: fix the intended hostname route, not certificate validation. Update DNS, proxy bind and any hosts override together when the address changes.

## 5. Acceptance, management and recovery

From a fresh ChatGPT conversation, select the OAuth plugin and request `health_check`, followed by a read/write/run test confined to an explicitly approved disposable directory. Compare the result with Core audit entries showing `verified-oauth`; a successful login or tool list alone does not prove coding works.

```sh
mac-mcp-gateway access list
mac-mcp-gateway access revoke-oauth CONNECTION_ID
```

Revocation blocks that **session** on subsequent requests, including new tokens issued by refresh for the same session. It does not cancel already-running tools, undo files written earlier, revoke all clients, or globally disable that account. To deny an account completely, remove its subject from the configured allowlist. Reauthentication with a fresh authorized provider session can restore access; do not erase revocation records. If provider SSO keeps reusing the revoked session, end that provider session before logging in again.

Manage keys/sessions in the local **Dashboard → Access control**. The macOS App's **Open Dashboard** action reaches the same store; a separate native OAuth setup screen is not shipped. Read [owner token and file permissions](ACCESS_CONTROL.md) before administering it.

| Symptom | Check |
| --- | --- |
| Local Core healthy, remote connection fails | Proxy/Tunnel route, TLS, DNS and actual remote address-family reachability |
| Metadata discovery fails | Both protected-resource paths, issuer discovery and same-origin Tunnel configuration |
| Keycloak rejects requested resource | Exact discovered resource, resource client's attribute, granted audience mapper and Core aliases |
| HTTP 401 after revoke or idle expiry | Do not retry tools indefinitely; inspect local revocation state, then use a fresh authorized login if appropriate |
| HTTP 403 | Allowed owner/client and `gateway:access`; do not expand permissions just to hide a failure |
| OAuth works but a write is denied | Existing workspace/OS/upstream policy still applies |
| Web answer/app fails to render | Correlate actual tool/audit results before deciding whether execution failed; never automatically repeat a side-effecting call |
| CLI changes do not affect the server | Check `MAC_MCP_ACCESS_FILE`, launch environment and startup identity panel |

The local App, Core, proxy, database, provider and Tunnel have separate process lifecycles. Stopping Core stops new tool service; it does not automatically shut down the others. Persist private configuration and PostgreSQL/Caddy data, configure service startup deliberately, and repeat acceptance after reboot or deployment changes.

[OAuth contracts and acceptance evidence](OAUTH.md) · [Access control](ACCESS_CONTROL.md) · [Install](INSTALL.md) · [README](../README.md)
