# Platform support

Starmux Core and CLI share a TypeScript implementation for macOS, Linux and Windows. The SwiftUI App is macOS-only. All hosts require Node.js 22.12+.

```sh
npm install -g starmux
starmux up
starmux doctor
starmux verify
starmux down
```

`up` starts a detached background process without installing a system service. Use `--foreground` when a terminal or an external service manager should own the process. Run Starmux as your normal OS account.

## Permissions and storage

- Read-only mode uses the existing workspace and tool policy, including denial of arbitrary Shell and file writes.
- `--code` / `--write` enables file edits and Shell/Git using OS-account permissions on all platforms after confirmation.
- Existing macOS Home-only configurations retain their sandbox. Importing them on a host without that sandbox fails; choose a new permission mode explicitly.
- State is stored under `~/.config/starmux`; on Windows, `~` is the user profile. Private files use owner-only POSIX permissions or Windows ACLs.
- Windows runtime control uses authenticated named pipes; Unix hosts use private sockets. Gateway-generated commands use host-appropriate quoting and shells.

## Supported hosts

Starmux runs on **macOS** (`Apple Silicon` and `Intel`), **Linux** (`x64`, `ARM64`, and edge devices such as **NVIDIA Jetson**), and **Windows**.

The native macOS menu bar App is provided as a development build in [`app/`](../app/README.md).
