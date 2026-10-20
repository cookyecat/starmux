# Contributing

Thank you for helping build an independent, self-hosted MCP Gateway.

- File reproducible issues with version, macOS release and *sanitized* steps. Never share credentials, local IPs, Tunnel IDs, original MCP messages containing personal files or private logs.
- Please open a discussion before large architectural changes. Keep local Core tests and authorization rules passing.
- Fixes must preserve upstream Desktop Commander tool schemas and accurately separate local health from remote caller identity.
- Feature ideas for programmable hooks, broader multi-upstream routing or multi-Mac operation are welcome, but should be labeled **proposals** until independently implemented and tested.

See [security](SECURITY.md) and [current preview status](docs/RELEASE_STATUS.md).

## TypeScript development

Use Node 22 or newer on Apple Silicon macOS. Run `npm ci`, `npm run typecheck`, and `npm test`. Tests execute compiled JavaScript and use temporary configuration directories and isolated ports. `npm run build` emits Core, CLI and tests to `dist/`; do not edit generated files. `npm pack` rebuilds and includes only the explicit runtime allowlist. No business logic belongs in the compatibility `.mjs` adapters.

Keep `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` and `noEmitOnError` enabled. Treat JSON, CLI options, socket messages and environment input as unknown until checked. Use MCP SDK types for protocol objects; retain upstream metadata and extensions. Internal middleware changes must test refusal before execution and observer failure after execution, including tools/list versus tools/call consistency.

The App builder installs locked build dependencies in a temporary staging directory, compiles there, then installs production dependencies in the bundle. Swift sources and the bundle launcher/helper paths are independent of this TypeScript build. Public signing, external cloud authentication and independent clean-Mac acceptance remain separate release gates.
