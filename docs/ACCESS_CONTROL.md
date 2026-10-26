# Authentication

Authentication decides who can connect. Your instance configuration decides what its tools can do.

## Choose an authentication mode

| Mode | Use when | Configure |
| --- | --- | --- |
| `none` *(default)* | Connecting on the same computer, or your tunnel/reverse proxy already restricts callers | `starmux auth mode none` |
| `api-key` | Your client accepts a Bearer API key header | `starmux auth key "My AI Client"` |
| `oauth` | Your client uses browser login and consent (e.g., ChatGPT Web) | [Configure a provider](OAUTH.md), then `starmux auth mode oauth` |

A new local instance defaults to `none` (also accepted as `ingress`). For remote access in this mode, your tunnel or reverse proxy must restrict access; HTTPS encrypts traffic but does not authenticate callers. Each instance has one active authentication mode at a time, and all authorized clients share the instance's approved workspace permissions.

## API keys

```sh
starmux auth key "WorkBuddy" --expires 30d
starmux auth
starmux auth revoke CREDENTIAL_ID
```

Creating a key automatically enables `api-key` mode and prints both Form UI fields and a ready-to-paste `mcpServers` JSON snippet. Copy the key when printed; Starmux stores only its digest. New keys begin with `smx_` (migrated `mgw_` keys continue to work). Expiration accepts positive durations (`30m`, `12h`, `30d`, `4w`) or a future ISO timestamp. Omit it for no expiry.

Configure your client with `Authorization: Bearer YOUR_KEY`. See the [complete HTTPS example](REMOTE_SETUP.md#2-https--bearer-api-key).

## OAuth

```sh
starmux auth oauth setup --issuer https://auth.example.com/realms/gateway \
  --resource https://mcp.example.com/mcp --client-id gateway-chatgpt \
  --token-auth client_secret_basic --subject OWNER_USER_ID
starmux auth oauth doctor
starmux auth mode oauth
starmux auth
starmux auth revoke SESSION_ID
```

Setup discovers and saves provider settings; mode activation is explicit. The same revoke command recognizes API-key IDs and OAuth session IDs. Revoked OAuth sessions remain denied after token refresh and restart. [Provider requirements and ChatGPT fields →](OAUTH.md)

## Local management

```sh
starmux dashboard
starmux dashboard --no-open   # Print a private login link
starmux dashboard --token     # Print the owner management token
```

The console opens locally with its management token. Keep owner tokens and private login links on the host; AI clients receive an API key or OAuth token instead. Management endpoints stay local when you expose `/mcp` remotely.

All commands support `-i NAME` for a specific instance. Revocations and mode changes affect subsequent requests immediately, without `config apply`; executing tools are not canceled by revocation.
