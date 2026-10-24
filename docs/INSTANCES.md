# Instances and configuration

An instance is a named Gateway with its own configuration, port, credentials, workspace grants, deny rules and logs. Several instances can run on one computer. They still share the OS account, Home, system permissions and any user-level settings of external tools. They are not separate desktops or OS sandboxes.

## Start with an instance

```bash
mac-mcp-gateway instance create dev --project /absolute/path/to/project
mac-mcp-gateway run --instance dev
```

Omit `--project` in an interactive terminal to choose a directory and capability in the wizard. The default capability is restricted read-only. Ports are suggested starting at 18893, skipping saved and occupied ports. The actual bind is checked again at startup; a collision never terminates an unrelated listener or silently changes your endpoint.

Trusted development on macOS requires an explicit choice:

```bash
mac-mcp-gateway instance create coding --project /absolute/project \
  --access-role trusted --approve-trusted-developer
```

On Linux/Windows, also pass `--approve-unrestricted`. New trusted macOS configurations use the existing Home-write sandbox; additional upstreams and Gateway Git remain incompatible with that sandbox. Importing a Home-only configuration on an unsupported platform fails rather than weakening its permissions.

The macOS App opens an instance manager with a list and four detail tabs: Overview, Configuration, Connections & access, and Logs & diagnostics. The menu bar provides quick start/stop actions. Creating and repairing configuration works while the Core is stopped. **Quitting the App stops only instances launched by that App session.** Inspecting or restarting a CLI-owned instance does not transfer ownership; its original terminal continues to own it.

## Locate and edit configuration

The location is the same on all supported platforms (`~` is your user profile on Windows):

```text
~/.config/mac-mcp-gateway/
  registry.json
  gateway.schema.json
  instances/<stable-instance-id>/
    config.jsonc
    state/
    logs/core.log
    snapshots/
```

Use `config path --instance dev` to find the authoritative source. Add `--json` to see the associated state, log and snapshot locations. Instance names can change without moving their directories or replacing credentials. Scripts can use a stable ID wherever `--instance` accepts a name.

A minimal file is:

```jsonc
{
  "schemaVersion": 1,
  "projectRoot": "/absolute/path/to/project",
  "port": 18893,
  // Optional: restricted and read-only are the defaults.
  "accessRole": "restricted",
  "mode": "read-only",
  "connection": "local"
}
```

JSONC supports comments and trailing commas; ordinary JSON is also accepted. Generated files refer to a local JSON Schema generated from the same validation model. `config schema --instance dev` prints it. Unknown fields, invalid capability combinations and inaccessible work directories produce actionable errors. The source file never serves as a script.

```bash
mac-mcp-gateway config show --instance dev
mac-mcp-gateway config edit --instance dev
mac-mcp-gateway config validate --instance dev
mac-mcp-gateway config diff --instance dev
mac-mcp-gateway config apply --instance dev
mac-mcp-gateway config show --effective --instance dev
```

`config edit` opens a temporary working copy with the executable specified by `VISUAL` or `EDITOR` (set it to an executable, not a command with arguments). It validates the result and checks the original revision before replacing the source. App form edits preserve comments and untouched settings. Concurrent App/CLI saves fail with `CONFIG_CONFLICT`; reload and review the newer version before saving.

**Save and apply are different operations.** Saving a file or editing a linked source does not restart anything. Apply shows up as a restart of the selected instance and disconnects its current MCP sessions. The supervisor validates the proposed configuration first. If a new worker fails, it attempts to restore the last successful startup configuration once. Credentials and revocations are never rolled back. Applying to a stopped instance validates the configuration for its next start without starting it.

`config show` returns source text and revision even if its contents fail validation, allowing the App source editor to repair it. If a source is missing, `config recover` can create a managed configuration from the last successful snapshot, without overwriting an existing managed file. Status, logs and stop do not require a valid source file.

## Import or bind a file

```bash
mac-mcp-gateway instance import ./gateway.jsonc --name work
mac-mcp-gateway instance import ./project-gateway.jsonc --name project --link
```

Import creates a private managed copy. Later changes to the original have no effect. Binding retains the external file as the single source; it is shown prominently in the App. External files must be owner-owned regular files without writable shared ancestors or link indirection. Secret-free project configuration may be readable by others; private instance state remains owner-only.

Two instances cannot bind the same path, including an archived instance's reserved source. Moving or deleting a bound file produces a missing-source state; it does not lose control of the running Core.

