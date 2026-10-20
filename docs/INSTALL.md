# Install Mac MCP Gateway on your Mac

This is the source-based setup guide for the current **Apple Silicon development preview**. A signed, notarized community App ZIP is planned for GitHub Releases, but is **not available to independent users yet**.

**Want to connect ChatGPT after installing?** Go to [Connect ChatGPT](CONNECT_CHATGPT.md). Local installation does not establish a remote connection.

## Option 1: From source (CLI)

**Prerequisites:** Apple Silicon Mac, Git, Node.js 22.12 or later with npm, and access to the checked-out source repository. Gateway declares Node 22 as its minimum; the locked Desktop Commander dependency requires 22.12 or later for strict engine checks. You do not need to install Desktop Commander separately: the project's locked npm dependencies include it.

1. Clone or download the repository from its future verified community URL and enter the project directory. The public repository URL is not finalized, so this guide deliberately does not invent one.
2. In Terminal, run the following **inside the repository**:

```bash
npm ci
npm install --global .
mac-mcp-gateway setup
mac-mcp-gateway doctor
mac-mcp-gateway run
```

`npm ci` installs the locked build dependencies and runs `prepare` to compile TypeScript. If your npm configuration disables lifecycle scripts, run `npm run build` explicitly. After editing source, use `npm run build` before starting the CLI. A packed npm installation already includes compiled JavaScript and does not need TypeScript installed.

The `npm install --global .` step installs the `mac-mcp-gateway` command; `npm ci` alone does **not** make it globally available. If your npm global prefix requires administrator access, configure a user-writable npm prefix first instead of using `sudo` blindly.

3. Follow the basic wizard to choose an existing, authorized project directory and read/write mode. Its default is **restricted read-only**; choosing read-write here does not enable trusted native tools or arbitrary Shell. It also asks whether you intend to use Direct HTTPS or Secure MCP Tunnel. This only saves a **preference**. For the complete native coding workflow, use the explicit trusted-role setup below instead.
4. Keep `mac-mcp-gateway run` running in its terminal. By default the source setup listens on **127.0.0.1:18893**; follow the actual port shown in your output.
5. Open another terminal:

```bash
mac-mcp-gateway verify            # Local MCP discovery and a real read
mac-mcp-gateway status          # Local health, port and dashboard
```

Both commands are local tests. They do not show that a remote client has connected.

### Enable the native coding workflow

For file editing, arbitrary development commands and the upstream Desktop Commander tool catalog, explicitly select the trusted developer role:

```bash
mac-mcp-gateway setup --access-role trusted --connection tunnel --approve-trusted-developer
mac-mcp-gateway doctor
mac-mcp-gateway run
```

Use `--connection https` instead if that is your intended deployment. Neither value provisions a remote connection. An optional `--project /absolute/directory` sets the default directory; in trusted mode it is not a project-only access boundary. New trusted profiles allow sandboxed Desktop Commander writes within Home, make outside-Home access read-only, and retain macOS permissions, upstream controls and explicit owner deny rules.

The setup file is `~/.config/mac-mcp-gateway/onboarding-v1.json` (the historical filename also stores newer schema versions). If it already exists, setup refuses to overwrite it. Keep a private backup before intentionally replacing it; append `--replace` to the setup command only when you intend to replace that profile. An existing `live` profile is separate.

### Testing this TypeScript checkout with an existing installation

First verify the source without replacing the installed App or stopping its Core:

```bash
npm ci
npm test
npm install --global .
mac-mcp-gateway status
```

The test runner isolates configuration and runtime state. `npm test` compiles TypeScript and runs the emitted tests. A successful status query alone does not prove the running Core comes from this checkout: it can describe your existing installation.

For an interactive trial, configure the setup profile as described above. When you are ready to interrupt existing AI tool calls, stop the current Core using the App's Stop action. Then start from this checkout:

```bash
mac-mcp-gateway run
```

In another terminal in the same checkout:

```bash
mac-mcp-gateway status
mac-mcp-gateway verify
```

`status` displays the human-readable status panel by default. Add `--json` only for scripts or structured diagnostics; for example, `mac-mcp-gateway status --json`. `mac-mcp-gateway verify` prints a structured verification result; `PASS` confirms local MCP discovery and access, not a remote client connection.

`run` always starts the Core shipped with the CLI you invoked. Default configuration selection prefers the saved onboarding file; only when it is absent does it use a validated legacy installation configuration. Even legacy settings do not select a legacy executable. Invalid saved settings fail visibly rather than silently falling back.

Every foreground start displays **Config source**, **Core program**, **Build version** (package version plus an emitted-code fingerprint), and **Listening port**, in English. `run --json` provides the same identity as structured fields. `--profile setup` / `--profile live` remain advanced configuration diagnostics, not normal daily commands.

