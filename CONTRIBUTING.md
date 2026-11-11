# Build and extend Starmux

Use Node.js 22.12 or newer and npm.

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
node bin/starmux.mjs --help
npm pack
```

`npm ci --ignore-scripts` installs the locked dependencies without running upstream installation telemetry or browser downloads. Run `npm run build` explicitly to regenerate `dist/` from TypeScript and bundle Desktop Commander. The npm package contains compiled runtime files; installations from npm do not need TypeScript.

Local build artifacts can live in `.internal/` with `dist` pointing to a dedicated subdirectory, such as `.internal/build/dist`. The build preserves that link, recreates a missing target, and removes stale files only inside the target. Links to the project, source directories, or `.internal` itself are rejected. Ordinary `dist` directories are also supported, including in the isolated package acceptance workspace.

### Updating the bundled Desktop Commander

`npm run sync:upstream` installs the latest upstream version as an exact development dependency with installation scripts disabled, then rebuilds and runs `scripts/vendor-desktop-commander.mjs`. To select a specific release, use `npm install --save-dev --save-exact @wonderwhy-er/desktop-commander@VERSION --ignore-scripts`, then `npm run build`.

Review upstream dependency changes before publishing. Dependencies imported by retained vendored code must be direct production dependencies of Starmux; the original Desktop Commander package is only a development dependency and is not installed for users of the published package. Desktop Commander 0.3.2 requires `unbash@6.0.1` for command parsing. MQTT and enrollment dependencies belong to the removed remote-device code and are not needed by the retained runtime.

The vendoring script removes telemetry/cloud modules, substitutes offline implementations, preserves the upstream license, and rejects known forbidden strings. That scan does not automatically detect every possible new telemetry implementation. Inspect changed upstream modules and required patch matches on each upgrade. Run `npm test` and `npm run verify:package` before release; the latter tests an actual tarball with production dependencies only, including command execution and UTF-8 file writes. Its artifacts and receipt are stored under `.internal/`.

The telemetry regression also checks packaged UI assets and runs the embedded MCP server with network attempts recorded and rejected, including with an existing `telemetryEnabled: true` configuration. Local usage statistics and tool history remain available; capture calls are offline no-ops. Explicit URL-reading tools retain their requested downloads.

`npm test` compiles the sources and runs lifecycle and CLI regression tests. Tests use temporary homes, private control records and local sockets; they do not stop existing instances. Build once before testing so the real CLI tests can use the bundled engine.

## Source layout

- `src/cli/`: public command-line interface and instance commands.
- `src/`: instance lifecycle, MCP routing, authentication and permissions.
- `scripts/`: runtime compilation and dependency bundling.
- `app/src/`: native macOS interface using the same instance API as the CLI.
- `build/` and `app/scripts/`: macOS application builders.
- `docs/`: installation, configuration and client connection guides.

Keep `package-lock.json` when changing dependencies so other developers can reproduce the installation. Generated files belong in `dist/` and are not committed.

Preserve upstream tool schemas and resource metadata when extending routing. Authentication controls who can connect; instance permissions control which operations are allowed. See [permissions](docs/SECURITY.md), [instances](docs/INSTANCES.md) and the [macOS build guide](app/README.md).

Report reproducible bugs through GitHub issues. Use [private vulnerability reporting](SECURITY.md) for security issues.
