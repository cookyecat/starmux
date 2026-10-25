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

## Validation status

The Starmux 0.10.0 CLI is a preview. Its new command workflow is validated on the development macOS host. Earlier Core tests passed on Ubuntu 24.04 arm64 / Node 22.12, including real file writes and Shell. Windows native execution remains pending; earlier implementation or CI configuration does not establish that the new release has passed there.

The native macOS App is a development build. Public signing, notarization and independent clean-Mac installation are separate release steps.

`npm test` uses isolated home directories and ports. Portable tests cover process lifecycle, permissions, authentication, configuration and the new CLI. macOS also runs the historical lifecycle regression tests needed by migration.
