# Local Mac via official OpenAI Tunnel: coding acceptance

Date: 2026-10-21. Source commit: `be6ed18` (before this report).

## Verified path

Codex Mac MCP Gateway plugin → existing official OpenAI Tunnel → local loopback port 8793 → current checkout compiled TypeScript Core → Desktop Commander.

The existing tunnel targeted port 8793; the saved onboarding profile targeted 18893. Starting the onboarding Core alone did not make the plugin available. The current checkout CLI was then started with `run --profile live`, selecting the existing port configuration while still running the Core from this checkout. No tunnel credentials or network configuration were changed.

Runtime identity:

- Core: `dist/src/dc-workspace-http.js` in this checkout.
- Version: 0.9.0; startup digest: `83ba2a27930bdb2d`.
- Access mode: ingress; workspace read-write; write scope home-only.
- Developer commands: trusted-project; native access enabled.
- Plugin health: Desktop Commander upstream healthy, 25 upstream tools discovered.

## Actual plugin operations

All project creation, source writes, code editing, reads and test execution below used the Mac MCP Gateway plugin, not local terminal substitutions.

1. Create an isolated directory under the checkout's ignored `tmp/` directory.
2. Write a TypeScript basket-total function and three Node tests.
3. Execute tests with a deliberately incorrect quantity calculation: one passes, two fail with the expected assertions.
4. Edit the calculation through `edit_block` to multiply price by quantity.
5. Read the source back through `read_file` to confirm the edit.
6. Execute tests again: **3 pass, 0 fail**.

The test used Node's local TypeScript support. This is a coding workflow test, not a replacement for Gateway's compiled-JavaScript package tests.

## Observations and limits

- Default zsh startup emitted a Homebrew initialization warning including a denied `/dev/null` operation. Tests still executed. Explicit `/bin/sh` and the absolute Node executable produced a clean passing run; shell initialization compatibility remains a separate issue.
- One `start_process` request returned a Tunnel network error. A subsequent read worked; repeating the side-effect-free tests succeeded. No exactly-once or sustained network reliability claim is made.
- This verifies the installed plugin over an existing Tunnel in ingress mode. It does **not** verify ChatGPT web OAuth discovery, consent, refresh or revocation through that Tunnel.
- No public HTTPS listener, IPv6 ingress, DNS or TLS certificate was configured or tested.
- No OAuth mode switch or user permission expansion was made.
- Temporary example files remain under ignored `tmp/tunnel-coding-20261021-1420/` for inspection. They are not shipped or committed.