After installing, use `command -v mac-mcp-gateway` to check which command your shell finds; run `rehash` in zsh if its cached command location is stale. If another npm installation appears earlier in PATH, correct PATH before starting. The `.mjs` compatibility adapters load the compiled TypeScript in `dist/src`.

Owner control prevents competing starts on the configured endpoint. Stop an existing Core before changing its saved port; status and stop use the selected configuration. The setup port is normally 18893, while an existing remote connection may target 8793. Local verification does not move that remote connection to the test Core. To test from a cloud client, configure the intended remote path to target the test Core's actual endpoint.

Stop the trial with Ctrl+C before returning to your existing App/profile. This source trial does not replace the installed SwiftUI App; starting that existing App later can still run its bundled JavaScript version.

### Controlling the single Core

```bash
mac-mcp-gateway status
mac-mcp-gateway stop
mac-mcp-gateway run
```

Stop the first foreground terminal with **Ctrl+C**, or use `mac-mcp-gateway stop`, before starting the same Core again. The CLI and the menu bar App share one global Core and reject competing listeners; they are not separate backends. `status --json` is available for scripting.

## Option 2: Menu bar App (planned public ZIP)

The community release will offer a **prebuilt Apple Silicon App ZIP** on GitHub Releases, so users won't need Xcode, a local Node.js install, or a separate Desktop Commander install.

The planned user flow is simple: download the official Release ZIP, check its published SHA-256, unzip, move **Mac MCP Gateway.app** to Applications, launch it, approve an access scope and connection preference, then start the local Core. Once connected locally, the App shows health, route readiness and quick actions; it doesn't enroll remote clients automatically.

**Distribution gate:** Current owner builds use ad-hoc signatures. The public App ZIP, Gatekeeper/notarization behavior, independent clean-Mac installation and both remote routes are **not yet accepted**. Do not download random binaries claiming to be official.

### Build a TypeScript-backed SwiftUI App locally

Developers with Python 3, npm and Apple's Swift build tools can build an App from this checkout. Obtain the official `node-v26.10.0-darwin-arm64.tar.gz` archive from [Node.js v26.10.0](https://nodejs.org/dist/v26.10.0/), then run:

```bash
python3 build/build_arm64_app.py \
  --output /absolute/path/to/new-build-output \
  --node-archive /absolute/path/to/node-v26.10.0-darwin-arm64.tar.gz
```

The script verifies the pinned archive checksum, compiles TypeScript in staging and packages the existing SwiftUI App with compiled Core/CLI and production dependencies. It prints the resulting App path and creates an ad-hoc development build. It does not install the App over an existing copy. The installed App retains its own bundled CLI/Core until replaced; validating a rebuilt App is a separate deployment step; a source CLI trial is the simpler first check.

## Next: connect an AI client

Local success means the Gateway and its real Desktop Commander tools can run on this Mac. ChatGPT needs a **separately configured remote path**.

- **Direct HTTPS — preferred if your network is publicly reachable.** Register a domain, point DNS to your reachable IP, configure TLS and authenticated HTTPS ingress, then enter your `https://.../mcp` URL in ChatGPT.
- **Secure MCP Tunnel — for difficult inbound networks.** Create your own Tunnel in OpenAI Platform, configure `tunnel-client` against your local MCP URL, and select your Tunnel in ChatGPT.

Read the [step-by-step ChatGPT connection guide](CONNECT_CHATGPT.md) for DNS, TLS, authentication, Tunnel IDs and verification.

## Troubleshooting

- **`mac-mcp-gateway: command not found`** — check that `npm install --global .` succeeded and your npm global bin directory is in `PATH`.
- **Port in use** — inspect `mac-mcp-gateway status` first; never force-start a duplicate Core.
- **Trusted setup saved, but doctor reports `ROOT_TOO_BROAD`** — update and rebuild this checkout with `npm run build`, then rerun `mac-mcp-gateway doctor`. Earlier doctor code omitted the trusted Home-directory permission even though setup and Core accepted it. Your saved trusted profile does not need to be recreated.
- **`verify:setup` reports `fetch failed` / status says `not-running`** — setup saves configuration and doctor checks dependencies; neither starts the HTTP server. Run `mac-mcp-gateway run` in one terminal and keep it running, then run `mac-mcp-gateway verify` in another. An older live Core on 8793 does not satisfy a setup profile configured for 18893.
- **Denied file access** — check the wizard's project choice, read-only mode and actual macOS filesystem privacy permissions.
- **ChatGPT cannot connect** — a healthy local dashboard is not proof of remote HTTPS reachability or Tunnel authorization. Follow [Connect ChatGPT](CONNECT_CHATGPT.md).

[Main README](../README.md) · [Safety and permissions](SECURITY.md) · [Release checklist](RELEASE_STATUS.md)
