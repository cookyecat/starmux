# Starmux 0.10.0 preview

This release introduces the Starmux name, background `up`, CWD-based first setup, `--code` / `--write`, unified authentication commands and explicit migration from Mac MCP Gateway.

`starmux@0.10.0` is published on npm with the `latest` tag. The public package passed an isolated global install, startup, MCP verification, API-key creation, authenticated verification and shutdown. Its integrity matched the locally tested tarball.

The source tree also includes a subsequent macOS menu restoration and README presentation update. These presentation changes are not retroactively included in the already-published 0.10.0 archive. The restored monitor uses the selected instance’s active configuration, actual port and anonymous tool activity. UI acceptance covered stopping a CLI instance, starting it under App ownership, opening permissions and advanced settings, and quitting the App while an independent CLI instance kept running.

## Included

- TypeScript CLI/Core, automatic local initialization and supervised background processes.
- Read-only and full OS-account coding modes, independent instances and JSONC configuration with apply/rollback.
- Ingress, API-key and OAuth authentication; local Access console and persistent revocation.
- macOS App source and development build tooling.

## Tested deployment history

ChatGPT web OAuth over Tunnel has passed login, coding, session revocation and fresh-login recovery on the earlier Core. WorkBuddy HTTPS + API key has passed remote file reads/writes. Those results describe the recorded deployments; this CLI rebrand does not rerun their external services automatically. See [clients](CLIENTS.md) and the [validation archives](README.md#validation-archives).

## Preview limits

Windows native installation and the new CLI's Linux release acceptance remain pending. The macOS App is not distributed as a signed, notarized public download. OAuth provider provisioning, general user-defined script hooks and multi-computer orchestration are future work.

[Install](INSTALL.md) · [Remote setup](REMOTE_SETUP.md) · [Platforms](PLATFORMS.md)
