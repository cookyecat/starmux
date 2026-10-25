# Authentication

Authentication decides who can connect. Your instance configuration decides what its tools can do.

## Choose an authentication mode

| Mode | Use when | Configure |
| --- | --- | --- |
| `ingress` | An existing protected ingress controls callers | Protect ingress, then `starmux auth mode ingress` |
| `api-key` | Your client accepts a Bearer key | `starmux auth key "My client"` |
| `oauth` | Your client uses browser login and consent | [Configure a provider](OAUTH.md), then `starmux auth mode oauth` |

A new local instance uses `ingress`. For remote access in this mode, the ingress must restrict access; HTTPS encrypts traffic but does not authenticate callers. One instance has one active mode. All its authorized clients use the same approved tool permissions.

## API keys

```sh
starmux auth key "WorkBuddy" --expires 30d
starmux auth
starmux auth revoke CREDENTIAL_ID
```

Creating a key also enables API-key mode. Copy the key when printed; Starmux stores only its digest. New keys begin with `smx_`; migrated `mgw_` keys continue to work. Expiration accepts positive durations (`30m`, `12h`, `30d`, `4w`) or a future ISO timestamp. Omit it for no expiry.

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
