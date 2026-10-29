# Instances and configuration

Use one implicit default instance for everyday work. Add `-i NAME` when you want separate project contexts with separate ports, credentials, configuration and logs.

```sh
starmux up ~/work/repo-a -i work --code
starmux up ~/personal/blog -i blog --read
starmux ls
starmux status -i work
starmux logs -f -i blog
starmux down -i work
starmux rm blog
```

Names such as `work` and `blog` are arbitrary labels. Names and stable IDs both work with `-i` / `--instance`, before or after the command. Instances share the OS account; coding mode uses that account's permissions.

`up` and `status` put the instance name in the status heading and show its full stable UUID on the `Instance` line, including for the default instance. Read-only resolves relative file paths against `Project`; Coding preserves the upstream server's path behavior. Project is not an access boundary. `Mode` describes global Read-only or Coding access and shows the command to switch modes. A running instance's output uses its active configuration rather than unapplied configuration edits.

The connection guide and command list remain available below the compact status summary:

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

Normal instances use two global permission modes. Read-only blocks writes and arbitrary execution while allowing file reads permitted by the OS account and upstream server. Coding forwards native operations with the account's permissions. Saved directory grants and path filters do not affect these modes, and remain on disk for legacy configurations.

The MCP `health_check` reports the active mode as `mode: "read-only"` or `mode: "coding"`, alongside connection and diagnostic information. It no longer exposes the internal `workspaceMode`, `developerCommands`, `nativeAccess` or `permissionMode` fields. Read-only access can include paths outside Project, such as `/etc/hosts`, when the OS account and upstream server allow them.

## Edit configuration

```sh
starmux config path
starmux config show
starmux config edit
starmux config diff
starmux config apply
starmux config show --effective
```

Set `VISUAL` or `EDITOR` to your editor executable for `config edit`. JSONC supports comments and trailing commas. An edit is validated and saved with a revision check; `apply` restarts a running instance. Applying while stopped validates the next start. `up` also applies pending settings before returning success.

```text
~/.config/starmux/
  registry.json
  gateway.schema.json
  instances/<stable-id>/
    config.jsonc
    state/
    logs/
    snapshots/
```

Configuration holds project context, port, permission mode and optional upstream settings. Credentials and secrets live in private state. `config validate` and `config schema` provide diagnostics and the full schema. `starmux config schema` also works before creating an instance.

## Import, bind and export

```sh
starmux config import ./gateway.jsonc -i work
starmux config import ./project.jsonc -i blog --link
starmux config relink -i blog --file /new/path/project.jsonc
starmux config manage -i blog
starmux config export -i blog --output ./export.jsonc
```

Import makes a private copy. `--link` keeps the external file authoritative. `manage` converts a linked source into a managed copy. External source files must be regular, owner-owned files with trustworthy parent directories. Export includes settings and secret references, not secret values.

## Manage instances

```sh
starmux config copy experiment -i work
starmux config rename development -i work
starmux config default development
starmux rm experiment              # Alias for: starmux config archive -i experiment
starmux ls --archived
starmux config restore -i experiment
```

Copies receive a new identity and port, without credentials or private secrets. An authenticated copy needs its authentication configured before startup. Archive stops the instance and retains recoverable data. The first created instance is the CLI default; `config default` changes it explicitly.

With no instances, `starmux ls` points to `starmux up` to get started. If all instances are archived, use `starmux ls --archived` and restore one with `starmux config restore -i NAME`. Instance operations reject missing or extra arguments; use `-i NAME` to select the instance to archive or restore.

## Snapshots, secrets and automation

Concurrent edits return `CONFIG_CONFLICT`; reload before saving again. A failed apply attempts to restore the last successful worker configuration. Credential revocations are never rolled back. `config recover` repairs a missing source from the last successful snapshot without replacing an existing file.

```sh
starmux config secret set service_token -i development < /private/token-file
starmux config secret remove service_token -i development
starmux config save --file ./config.jsonc --revision REVISION
starmux config patch --patch '{"port":18894}' --revision REVISION
```

Use `--json` for scripts and obtain the revision from `config show`. Configured stdio upstreams retain explicit executable/tool allowlists and private environment references. Apply after changing upstream secrets.

The macOS App manages the same instances and configuration. Quitting it stops only App-owned instances; CLI background instances remain running.
