# Install Starmux

Install on the computer whose files and tools your AI client will use. You need Node.js **22.12+** and npm. Desktop Commander is installed automatically as a pinned dependency.

```sh
npm install -g starmux
cd /path/to/project
starmux up
```

The first start creates a private configuration and starts a background process on `127.0.0.1:18893`. The terminal returns when the service is ready.

Starmux stores configuration under `~/.config/starmux`. Existing Starmux instances remain usable after upgrades. Importing previous product installations is no longer supported; create a new configuration with `starmux init` or `starmux up`.

Read the **Connect an AI client (MCP settings)** section printed by `up` (also available with `status`):

```text
● Starmux is running  (instance: default)
  Instance        <instance UUID>
  Listen          http://127.0.0.1:18893/mcp  (this computer only)
  Project         /path/to/your/project
  Mode            Read-only (global · OS account)  (run 'starmux up --code' to enable edits & shell)
  Auth            None (no token required)

Connect an AI client (MCP settings)
  Transport       Streamable HTTP
  URL (Local)     http://127.0.0.1:18893/mcp  (AI client on this computer)
  URL (Remote)    https://<your-domain-or-tunnel>/mcp  (via protected HTTPS proxy or tunnel -> 127.0.0.1:18893)
  Authentication  None  (optional Bearer API key: starmux auth key "My AI Client")

Commands
  Verify          starmux verify
  Auth & keys     starmux auth
  Dashboard       starmux dashboard  (view & copy settings in browser)
  Logs            starmux logs -f
  Stop            starmux down
```

Add `-i NAME` for a named instance. Both `up` and `status` show the mode-switch command.

The heading shows the instance name, while `Instance` shows its stable ID across restarts. `Project` is context for relative paths in Read-only mode, not an access boundary. Running instances show the active configuration, even when saved edits are pending. Read-only permits reads across the computer as allowed by the OS account and upstream server, while blocking writes and arbitrary execution. Coding uses the OS account's permissions and the upstream server's tools. Normal instances do not apply Starmux directory grants or path exclusions in either mode.

Without a path, `up` reuses the selected instance's saved project context; only a new instance defaults to the current directory. `up PATH` changes that instance's project context. To create a separate instance, use a new name with `up PATH -i NAME`.

Read-only mode supports `read_file` and `read_multiple_files`. Batch reads accept at most 20 files and 4 MiB of combined file sizes per batch; per-file read limits still apply. Desktop Commander reports missing files with `ENOENT`, and batch reads retain successful contents alongside per-file errors. Exceeding a batch limit returns `BATCH_READ_COUNT_LIMIT` or `BATCH_READ_SIZE_LIMIT`, with guidance to split the request.

- **None (no token required):** a local client uses Streamable HTTP with authentication set to None. For a web or remote client, connect through a protected HTTPS proxy or tunnel that forwards to `127.0.0.1:18893`.
- **API key:** configure Bearer token authentication (`Authorization: Bearer <YOUR_API_KEY>`) with the key you saved when creating it. The output shows how many keys are active and the command to create one if needed.
- **OAuth:** use the configured **URL (Remote)** and complete browser sign-in with an allowed account.

`starmux dashboard` opens the local Web Access Console with its owner login so you can view and copy settings in your browser. `--json` retains structured status for scripts.

```sh
starmux verify
starmux status
starmux dashboard
```

For coding, run `starmux up --code`. It enables file edits and Shell/Git using your OS account permissions after one confirmation. For unattended setup, use `starmux up --code -y`. `--write` is an alias for `--code`. To return to Read-only mode, run `starmux up --read`.

## Daily operation

```sh
starmux up ~/my-project      # Choose a project context explicitly
starmux init ~/my-project    # Save without starting
starmux logs -f
starmux doctor
starmux down
```

A later `starmux up` reuses the saved project context. Use `starmux up .` to switch to your current directory. `up --foreground` runs until Ctrl+C; background runs continue after the terminal closes. Background operation does not configure login autostart.

If port 18893 is occupied, choose `starmux up --port 18894`. Use the actual endpoint shown by `status` when configuring your proxy or client.

With API-key or OAuth authentication enabled, give `verify` a valid Bearer credential using `STARMUX_TOKEN` or `--token-stdin`.

## Connect remotely

Continue with [remote setup](REMOTE_SETUP.md): HTTPS + API key, ChatGPT OAuth, or an existing protected tunnel. A local verification pass confirms the local service; the last step of each remote route is a real tool call from your client.

## Install from a checkout

Until using a published release, or when developing locally:

```sh
npm ci
npm run build
npm install --global .
starmux --version
```

A published tarball already contains compiled JavaScript. It needs no TypeScript installation. If the command is not found, check your npm global bin directory and shell PATH; zsh may need `rehash` after a command rename.

See [contributing](../CONTRIBUTING.md) for source builds, [App build guide](../app/README.md) for the macOS App, and [platform support](PLATFORMS.md) for host requirements.
