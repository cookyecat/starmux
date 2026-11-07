# Multiple Instances & JSONC Configuration

For everyday work, Starmux manages a single implicit `default` instance—you never have to pass extra flags.

When you want separate project contexts, ports, credentials, or permission modes running side by side on the same computer, pass `-i <name>` (or `--instance <name>`).

---

## Table of Contents

1. [Running Multiple Instances (`-i`)](#1-running-multiple-instances--i)
2. [Editing `config.jsonc` & Schema Reference](#2-editing-configjsonc--schema-reference)
3. [Mounting Extra `stdio` MCP Upstreams & Secrets](#3-mounting-extra-stdio-mcp-upstreams--secrets)
4. [Cloning, Archiving, Importing & Scripting](#4-cloning-archiving-importing--scripting)
5. [Runtime State Machine & Durable Control Records](#5-runtime-state-machine--durable-control-records)

---

## 1. Running Multiple Instances (`-i`)

```sh
# Start a coding instance for work and a read-only instance for a personal repo
starmux up ~/work/repo-a -i work --code
starmux up ~/personal/blog -i blog --read

# Inspect and manage instances
starmux ls                  # List all active instances (mark '*' indicates default instance)
starmux status -i work      # View detailed status and connection snippets for 'work'
starmux logs -f -i blog     # Stream live logs for 'blog'
starmux down -i work        # Stop 'work'
starmux rm blog             # Stop and archive 'blog'
```

- **Selector Flexibility:** Both human-readable names (e.g., `work`) and stable UUIDs work with `-i` / `--instance`, placed before or after the subcommand.
- **Port Allocation:** The first instance defaults to port `18893`; additional instances automatically pick the next available port in `18893–19892` (or you can specify `--port <N>`).
- **OS Account Boundary:** Instances have separate ports, authentication settings, configurations, and logs, but run under the same OS user account (they are not OS-level filesystem sandboxes).
- **macOS App Integration:** The native macOS menu bar app and the CLI manage the same instances. Quitting the App stops only App-launched instances; CLI background instances continue running.

---

## 2. Editing `config.jsonc` & Schema Reference

Every instance stores its startup configuration in `~/.config/starmux/instances/<uuid>/config.jsonc` (JSON with Comments and trailing commas allowed).

### Everyday Configuration Commands

```sh
starmux config path              # Print the absolute path to config.jsonc
starmux config show              # View saved configuration and revision hash
starmux config show --effective  # View confirmed active configuration of a running instance
starmux config edit              # Open config.jsonc in $VISUAL or $EDITOR (validates on save)
starmux config validate          # Validate config.jsonc syntax and schema
starmux config diff              # Compare saved edits against the running instance
starmux config apply             # Hot-reload: restart the running instance with saved settings
starmux config schema            # Print the full JSON Schema (works even before creating an instance)
```

### Complete `config.jsonc` Field Reference

| Field | Type & Values | Default | Description |
| :--- | :--- | :--- | :--- |
| `schemaVersion` | `1` | `1` | Required configuration schema version. |
| `projectRoot` | `string` *(absolute path)* | Current directory | Base project directory for the instance. |
| `port` | `integer` (`1024..65535`) | `18893` | HTTP TCP port; the bind address depends on `allowLan`. |
| `allowLan` | `boolean` | `false` | Listen on all IPv4 interfaces for direct MCP access. `up --allow-lan` enables it; `up --local` disables it. Owner management remains local. |
| `mode` | `"read-only"` \| `"read-write"` | `"read-only"` | Workspace read/write mode (`--code` sets `"read-write"`). |
| `accessRole` | `"restricted"` \| `"trusted"` | `"restricted"` | Tool execution role (`--code` sets `"trusted"`). |
| `writeScope` | `"unrestricted"` \| `"home-only"` | `"unrestricted"` | On macOS, `"home-only"` restricts native writes to `$HOME` (requires `accessRole: "trusted"`, `gitMode: "off"`, and empty `upstreams`). |
| `connection` | `"local"` \| `"https"` \| `"tunnel"` | `"local"` | Connection profile metadata. |
| `gitMode` | `"off"` \| `"review"` \| `"write"` \| `"push"` | `"off"` | Optional gateway-managed Git workflow tools (`gateway_git_*`). |
| `worktreeMode` | `"off"` \| `"linked"` | `"off"` | Whether workspace-scoped policies follow linked Git worktrees. |
| `upstreams` | `Array<Upstream>` *(0..12)* | `[]` | Additional local `stdio` MCP servers mounted behind the router. |

---

## 3. Mounting Extra `stdio` MCP Upstreams & Secrets

Beyond the built-in Desktop Commander tools (which keep their native tool names on the `desktop` route), Starmux can mount up to **12 additional local `stdio` MCP servers** per instance.

- **Namespaced Tool Names:** Tools from extra upstreams are exposed as `<id>__<toolName>` (for example, route `sqlite` with tool `read_query` becomes `sqlite__read_query`).
- **Explicit Tool Allowlist (`allowTools`):** Only tools listed in `allowTools` can be invoked by AI clients.
- **Fault Isolation:** Discovery has a 7-second timeout per child; an unavailable extra upstream does not prevent the primary Desktop Commander route from starting. Failed side-effecting tool calls are never retried automatically (`UPSTREAM_CALL_UNCERTAIN`).

### Example `config.jsonc` with an Extra `stdio` Upstream

```jsonc
// Gateway startup settings. Save, then run 'starmux config apply' to restart.
{
  "schemaVersion": 1,
  "projectRoot": "/Users/alice/work/repo-a",
  "port": 18893,
  // Read-only mode: mode="read-only", accessRole="restricted"
  // Coding mode:    mode="read-write", accessRole="trusted"
  "mode": "read-write",
  "accessRole": "trusted",
  "writeScope": "unrestricted",
  "connection": "local",
  "gitMode": "off",
  "worktreeMode": "off",
  "upstreams": [
    {
      "id": "sqlite",
      "transport": "stdio",
      "command": "/opt/homebrew/bin/npx",
      "args": ["-y", "@modelcontextprotocol/server-sqlite", "/Users/alice/data/app.db"],
      "allowTools": ["read_query", "list_tables", "describe_table"],
      "envRefs": {
        "DB_API_TOKEN": "my_service_token"
      }
    }
  ]
}
```

### Managing Upstream Secrets (`envRefs`)

Never store raw secret values inside `config.jsonc`. Instead, store the secret in the instance's private `state/secrets.json` and map environment variable names (`^[A-Z][A-Z0-9_]*$`) to secret names via `envRefs`:

```sh
# 1. Save a secret from stdin into private instance state
starmux config secret set my_service_token -i work < /private/token-file

# 2. Apply configuration so the child MCP server receives DB_API_TOKEN in its env
starmux config apply -i work

# 3. Remove a secret when no longer needed
starmux config secret remove my_service_token -i work
```

---

## 4. Cloning, Archiving, Importing & Scripting

### Copy, Rename, Default, Archive & Restore

```sh
starmux config copy experiment -i work      # Clone settings to a new instance & port (credentials/secrets are not copied)
starmux config rename dev -i work           # Rename an instance
starmux config default dev                  # Set the default instance used when '-i' is omitted
starmux rm experiment                       # Stop and archive an instance (alias: starmux config archive -i experiment)
starmux ls --archived                       # List archived instances
starmux config restore -i experiment        # Restore an archived instance
```

### Import, Link, Manage & Export

```sh
starmux config import ./gateway.jsonc -i work          # Import a private managed copy
starmux config import ./project.jsonc -i blog --link   # Bind directly to an external owner-owned JSONC file
starmux config relink -i blog --file /new/project.jsonc # Point a linked instance to a new external file
starmux config manage -i blog                          # Convert a linked external file into a managed copy
starmux config export -i blog --output ./export.jsonc  # Export settings (secret values are never exported)
```

### Optimistic Concurrency & Automation (`save`, `patch`, `recover`)

For automated scripts, obtain the current `revision` SHA-256 hash from `starmux config show --json` and pass `--revision` to prevent concurrent edit conflicts (`CONFIG_CONFLICT`):

```sh
starmux config save --file ./config.jsonc --revision REVISION -i dev
starmux config patch --patch '{"port":18895}' --revision REVISION -i dev
starmux config recover -i dev   # Restore a missing config.jsonc from the last known-good snapshot
```

---

## 5. Runtime State Machine & Durable Control Records

- **Live State Inspection (`running` / `stopped` / `unknown`):**
  - `running`: The instance supervisor and worker are healthy and verified over the local control socket.
  - `stopped`: No supervisor or port lease is active; `status` displays saved settings for the next start.
  - `unknown`: Starmux cannot confirm live state (e.g., the control socket is unreachable, the control protocol version is unsupported, or a process remains on the port without a valid control record). In `unknown` state, `starmux up` refuses to start a duplicate supervisor, and `starmux doctor` fails closed.
- **Active vs. Saved Configuration:**
  - Only the live supervisor can confirm active permissions. When unapplied edits exist on disk, `starmux status` shows **Active mode** and **Saved mode (pending)** separately.
  - In `--json` output, `status` separates `active`, `saved`, `lastActive`, and `lastRun`.
- **Durable Control Directory (`~/.config/starmux/control`):**
  - Instance and port-lease identities are persisted in `~/.config/starmux/control` with `0700`/`0600` owner-only permissions, while Unix control sockets use short hashed paths in a private temporary directory (avoiding POSIX `sun_path` length limits on deep home directories).
  - If a running supervisor detects that its control record or socket was deleted or replaced externally, it immediately stops its owned worker and records `INSTANCE_CONTROL_FILES_LOST` in `lastRun`.

---

[Documentation Index](README.md) · [Installation & Networking](INSTALL.md) · [Security & Authentication](SECURITY.md) · [AI Client Guides](CLIENTS.md)
