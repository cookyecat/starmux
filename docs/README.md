# Starmux Documentation

For a quick 3-step setup, start with the main **[README](../README.md#quick-start)**.

When you need deeper configuration, explore the five guides below by category:

| Category | Guide | What It Covers |
| :--- | :--- | :--- |
| **1. Installation & Networking** | **[`INSTALL.md`](INSTALL.md)** | Supported platforms (`macOS`, `Linux x64/ARM64`, `NVIDIA Jetson`, `Windows`), daily CLI operations, safe upgrades, source builds, and remote network scenarios (`--allow-lan` LAN/Tailscale direct, `SSH Forwarding`, `OpenAI / Cloudflare Tunnels`, `Caddy HTTPS`, & troubleshooting). |
| **2. Gateway Services & Middleware** | **[`GATEWAY.md`](GATEWAY.md)** | Connecting and managing multiple local `stdio` and remote HTTP/SSE MCP servers (`starmux server add/import`), outbound OAuth login, built-in transforms, read caching, and custom ESM middleware plugins. |
| **3. Security & Authentication** | **[`SECURITY.md`](SECURITY.md)** | Permission modes (`Read-Only` vs. `Coding`), network trust boundaries, Web Management Console (`starmux dashboard`), **Bearer API Keys** (`api-key`), and **OAuth 2.0 + PKCE** (`oauth` with self-hosted Keycloak). |
| **4. AI Client Setup Guides** | **[`CLIENTS.md`](CLIENTS.md)** | Step-by-step connection guides (including 1-step Prompt Auto-Setup) for **ChatGPT Web**, **Claude App / Code**, **Antigravity**, **Codex**, **Cursor**, **WorkBuddy**, **DSH-Harness**, **Kimi Code**, **Minimax Code**, **ZCode**, and **Doubao (豆包)**. |
| **5. Multi-Instance & Config** | **[`INSTANCES.md`](INSTANCES.md)** | Running multiple instances (`-i NAME`), editing and hot-reloading `config.jsonc`, mounting extra MCP servers (`upstreams`), managing secrets (`envRefs`), and diagnosing runtime states. |

---

## Common Use Cases

For task-first walkthroughs, start with [Use Cases](use-cases/README.md): ChatGPT to your computer, self-hosted Remote MCP, `stdio`-to-HTTP multi-MCP aggregation, zero-telemetry Remote Desktop Commander, and Codex / Cursor / WorkBuddy on Linux & NVIDIA Jetson.

---

### Additional Project Docs
- **[macOS Menu Bar App Build Guide](../app/README.md)** — Building the native SwiftUI menu bar app on Apple Silicon.
- **[Contributing](../CONTRIBUTING.md)** — Repository layout, build scripts, and test suite.
