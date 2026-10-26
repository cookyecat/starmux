# Instances and configuration

Use one implicit default instance for everyday work. Add `-i NAME` when you want separate projects with separate ports, credentials, policies and logs.

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

Configuration holds workspace, port, permissions and optional upstream settings. Credentials and secrets live in private state. `config validate` and `config schema` provide diagnostics and the full schema. `starmux config schema` also works before creating an instance.

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
