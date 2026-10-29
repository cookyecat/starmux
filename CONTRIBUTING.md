# Build and extend Starmux

Use Node.js 22.12 or newer and npm.

```sh
npm ci
npm run typecheck
npm run build
node bin/starmux.mjs --help
npm pack
```

`npm ci` installs the locked dependencies and builds the runtime. `npm run build` regenerates `dist/` from TypeScript and bundles Desktop Commander. The npm package contains compiled runtime files; installations from npm do not need TypeScript.

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
