# Security, Access Control & Authentication

Starmux connects AI clients to real tools on your machine. **Authentication** (`none`, `api-key`, `oauth`) controls **who can connect**; **Permission Modes** (`--read`, `--code`) control **what connected tools are allowed to do**.

---

## Table of Contents

1. [Permission Modes & Trust Boundaries](#1-permission-modes--trust-boundaries)
2. [Choosing an Authentication Mode & Web Console](#2-choosing-an-authentication-mode--web-console)
3. [Bearer API Keys (`api-key`)](#3-bearer-api-keys-api-key)
4. [OAuth 2.0 + PKCE (`oauth` with Keycloak)](#4-oauth-20--pkce-oauth-with-keycloak)
5. [OAuth Technical Reference & Token Contract](#5-oauth-technical-reference--token-contract)

---

## 1. Permission Modes & Trust Boundaries

Every Starmux instance operates in one of two global permission modes:

| Permission Mode | CLI Command | Allowed Operations | Blocked Operations |
| :--- | :--- | :--- | :--- |
| **Read-Only Mode** *(default)* | `starmux up` *(or `starmux up --read`)* | Reading files (`read_file`, `read_multiple_files`), listing directories, and searching code wherever your OS account and upstream server permit. | All file writes/edits, directory creation, Shell command execution, and Git mutations. |
| **Coding Mode** | `starmux up --code` *(or `starmux up --write`)* | Full native tool access—reading/writing files, running Shell commands, and executing Git workflows—using your OS account's permissions. | Blocked only by OS permissions (POSIX/Windows ACLs, macOS TCC/FDA) or explicit deny rules. |

### Key Security Boundaries
- **`Project` Is a Path Context, Not a Chroot Jail:** In Read-Only mode, `Project` sets the base directory for resolving relative file paths. Read-Only mode allows reading files outside `Project` (such as `/etc/hosts` or shared system libraries) whenever your OS account and upstream server permit reading them.
- **Batch Read Limits in Read-Only Mode:** To prevent resource exhaustion, `read_multiple_files` in Read-Only mode enforces a limit of **20 files** and **4 MiB** of combined file size per batch. Exceeding either limit returns `BATCH_READ_COUNT_LIMIT` or `BATCH_READ_SIZE_LIMIT` with guidance to split the request. Missing files in a batch report `ENOENT` individually without discarding successful files in the same batch.
- **Multi-Instance Isolation:** Multiple instances (`-i NAME`) use separate TCP ports, API keys, OAuth settings, and logs, but share the same OS user account.
- **Custom Workspace Policies:** While standard instances use global Read-Only or Coding mode, explicit custom `config.jsonc` setups can retain workspace-scoped policies, including the macOS `home-only` write sandbox (see [`INSTANCES.md`](INSTANCES.md)).
- **Loopback-Only Network Listener:** Starmux listens exclusively on `127.0.0.1` and rejects non-loopback `Host` headers (`403 HOST_NOT_ALLOWED`) or non-loopback TCP peers (`403 LOOPBACK_REQUIRED`). **Never expose the raw loopback port directly to the public internet.**

---

## 2. Choosing an Authentication Mode & Web Console

Each Starmux instance enforces one active authentication mode at a time (switching from `api-key` to `oauth` disables API keys on that instance, and vice versa):

| Mode | When to Use | CLI Command |
| :--- | :--- | :--- |
| **`none`** *(default, alias `ingress`)* | Connecting on the same computer (`127.0.0.1`), over SSH port forwarding, or via a tunnel that already enforces caller login | `starmux auth mode none` |
| **`api-key`** *(recommended for remote)* | Connecting remote AI clients that support an `Authorization: Bearer <key>` header (e.g., WorkBuddy, Cursor, Codex) | `starmux auth key "My AI Client"` |
| **`oauth`** | Connecting cloud clients that require browser sign-in and consent (e.g., ChatGPT Web) | `starmux auth oauth setup ...` then `starmux auth mode oauth` |

> [!IMPORTANT]
> HTTPS encrypts traffic in transit, and an unadvertised domain name does **not** authenticate callers. Always enable `api-key`, `oauth`, or strict access control on your tunnel/reverse proxy before opening remote access.

### Local Web Access Console (`starmux dashboard`)

```sh
starmux dashboard             # Open in default browser with owner login
starmux dashboard --no-open   # Print a private localhost login link (http://127.0.0.1:<PORT>/access#token=...)
starmux dashboard --token     # Print the raw owner management token
```

- The Web Access Console (`/access` and `/dashboard`) is strictly local (`127.0.0.1`) and must never be exposed when proxying `/mcp` remotely.
- Keep owner management tokens and login links private on your host—give AI clients a Bearer API key or OAuth login instead.

---

## 3. Bearer API Keys (`api-key`)

Creating a key automatically enables `api-key` mode on the instance and prints both Form UI settings and a ready-to-paste `mcpServers` JSON block:

```sh
# Create a non-expiring API key
starmux auth key "WorkBuddy"

# Or create a key with automatic expiration (supports 30m, 12h, 30d, 4w, or a future ISO timestamp)
starmux auth key "Temp Laptop" --expires 30d
```

Example output:

```text
API key enabled for WorkBuddy (ID: cred_...)
Copy this key now; it is shown only once:

  smx_...
```

- **Save the secret immediately:** Keys start with `smx_`. Starmux stores only a cryptographic digest on disk, never the raw key.
- **Inspect active keys & sessions:**
  ```sh
  starmux auth
  ```
- **Instant Revocation:**
  ```sh
  starmux auth revoke CREDENTIAL_ID
  ```
  Revocation takes effect on the very next HTTP request (`HTTP 401`) without restarting Starmux or running `config apply` (already-executing tool calls are not canceled mid-flight).

---

## 4. OAuth 2.0 + PKCE (`oauth` with Keycloak)

In `oauth` mode, Starmux acts as an **OAuth 2.0 Resource Server**, while a dedicated **Authorization Server** (such as self-hosted **Keycloak 26.8.1**) handles browser login, PKCE (`S256`), consent, and token issuance.

```text
https://auth.example.com/mcp                    ──▶ Starmux (127.0.0.1:18893)
https://auth.example.com/realms/gateway/...     ──▶ Keycloak (127.0.0.1:18080)
```

### Step 1 — Generate the Keycloak Realm Import File

Open ChatGPT's custom MCP creator to view its exact **Callback URL** (keep that definition open so the callback URL stays fixed), then generate the realm file:

```sh
starmux auth oauth init-keycloak \
  --resource https://auth.example.com/mcp \
  --callback https://chatgpt.com/connector/oauth/YOUR_CALLBACK_ID > gateway-realm.json
```

Place `gateway-realm.json` in Keycloak's `data/import/gateway-realm.json`. The generated template contains no hardcoded users or passwords, requires `S256` PKCE and explicit consent, disables password/implicit grants, and configures a `gateway-resource` client with a `gateway:access` audience mapper.

### Step 2 — Start Keycloak 26.8.1 (with Java 21 & PostgreSQL 17)

Configure your Keycloak environment variables in a private service file (never commit passwords to Git):

```ini
KC_DB=postgres
KC_DB_URL=jdbc:postgresql://127.0.0.1:5432/gateway
KC_DB_USERNAME=gateway
KC_DB_PASSWORD=<database-role-password>
KC_BOOTSTRAP_ADMIN_USERNAME=gateway-admin
KC_BOOTSTRAP_ADMIN_PASSWORD=<temporary-bootstrap-password>
```

Start Keycloak on loopback port `18080` with `resource-indicators` enabled (do not use `start-dev` publicly):

```sh
/absolute/path/keycloak-26.8.1/bin/kc.sh start \
  --features=resource-indicators \
  --http-enabled=true --http-host=127.0.0.1 --http-port=18080 \
  --hostname=https://auth.example.com \
  --proxy-headers=xforwarded --proxy-trusted-addresses=127.0.0.1 \
  --import-realm
```

Using Keycloak's local admin CLI (`bin/kcadm.sh` on `http://127.0.0.1:18080`):
1. Authenticate with `bin/kcadm.sh config credentials --server http://127.0.0.1:18080 --realm master --user gateway-admin`.
2. In realm `gateway`, create an enabled owner user account with a non-temporary password and record its **User ID (`OWNER_USER_ID`)**.
3. Retrieve the generated **Client Secret** for client `gateway-chatgpt` (paste this only into ChatGPT; Starmux never needs the client secret).

### Step 3 — Publish Only the Required HTTPS Routes (Caddy)

Use this `Caddyfile` to expose `/mcp` and OAuth Protected Resource metadata alongside Keycloak's public OIDC routes, while keeping `/admin`, `/access`, and `/dashboard` private:

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

### Step 4 — Configure Starmux & Verify Discovery

```sh
starmux auth oauth setup \
  --issuer https://auth.example.com/realms/gateway \
  --resource https://auth.example.com/mcp \
  --client-id gateway-chatgpt \
  --token-auth client_secret_basic \
  --subject OWNER_USER_ID

starmux auth oauth doctor
starmux auth mode oauth
starmux auth oauth status
starmux up
```

Confirm that unauthenticated requests to `/mcp` return `HTTP 401`, while `https://auth.example.com/.well-known/oauth-protected-resource/mcp` is publicly readable. Then complete the client setup in **[AI Client Guides — ChatGPT Web](CLIENTS.md#2-chatgpt-web-tunnel-direct-https--oauth)**.

### Step 5 — View & Revoke OAuth Sessions

```sh
starmux auth
starmux auth revoke SESSION_ID
```

- **Persistent Session Revocation:** Revoking a `SESSION_ID` blocks all subsequent requests from that provider session (`sid`), even if the identity provider issues refreshed access tokens or Starmux restarts.
- **Re-login vs. Permanent Account Block:** Signing in again with a fresh provider session can create a new authorized session. To block an account completely, remove its subject ID from `--subject` / `--subjects` via `starmux auth oauth setup`.

---

## 5. OAuth Technical Reference & Token Contract

| Aspect | Specification in Starmux |
| :--- | :--- |
| **Discovery Endpoints** | Serves RFC 9728 Protected Resource Metadata at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp`. |
| **Token Format & Claims** | Requires signed JWT access tokens containing `sub` (owner user ID), `azp` (OAuth client ID), `sid` (stable session ID), `aud` (resource URL), `scope` (must include `gateway:access`), `iat`, and `exp`. Opaque tokens are not supported. |
| **JWKS Caching** | Signing keys are cached for up to 5 minutes; unknown `kid` values trigger a JWKS refresh after a short cooldown. |
| **Session Memory Bound** | Remembers up to 512 OAuth sessions without evicting revocation records. At capacity, new sessions fail closed. |
| **`starmux auth oauth setup` Flags** | • `--issuer <URL>`: OIDC/OAuth issuer URL (must be HTTPS on the same origin as discovery/JWKS).<br/>• `--resource <URL>`: Canonical public MCP endpoint URL.<br/>• `--resource-aliases <URL1,URL2>`: Optional comma-separated alternate resource URLs (up to 8; required when OpenAI Tunnel rewrites the resource identifier). Re-running `setup` without `--resource-aliases` clears existing aliases.<br/>• `--client-id <ID>`: Expected `azp` claim (e.g., `gateway-chatgpt`).<br/>• `--subject <ID>` *(or `--subjects <ID1,ID2>`)*: Allowed owner `sub` claim(s).<br/>• `--registration <provided\|cimd\|dcr>`: Defaults to `provided`.<br/>• `--token-auth <none\|client_secret_basic\|client_secret_post\|private_key_jwt>`: Defaults to `none` (`init-keycloak` uses `client_secret_basic`).<br/>• `--allow-loopback-http`: Isolated local development only; never use in remote deployments. |

To report a security vulnerability privately, see [`SECURITY.md`](../SECURITY.md) in the repository root.

---

[Documentation Index](README.md) · [Installation & Networking](INSTALL.md) · [AI Client Guides](CLIENTS.md) · [Multi-Instance & Config](INSTANCES.md)
