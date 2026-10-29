# macOS App

The SwiftUI menu bar App uses the same Starmux instances and settings as the CLI. Quitting it stops instances started by the App; instances started independently from the CLI remain running.

## Build the application

Requirements: an Apple Silicon Mac, Xcode command-line tools, Node.js 22.12+ and npm.

1. Run `npm ci` in the repository root.
2. Download the official Node.js **v26.10.0 darwin-arm64** archive from nodejs.org. The builder verifies its SHA-256.
3. Build into an empty output directory:

```sh
python3 build/build_arm64_app.py \
  --node-archive /path/to/node-v26.10.0-darwin-arm64.tar.xz \
  --output /private/tmp/starmux-app
```

The resulting `Starmux.app` includes Node.js, the CLI and its runtime dependencies. It uses an ad-hoc signature. Distributing a notarized App requires Developer ID signing and Apple notarization.

For changes to the interface only, build a smaller App that uses an existing local Starmux CLI:

```sh
python3 app/scripts/build_ui.py --output-dir /private/tmp/starmux-ui
```

The CLI can be installed at `/opt/homebrew/bin/starmux` or `/usr/local/bin/starmux`. Normal launch opens the menu bar item; reopening the App shows its window.
