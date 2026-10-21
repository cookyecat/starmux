# CLI platform support

Gateway Core and the foreground CLI share one TypeScript implementation for macOS, Linux and Windows. The existing SwiftUI App, App build and launchd helpers remain macOS-only. The product and command name remain `mac-mcp-gateway` pending a separate branding decision.

This is a development preview. A Windows implementation and CI job are not evidence of a successful Windows run. Native verification status is recorded below.

## Everyday commands

Install Node.js 22.12+ and Git, then from the checkout:

```sh
npm ci
npm install --global .
mac-mcp-gateway setup
mac-mcp-gateway doctor
mac-mcp-gateway run
```

Use another terminal for `mac-mcp-gateway status`, `mac-mcp-gateway verify` and `mac-mcp-gateway stop`. Default startup identity is English. The foreground CLI needs no service manager or administrator/root privileges. Start it as your normal OS user. Windows uses PowerShell for Gateway-generated commands; native Desktop Commander tools retain their upstream parameters and behavior.

The saved configuration remains under `~/.config/mac-mcp-gateway/` on every platform (the Windows home is the user's profile directory). Old macOS configurations and CLI aliases remain supported. Secrets/configuration require POSIX owner-only permissions on macOS/Linux and a private Windows ACL on Windows; an unsafe existing file or directory is rejected rather than silently repaired.

## Permissions

| Mode | macOS | Linux / Windows |
| --- | --- | --- |
| Restricted workspace | Gateway path and tool policy | Same Gateway policy, host-specific paths |
| Trusted native tools | Explicit approval; new profiles use Home-only process sandbox | Requires additional explicit unrestricted approval; uses OS account privileges |
| Imported v3 Home-only profile | Supported when sandbox available | Rejected; no silent unrestricted fallback |

For the native coding workflow on Linux or Windows:

```sh
mac-mcp-gateway setup --access-role trusted --connection tunnel --approve-trusted-developer --approve-unrestricted
```

The permission difference is intentional and visible. Tool/path filters do not sandbox Shell, Python or indirect filesystem access. Neither setup nor the platform port provisions authentication, HTTPS or a remote tunnel.

## Platform-specific features

- `setup`, `doctor`, `run`, `status`, `verify`, `stop`: shared foreground workflow.
- `--profile live`, `privacy`, legacy launchd management, login items and SwiftUI App: macOS only. Unsupported actions return an explicit error.
- Linux/Windows background service installation and native desktop Apps are not part of this iteration.
- The operations dashboard omits macOS launchd inventory on other hosts. Shared permission and tool-deny management remain available.
- Native tool schemas/results are forwarded; Gateway-generated development commands select host-appropriate quoting and shell.
- Windows control uses named pipes with per-run authenticated request/response proofs and private owner metadata. Unix hosts retain private sockets. Windows stop uses parent/worker IPC and cleans the owned Desktop Commander process tree.

## Validation

- macOS arm64 / Node 26.12: existing four integration scripts and 15 Node tests passed.
- Ubuntu 24.04 arm64 / Node 22.12: clean dependency installation and all nine portable/invocation/upstream tests passed in a temporary Linux VM, including real Desktop Commander file writes and Shell.
- Windows: implementation and CI coverage added; native execution remains pending.

Windows disk-usage summaries report logical KiB; Unix `du` reports allocated KiB. Reparse points are excluded from the Windows recursive walk.

`npm test` runs the complete existing macOS regression suite on macOS. All platforms run portable CLI integration, access-control, invocation contract and uncertain-upstream tests. Access-control tests cover opt-in keys, revocation, protected owner management and unchanged MCP tool discovery. The portable integration uses a temporary home, an isolated port and a workspace with spaces/non-ASCII characters. It checks setup, doctor, runtime identity, duplicate-start refusal, restricted write denial, status, local verification, native file writes, Shell and authenticated stop/port release.

GitHub Actions: `.github/workflows/cli-platforms.yml` targets macOS, Ubuntu and Windows with Node 22. CI has not been dispatched from this local repository. Windows native validation is pending; do not label Windows as release-accepted until that job and an independent Windows installation pass.
