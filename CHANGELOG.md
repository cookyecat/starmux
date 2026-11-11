# Changelog

## 0.18.1 - 2026-11-11

- Isolate request cancellation from shared middleware workers and upstream connections; retain bounded accounting for already dispatched plugin hooks.
- Distinguish applied, next-start, pending and unconfirmed gateway changes consistently in the Web console.
- Enforce a uniform 1 MiB MCP HTTP request-body limit for fixed-length and chunked requests, preserving UTF-8 across chunks.

- Explain instance selection errors, suggest registered instances for project paths, and distinguish instance names, IDs and project directories in the console.
- Add actionable CLI and bilingual console guidance for configuration, connection, authentication and middleware failures while retaining original error codes.
- Report failed connection tests and saved-but-unapplied service changes explicitly.

## 0.18.0 - 2026-11-11

- Add unified stdio, Streamable HTTP and explicit legacy SSE service management, with configuration/command/URL imports, bounded discovery, API-key references and independent outbound OAuth accounts. Manage services through the Web console or `starmux server` commands.
- Add the versioned `starmux/middleware` ESM and TypeScript API, isolated trusted plugin processes, built-in transformations, sample tests, explicit read caching and four-stage invocation diagnostics. Preserve canonical permission checks across aliases, routes and synthetic responses.
- Apply service and middleware changes without restarting the instance, validate candidates before replacing the active snapshot, and retain old generations for in-flight calls. Add namespaced resources/prompts and originating-client routing for supported server interactions.
- Verify production-only npm tarball installation and the public middleware interface in the platform CI matrix, including Node 22.12.0. Keep default `none` authentication, LAN behavior and ordinary startup unchanged.

- Add a structured Web console tool-call history with statuses, timings, search and filters. Record summaries by default and allow owner-local opt-in argument/result previews with bounded in-memory retention, credential-field masking and binary omission. Preserve the system log viewer.

- Preserve configured MCP services and Git/worktree compatibility values when switching Read-only/Coding modes.
- Cancel and await in-flight upstream connections during shutdown. Return actionable `UPSTREAM_CLOSED` feedback for undispatched calls and preserve uncertain-result feedback for interrupted calls.
- Copy client configurations for each displayed local, LAN or public endpoint; correct the README LAN port example.
- Show saved-configuration notices in the native macOS App and align Read-only/Coding labels.

- Omit inactive compatibility defaults from ordinary config templates and summaries. Keep existing JSONC values and workspace-scoped behavior compatible, and show mode-specific, nonblocking notices for explicit ignored Git/worktree settings in config commands and the local console.

- Rotate Core logs at 8 MiB with three backups, retain the recent tail of oversized legacy logs, and follow rotation in CLI log output. Flush worker output before confirming normal shutdown.
- Record private store lock ownership atomically and recover locks left by exited processes, including authentication store locks. Preserve live and unconfirmed legacy locks.
- Discover optional MCP upstreams concurrently with a shared per-child initialization/catalog deadline, alongside the built-in engine, so optional startup delays do not accumulate.
- Clarify that `gitMode` and `worktreeMode` are compatibility settings for workspace-scoped user projects, not Starmux build/development flags or requirements for ordinary Read-only/Coding use.
- Keep default authentication (`none`), LAN authentication behavior, and ordinary startup commands unchanged.

## 0.17.0 — 2026-11-08

- Add an independent loopback-only management console with bilingual light/dark UI, instance lifecycle controls, JSONC configuration, credentials, OAuth and logs.
- Preserve legacy instance owner tokens and expose separate dashboard service status/stop commands.
- Add isolated manager integration and responsive browser smoke coverage.

- Add persistent `--allow-lan` and `--local` (`--no-allow-lan`) networking modes, with live Worker restart and LAN MCP URLs in CLI status.
- Accept valid original domain/IP Host headers on MCP, health and OAuth resource discovery routes; tunnels and proxies no longer need Host rewriting.
- Keep every owner management route restricted to loopback peers and the exact local Host/port, including when LAN access is enabled.
- Add HTTP, CLI, legacy-config and port-conflict regression coverage.
- Make automatic port selection for new and copied LAN instances check all IPv4 interfaces; immediately close connections accepted by temporary port probes.

## 0.16.1

### Discovery and documentation

- Refine the npm package description to highlight the self-hosted remote MCP gateway, supported AI clients, Desktop Commander tools, and Linux / NVIDIA Jetson access.
- Update npm search keywords for MCP gateways, remote computer access, and compatible AI coding clients.
- Add task-focused use-case guides, including the tested WorkBuddy-to-Linux / NVIDIA Jetson connection and its verified `streamable-http` configuration.
- No runtime behavior or dependency changes in this release.

## 0.16.0

- Keep instance and port-lease identities in the private, durable `~/.config/starmux/control` directory instead of temporary storage.
- Use short hashed Unix socket paths and stop the owned worker if a control record or socket disappears, preserving a diagnostic reason.
- Allow a supervisor to finish cleanup after its own metadata is deleted, while refusing to remove a replaced control directory or another run's records.
- Add regression tests for deleting each instance/port owner record and Unix socket during a live run.
- Stop instances before changing to this control layout. 

## 0.15.0

### Instance lifecycle

- Version and validate the local instance control protocol independently of package releases.
- Report `unknown` when control records or channels cannot establish the instance's state; do not mistake a missing control channel for a stopped service.
- Confirm cleanup before `down` reports success. Repeated stops report `Already stopped`; failed or timed-out cleanup returns a nonzero exit code.
- Use the same stop confirmation for instance archival and protect successor runs during concurrent operations.
- Separate confirmed active configuration, saved settings and historical snapshots in CLI and JSON output.
- Prevent `up` from changing permissions in an unknown state, prevent `doctor` from passing unresolved runtime errors, and show unknown states in the macOS App.
- Add isolated lifecycle and real CLI regression tests, validated on macOS and NVIDIA NX Linux ARM64.

### Upgrade

Stop each running instance with the currently installed CLI before upgrading, then start it again with the new CLI. This release introduces a versioned instance control contract and does not migrate old runtime directories or support the previous unversioned contract. Replacing installed files does not update an already-running supervisor.

```sh
starmux ls
starmux down                 # Default instance
starmux down -i NAME         # Repeat for other running instances
npm install -g starmux@0.15.0
starmux up
```

Proceed with installation only after stopping succeeds. If the current CLI cannot contact its supervisor, resolve that runtime problem first; a port conflict is not proof of successful shutdown.
