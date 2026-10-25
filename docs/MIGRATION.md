# Migrate from Mac MCP Gateway

Starmux 0.10.0 replaces the old public command name. It uses `~/.config/starmux`; migration retains the original data in `~/.config/mac-mcp-gateway`.

```sh
starmux migrate                 # Preview discovered sources
starmux migrate registry       # Migrate existing named instances
# For an installation that only has a legacy profile:
starmux migrate setup
# Or: starmux migrate live
```

Migration asks before stopping the selected old processes. Add `-y` for unattended operation. Migrate the registry when present, so previously imported profiles are not duplicated. The destination must be empty. After migration:

```sh
starmux ls
starmux up
starmux status
```

The registry migration retains stable IDs, the default selection, saved permissions, keys, OAuth settings and revocations, management tokens, policies, secrets and successful configuration snapshots. Managed paths are rewritten; externally linked configuration remains in place. Runtime locks and PID records are recreated by a new start. If interrupted before commit, rerun the same migration to rebuild the recognized staging directory from the originals.

Existing Home-only configurations retain that boundary. To choose full OS-account coding permissions explicitly, run `starmux up --code` and confirm.

| Previous workflow | Starmux |
| --- | --- |
| `setup` / `instance create` | `init`, or simply `up` |
| `run` | `up` (background), `up --foreground` |
| `stop` | `down` / `stop` |
| `instance list` | `ls` |
| `access create` + `access mode api-key` | `auth key "Name"` |
| `access status` / `access list` | `auth` |
| `access revoke` / `access revoke-oauth` | `auth revoke ID` |
| `access owner-token` | `dashboard --token` |
| `instance import/copy/rename/archive/restore/default` | corresponding `config` subcommand |

Update scripts to `starmux` and `-i NAME`. Public environment settings use `STARMUX_*`; ordinary commands ignore old `MAC_MCP_*` overlays. Use `STARMUX_TOKEN` for local authenticated verification. Old `mgw_` credentials remain valid until expiry or revocation.
