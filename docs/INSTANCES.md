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
| `upstreams` | `Array<Upstream>` *(0..12)* | `[]` | Additional local `stdio` MCP servers mounted behind the router. |

### Advanced compatibility options

Ordinary Read-only and Coding configurations omit `gitMode` and `worktreeMode`. You do not need to set either option to use Git through the Coding-mode terminal or to access directories permitted by your OS account and upstream tools. Basic mode/network changes do not add these fields back.

Existing JSONC configurations remain valid, including explicit `off` values and comments. For an explicitly configured option that does not apply to the selected global mode, `config show`, `validate`, `diff`, `save`/`patch`, and `apply` return a nonblocking notice; the local console also shows it when viewing, validating or saving a draft. Routine startup adds no notice or confirmation. JSON responses expose these notices in `warnings` without changing the configured values. `config show --effective` evaluates the confirmed running configuration independently from pending edits.

| Field | Type & Values | Default | Description |
| :--- | :--- | :--- | :--- |
| `gitMode` | `"off"` \| `"review"` \| `"write"` \| `"push"` | `"off"` | Compatibility option for workspace-scoped profiles: enables extra `gateway_git_*` tools for the user's project. Ignored in the normal global Read-only/Coding modes. Coding mode can still run Git through the built-in terminal. |
| `worktreeMode` | `"off"` \| `"linked"` | `"off"` | Compatibility option for workspace-scoped profiles: follows linked Git worktrees of the user's project. Ignored in the normal global Read-only/Coding modes. |

---

## 3. Mounting Extra `stdio` MCP Upstreams & Secrets

Beyond the built-in Desktop Commander tools (which keep their native tool names on the `desktop` route), Starmux can mount up to **12 additional local `stdio` MCP servers** per instance.

- **Namespaced Tool Names:** Tools from extra upstreams are exposed as `<id>__<toolName>` (for example, route `sqlite` with tool `read_query` becomes `sqlite__read_query`).
- **Explicit Tool Allowlist (`allowTools`):** Only tools listed in `allowTools` can be invoked by AI clients.
- **Fault Isolation:** The configured children are discovered concurrently. Each child shares one 7-second budget for initialization and tool discovery, followed by bounded process cleanup on failure. Discovery runs alongside the built-in engine, so slow optional children do not accumulate consecutive startup delays. Failed side-effecting tool calls are never retried automatically (`UPSTREAM_CALL_UNCERTAIN`).

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

- **Automatic Core Log Retention:** `core.log` rotates while running at 8 MiB and retains up to three backups (`core.log.1` through `.3`). Existing oversized logs from older releases retain their newest 8 MiB when starting. `starmux logs` reads a bounded tail and `logs -f` follows file rotation. Normal shutdown flushes the worker's stdout and stderr before reporting completion.
- **Store Recovery After a Crash:** New private store locks record their owning process before becoming visible. A later operation automatically recovers a lock only after confirming that its owner process no longer exists; an old timestamp alone is insufficient. Empty locks left by older releases, unknown records, and live owners remain protected because their abandonment cannot be established safely. Stop older releases before upgrading, as described in the upgrade guide.

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

### Mode switches and interrupted upstream calls

Switching between Read-only and Coding preserves saved additional MCP service definitions and compatibility settings. Read-only still filters and rejects tools outside its read-only allowlist; switching back to Coding restores their availability without re-entering configuration.

When an additional upstream is stopping or closed, a call that has not been dispatched returns an MCP tool error beginning with `UPSTREAM_CLOSED`. Wait for the instance to restart, reconnect, and refresh the tool catalog before retrying. An interrupted call that may already have executed returns `UPSTREAM_CALL_UNCERTAIN`; check its effects before retrying, especially for writes. Starmux does not automatically replay uncertain calls. If the instance's HTTP connection has already closed, the client instead observes a transport disconnection.

In the Web console, use the copy-configuration button beside the intended local, LAN, or public address. The native macOS App displays ignored-setting notices for the saved configuration after loading or saving it.

### Inspecting tool calls in the Web console

Open `starmux dashboard`, select an instance, and open **Logs → Tool calls**. Each entry shows the tool, upstream service, start time, duration, and whether it is running, returned, blocked, failed, or has an uncertain outcome. Search by tool/service/error code, filter by status, or pause live updates. A returned response is not a guarantee that a higher-level AI task succeeded.

Summary recording is on by default and does not retain tool arguments or response bodies. **Enable detailed recording** before reproducing an issue to capture previews for new calls; expand an entry to inspect its arguments and tool response. Turning it off stops further detail capture without deleting existing previews. **Clear records** removes the current history. Health probes are excluded. This view records actual MCP tool calls, not the client's full conversation or reasoning.

Records stay in the instance process's memory: at most 200 calls, retained for 30 minutes. Restarting the instance clears history and resets detailed recording to off. Previews are limited to 8,192 characters per side, with truncation markers; binary image/audio data is omitted. Common credential fields are masked, but arbitrary command/output text may still contain sensitive content. Detailed records are available only through the authenticated local management interface and are not written into process logs.

**System logs** retains the Core/supervisor output view for startup, shutdown and process diagnostics. Existing `starmux logs --follow` behavior is unchanged.