```bash
mac-mcp-gateway config relink --instance project --file /new/path/gateway.jsonc
mac-mcp-gateway config manage --instance project
mac-mcp-gateway config export --instance project --output ./exported.jsonc
```

`manage` makes a managed copy and leaves the external file untouched. Export contains startup settings and secret references, not credentials or private state. Existing export destinations are not overwritten.

## Select and operate instances

```bash
mac-mcp-gateway status
mac-mcp-gateway instance list --json
mac-mcp-gateway status --all --json
mac-mcp-gateway instance default dev
mac-mcp-gateway status --instance dev --json
mac-mcp-gateway doctor --instance dev
mac-mcp-gateway verify --instance dev
mac-mcp-gateway logs --instance dev --lines 60
mac-mcp-gateway stop --instance dev
```

Human-readable `status` lists all active entries. Single-target commands use `--instance`, the explicit default, or the sole unarchived instance. Ambiguous selection fails rather than guessing. App selection never changes the CLI default. The first created instance is the initial default; creating another does not change it. Archiving the default clears the default, and restoring it does not silently restore that choice.

`status` identifies the actual running port, configuration revision, Core path/build and launch owner. Editing a port does not change the running endpoint until apply succeeds. `doctor` checks saved configuration and required access state; `verify` checks the running instance's identity and performs real MCP discovery and a directory read. For API-key mode, set `MAC_MCP_API_KEY` to a credential belonging to that instance for verification. Neither a health response nor a recent tool call proves that a particular remote client is connected.

```bash
mac-mcp-gateway instance rename dev development
mac-mcp-gateway instance copy development experiment
mac-mcp-gateway instance archive experiment
mac-mcp-gateway instance restore experiment
```

Copy allocates a new identity and port, makes a managed configuration, and excludes credentials, OAuth sessions, secret values and management tokens. A copy of an authenticated instance cannot start until its required authentication is configured; it never silently switches to ingress mode. Archive stops the target and retains recoverable data. It never deletes an external source.

## Credentials, grants and secrets

All owner operations accept the same target:

```bash
mac-mcp-gateway access create "Work client" --instance dev
mac-mcp-gateway access mode api-key --instance dev
mac-mcp-gateway access status --instance dev
mac-mcp-gateway access revoke CREDENTIAL_ID --instance dev
mac-mcp-gateway access owner-token --instance dev
mac-mcp-gateway permissions status --instance dev
mac-mcp-gateway permissions token --instance dev
```

The App offers credential creation, revocation and authentication selection. The running instance's `/access`, `/permissions` and `/filters` pages operate on its state. OAuth provider configuration uses the existing `access oauth configure` workflow with `--instance`. Credentials control admission to the instance's approved capabilities; they do not create independent workspaces per credential.

Revocation and owner policy updates affect subsequent requests immediately and do not wait for configuration apply. CLI and Dashboard writers share cross-process locks. Do not remove a lock while any writer may still be running; a stale lock fails closed.

Additional stdio upstreams use absolute command paths and explicit tool allowlists. Map environment variables to private secret names using `envRefs`, for example `"envRefs": {"SERVICE_TOKEN": "service_token"}`. Provision the value through stdin:

```bash
mac-mcp-gateway config secret set service_token --instance dev < /private/path/token-file
mac-mcp-gateway config secret remove service_token --instance dev
```

Values are not echoed and are stored in the private instance state directory. Apply is required to pass changed secrets to a new upstream process. Copies and exports exclude these values. As with existing trusted native tools, the owner's OS account can access its own private files.

## Migrate existing setup/live installations

```bash
mac-mcp-gateway instance migrate
mac-mcp-gateway instance migrate setup --name daily --confirm
```

The first command is a read-only preview listing discovered sources, ports, capability and authentication. Select `setup` or `live` explicitly if both exist. Confirmation stops the related legacy processes, disables their old automatic starts, copies startup settings and private state, and records the migration. Original files are retained. The new instance is not started automatically.

Only one instance may receive the old shared credential state. Import another configuration or copy an instance to create additional instances without duplicating credentials. Migration refuses unrecognized settings or an untrusted listener rather than dropping settings or terminating an unknown process. Failed migrations preserve originals and provide recovery instructions; a previously registered legacy service is restored where possible.

Unmigrated installations retain their previous behavior. Existing noninteractive `setup` scripts still create the historical setup format until the installation uses the instance registry. After migration, `--profile setup/live` maps to the migrated instance. New everyday commands use the instance model without implicit setup/live or shell-environment overlays.
