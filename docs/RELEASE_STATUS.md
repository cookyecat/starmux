# Starmux 0.11.0 preview

This release restores the product story, connection overview and native App showcase in the README, and includes the complete user documentation and a real screenshot of the restored status monitor in the npm package. It retains the CLI workflow introduced in 0.10.0: background `up`, CWD-based first setup, `--code` / `--write`, unified authentication and explicit migration.

The macOS App source restores the status monitor as the main interface, with advanced instance management behind a secondary entry. It shows the selected instance’s active configuration, actual port and anonymous tool activity. UI acceptance covered stopping a CLI instance, starting it under App ownership, opening permissions and advanced settings, and quitting the App while an independent CLI instance kept running.

The npm package includes the App screenshot and build guide; the native `.app` is distributed separately. Updating npm does not replace an installed macOS App.

## Included

- TypeScript CLI/Core, automatic local initialization and supervised background processes.
- Read-only and full OS-account coding modes, independent instances and JSONC configuration with apply/rollback.
- Ingress, API-key and OAuth authentication; local Access console and persistent revocation.
- Complete user guides, connection diagrams and the native App screenshot.
- macOS App source and development build tooling in the source repository.

## Release validation

The 0.11.0 release workflow checks the final tarball contents, installs it in an isolated prefix and exercises startup, MCP verification, API-key authentication and shutdown. After publication, the same workflow is repeated from the public registry and the package integrity is compared with the tested archive.

The preceding public 0.10.0 package passed this install-and-run workflow on macOS. The restored App also passed its native build, self-tests and UI ownership checks.

## Tested deployment history

ChatGPT web OAuth over Tunnel has passed login, coding, session revocation and fresh-login recovery on the earlier Core. WorkBuddy HTTPS + API key has passed remote file reads/writes. Those results describe the recorded deployments; this CLI rebrand does not rerun their external services automatically. See [clients](CLIENTS.md) and the [validation archives](README.md#validation-archives).

## Preview limits

Windows native installation and the new CLI's Linux release acceptance remain pending. The macOS App is not distributed as a signed, notarized public download. OAuth provider provisioning, general user-defined script hooks and multi-computer orchestration are future work.

[Install](INSTALL.md) · [Remote setup](REMOTE_SETUP.md) · [Platforms](PLATFORMS.md)
