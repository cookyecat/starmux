# How can I secure a self-hosted remote MCP endpoint with OAuth?

**Short answer:** Use [Starmux](https://github.com/cookyecat/starmux) as the **OAuth 2.0 resource server** for your MCP tools, and an **authorization server** such as self-hosted Keycloak for browser login and token issuance. Publish a protected HTTPS MCP endpoint and the required OAuth discovery endpoints, then verify that unauthorized requests are rejected.

OAuth decides **who can connect**; Starmux's read-only and coding modes govern **what connected tools may do**.

## 1. Know the components

| Component | Responsibility |
| --- | --- |
| **Starmux** | Serves `/mcp` and OAuth Protected Resource Metadata; validates signed access tokens. |
| **Keycloak** | Handles user login, PKCE (`S256`), token issuance, client registration and JWKS. |
| **HTTPS reverse proxy** | Publishes the required MCP, metadata and Keycloak authorization routes. |
| **MCP client (e.g., ChatGPT Web)** | Signs in and presents an access token for protected tool calls. |

The documented same-origin deployment looks like this:

~~~text
https://auth.example.com/mcp                 -> Starmux 127.0.0.1:18893
https://auth.example.com/realms/gateway/...  -> Keycloak 127.0.0.1:18080
~~~

Starmux does **not** mint OAuth tokens. You should never embed an OAuth client secret or Keycloak admin password in the project repository.

## 2. Start Starmux on the tool host

With Node.js **22.12+**:

~~~bash
npm install -g starmux
cd /path/to/your/project
starmux up
starmux verify
~~~

Start with the default loopback-only, read-only MCP endpoint.

## 3. Prepare the Keycloak authorization server

The [Starmux Keycloak guide](../SECURITY.md#4-oauth-20--pkce-oauth-with-keycloak) documents **Keycloak 26.8.1**, Java 21, PostgreSQL 17, and the `resource-indicators` feature.

Open ChatGPT's custom MCP setup to obtain its exact callback URL, then generate the realm import template:

~~~bash
starmux auth oauth init-keycloak \
  --resource https://auth.example.com/mcp \
  --callback https://chatgpt.com/connector/oauth/YOUR_CALLBACK_ID > gateway-realm.json
~~~

Import the generated realm into Keycloak. Configure the database and Keycloak according to the complete [Security Guide](../SECURITY.md), create an enabled owner in the `gateway` realm and record the owner's **Keycloak user ID** (not the display name). Retrieve the confidential `gateway-chatgpt` client's secret for use in ChatGPT.

The realm import, owner account, HTTPS identity-provider routes, and token/audience mapping are real prerequisites; the command above is **not a complete one-command OAuth deployment**.

## 4. Publish only the required HTTPS routes

The reverse proxy must expose the Starmux MCP resource and its OAuth Protected Resource Metadata:

- `/mcp`
- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-protected-resource/mcp`

It must also expose the documented Keycloak login, OIDC discovery and token routes. Keep local owner-management paths such as `/access` and `/dashboard` private. Use the [complete Caddy configuration](../SECURITY.md#4-oauth-20--pkce-oauth-with-keycloak), rather than copying a simple `/mcp`-only reverse proxy from a non-OAuth example.

## 5. Configure and activate OAuth in Starmux

After the authorization server is running and you know the owner's actual Keycloak subject ID:

~~~bash
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
~~~

The `--subject` value is the allowlisted owner user ID. The `--client-id` corresponds to the authorized OAuth client; `--token-auth` selects the supported token-endpoint client authentication method. The documented access scope is `gateway:access`.

Starmux validates access-token signatures and relevant claims including subject, audience/resource, authorized client, scope and session identity. An unrelated token must not authorize access to your MCP tools.

## 6. Connect ChatGPT and verify the authorization boundary

In ChatGPT's custom MCP OAuth setup, use the resource URL `https://auth.example.com/mcp` and the **provided/custom OAuth client** registration option from the [ChatGPT guide](../CLIENTS.md). Enter the registered client ID and Keycloak client secret **in ChatGPT**, not in the Starmux repository. The redirect URI must match the registered callback and the login flow uses PKCE `S256`.

Verify both conditions:

1. **Unauthenticated** MCP requests to the protected `/mcp` endpoint are rejected (normally HTTP 401), while the required discovery metadata remains readable.
2. After browser sign-in, ChatGPT can invoke a **read-only** MCP tool on the intended host.

**Using OpenAI Secure MCP Tunnel with OAuth?** The tunnel may rewrite the public MCP resource identifier. Follow the [resource-alias and audience-mapping procedure](../CLIENTS.md#2-chatgpt-web-tunnel-direct-https--oauth). Reuse the **exact resource URL discovered by ChatGPT**, rather than inventing a new audience.

## 7. Revoke a session

~~~bash
starmux auth
starmux auth revoke SESSION_ID
~~~

Revocation blocks subsequent requests from that session. To stop the same identity signing in again, also update the allowed `--subject` / `--subjects` configuration.

## Common Questions (FAQ)

### Q: When should I use OAuth 2.0 + PKCE instead of a Starmux Bearer API key (`starmux auth key`)?
- **Use a Bearer API key (`smx_...`)** for AI coding clients (`Codex`, `Cursor`, `Claude Code`, `Antigravity`, `WorkBuddy`, etc.) that support `"headers": { "Authorization": "Bearer smx_..." }` or `bearer_token_env_var`. It takes one command (`starmux auth key "Client"`) and requires no external identity server.
- **Use OAuth 2.0 + PKCE (Keycloak)** for cloud browser AI connectors (such as **ChatGPT Web** custom MCP connectors) that require interactive browser sign-in and OAuth Protected Resource Metadata discovery (`/.well-known/oauth-protected-resource`).

### Q: Why does ChatGPT OAuth over OpenAI Secure MCP Tunnel require `--resource-aliases`?
When ChatGPT discovers an MCP server through an OpenAI Secure MCP Tunnel, the tunnel rewrites the public MCP resource URL. Passing `--resource-aliases 'EXACT_DISCOVERED_RESOURCE_URL'` to `starmux auth oauth setup` (and mapping that audience in Keycloak) allows Starmux to validate access tokens minted for the tunnel-rewritten resource URL.

## Related guides

- [Full Keycloak and OAuth configuration](../SECURITY.md)
- [ChatGPT Web: HTTPS, Tunnel and OAuth](../CLIENTS.md)
- [MCP behind NAT: HTTPS vs Tunnel](mcp-behind-nat-https-vs-tunnel.md)
- [Self-hosted Remote MCP gateway](self-hosted-remote-mcp-gateway.md)
- [Use-case index](README.md)
