# Changelog

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
