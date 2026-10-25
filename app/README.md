# App source (Apple Silicon)

The Starmux menu bar App is written in Swift and controls the same local Core
as the CLI. Its main panel shows the selected workspace, service health, permissions,
connection topology and recent tool activity. Advanced instance management opens
from **Workspaces & settings**; launch does not open a management window. The individual Swift sources and build script are included here,
without historical internal research reports.

**Build a UI-only preview (not a self-contained public App)**:

```bash
python3 app/scripts/build_ui.py --output-dir /private/tmp/mac-mcp-ui-preview
```

**Build a self-contained, ad-hoc signed developer candidate**:

1. Obtain the **official pinned** Node.js v26.10.0 darwin-arm64 tar.xz archive
   from nodejs.org, verifying its SHA-256 (enforced by the build script).
2. Run `npm ci`, then
   `python3 build/build_arm64_app.py --node-archive /path/to/node-v26.10.0-darwin-arm64.tar.xz --output /private/tmp/mac-mcp-app-build`.
The builder creates a separate temporary TypeScript build directory, runs a locked development install and compilation, and copies `dist/src` plus the stable `.mjs` launchers into the App. It then installs only locked production dependencies. The bundled launcher continues to use the pinned internal Node executable; Swift sources and helper paths are unchanged.

3. Check codesign and test in a non-production macOS user profile.

Ad-hoc signing is for developers. **No Developer ID / Apple notarization is
provided**. Do not advertise this candidate as a notarized public binary;
the App ZIP for GitHub Releases needs separate signing and end-user validation.

For visual acceptance, launch the built executable with `--show-monitor` to open the same menu view in a window. Normal launch stays in the menu bar; reopening the App also shows the monitor.
