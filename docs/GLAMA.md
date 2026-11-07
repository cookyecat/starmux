# Glama listing and release checklist

Starmux's [Glama listing](https://glama.ai/mcp/servers/cookyecat/starmux)
is a discovery entry for a self-hosted MCP server. Profile completion is not a
code-quality percentage. A Glama release is a separate containerized artifact,
not an npm publication or a GitHub release.

## Repository metadata

The root [`glama.json`](../glama.json) declares the GitHub maintainer using
[Glama's schema](https://glama.ai/mcp/schemas/server.json). After merging it,
check that the listing has synchronized the current commit and recognizes the
file. If the metadata remains stale, use Glama's ownership/sync flow as described
in its [metadata guide](https://glama.ai/blog/2025-07-08-what-is-glamajson).
Do not add unverified metadata keys to satisfy unrelated checklist items.

## Before creating a Glama release

Follow [Glama's release workflow](https://glama.ai/blog/2026-03-15-how-to-make-a-release):
configure the Dockerfile build spec, pass a deployment test, and then create and
publish a versioned release. These are Glama dashboard actions; committing this
file alone does not create a release or improve a measured tool-quality score.

### Glama's stdio-based build runner

The inferred command `mcp-proxy -- node bin/starmux.mjs` is incorrect:
the CLI prints help and exits, and the proxy expects a stdio MCP server.
Adding `up --foreground` alone does not change the HTTP transport to stdio.

[`scripts/glama-stdio.mjs`](../scripts/glama-stdio.mjs) is an adapter specifically
for Glama's isolated container. It creates a fresh temporary home and empty
workspace, starts Starmux in read-only mode, and reuses Glama's globally installed
`mcp-proxy` library to bridge its loopback HTTP endpoint to stdio. The outer
Glama proxy continues providing its expected HTTP and health endpoints. No new
Starmux production dependency or startup package download is required.

After the adapter is merged and Glama has synced that commit, use:

```json
["mcp-proxy", "--", "node", "scripts/glama-stdio.mjs"]
```

Keep Node.js 24 and the existing successful build steps for the first retest.
Python is not needed by this adapter. Clear an old pinned commit or replace it
with the exact commit containing the adapter; otherwise Glama will not find the
new file. Select **Build** first, inspect initialization and tool discovery, and
publish a release only after that test succeeds.

The adapter requires Glama's `GLAMA_VERSION` environment marker and global
`mcp-proxy` installation. It keeps stdout exclusively for MCP protocol messages,
sends CLI diagnostics to stderr, and requests instance shutdown on stdin EOF,
SIGINT, SIGTERM, or startup failure. It does not expose the Starmux admin UI,
change loopback binding, or enable coding mode.

Validation so far: the `mcp-proxy@6.9.0` HTTP-to-stdio-to-HTTP path passed
initialization, `tools/list`, annotation preservation, `tools/call`, and `ping`
against a minimal SDK Streamable HTTP fixture. Adapter syntax and its
outside-Glama refusal were checked. Wrapper tests with a stub CLI and a real HTTP
MCP fixture verified clean protocol stdout, read-only startup arguments, and
shutdown/temporary-home cleanup on both stdin EOF and SIGTERM. This is **not**
a successful full Starmux container build: real Starmux startup/shutdown and the
Glama-hosted build still need validation before publication.

Check these Starmux-specific requirements before publishing:

- Use Node.js 22.12 or newer. `npm ci` installs locked dependencies and builds
  the runtime; `npm run build` can rebuild it explicitly.
- Starmux exposes **Streamable HTTP**, not stdio. Do not configure
  `starmux up` as a stdio MCP entry point.
- The regular `up` command backgrounds its supervisor. For a container process,
  use `node bin/starmux.mjs up --foreground` from a source checkout.
- Starmux defaults to loopback and validates peers and Host headers. Confirm
  how Glama's test connects before choosing a launch configuration. Merely
  adding `EXPOSE` or a Docker port mapping does not make loopback reachable.
  Do not relax these security boundaries just to satisfy a registry check.
- Use a disposable, non-root environment without personal files, credentials,
  host mounts, Docker sockets, or production upstreams. Keep default read-only
  mode. A hosted container operates on its own filesystem, **not** the user's
  computer; describe that distinction honestly in any deployment instructions.
- Confirm MCP initialization and `tools/list` in the deployment logs before
  publishing. `starmux verify` checks the local path only and does not prove the
  registry's connection works.

If the deployment test fails, capture the selected transport, build steps,
command arguments and error log. Resolve that concrete failure rather than
adding an untested transport adapter or assuming a Dockerfile is sufficient.

## Other discovery signals

- **Tool Definition Quality / Server Coherence:** inspect the actual per-tool
  reports after successful introspection; lack of a report is not a failing
  score. Preserve upstream tool schemas when changing routing.
- **Related servers:** configure genuinely relevant related projects in the
  dashboard if the field is available. Do not invent a `relatedServers` field
  in `glama.json`; it is not defined by the currently published schema.
- **Recent usage:** demonstrate useful real operation in the intended client.
  Local usage is not evidence that Glama recorded usage. Do not manufacture
  traffic to improve a score.
- **Maintenance:** absence of old community issues is neutral, not a reason to
  create artificial issues. GitHub releases and security tooling are separate
  from a Glama release and should represent real maintenance practices.
- **Boost:** optional paid promotion, not a prerequisite for a correct listing.

Keep [the security model](SECURITY.md) and [installation guide](INSTALL.md) as
the authority for authentication, networking and runtime behavior.
