# Install Starmux

Install on the computer whose files and tools your AI client will use. You need Node.js **22.12+** and npm. Desktop Commander is installed automatically as a pinned dependency.

```sh
npm install -g starmux
cd /path/to/project
starmux up
```

The first start creates a private configuration and starts a background process on `127.0.0.1:18893`. The terminal returns when the service is ready.

```sh
starmux verify
starmux status
starmux dashboard
```

For coding, run `starmux up --code`. It enables file edits and Shell/Git using your OS account permissions after one confirmation. For unattended setup, use `starmux up --code -y`. `--write` is an alias for `--code`.

## Daily operation

```sh
starmux up ~/my-project      # Choose a workspace explicitly
starmux init ~/my-project    # Save without starting
starmux logs -f
starmux doctor
starmux down
```

A later `starmux up` reuses the saved workspace. Use `starmux up .` to switch to your current directory. `up --foreground` runs until Ctrl+C; background runs continue after the terminal closes. Background operation does not configure login autostart.

If port 18893 is occupied, choose `starmux up --port 18894`. Use the actual endpoint shown by `status` when configuring your proxy or client.

With API-key or OAuth authentication enabled, give `verify` a valid Bearer credential using `STARMUX_TOKEN` or `--token-stdin`.

## Connect remotely

Continue with [remote setup](REMOTE_SETUP.md): HTTPS + API key, ChatGPT OAuth, or an existing protected ingress. A local verification pass confirms the local service; the last step of each remote route is a real tool call from your client.

## Existing installations

Use [migration](MIGRATION.md) to retain your existing workspaces and credentials. New installations store state in `~/.config/starmux` on all platforms.

## Install from a checkout

Until using a published release, or when developing locally:

```sh
npm ci
npm run build
npm install --global .
starmux --version
```

A published tarball already contains compiled JavaScript. It needs no TypeScript installation. If the command is not found, check your npm global bin directory and shell PATH; zsh may need `rehash` after a command rename.

See [contributing](../CONTRIBUTING.md) for builds and tests, [App development](../app/README.md) for the macOS App, and [platform support](PLATFORMS.md) for validation status.
