# Starmux Documentation

For a quick 4-step setup, start with the main **[README](../README.md#quick-start)**.

When you need deeper configuration, explore the four guides below by category:

| Category | Guide | What It Covers |
| :--- | :--- | :--- |
| **1. Installation & Networking** | **[`INSTALL.md`](INSTALL.md)** | Supported platforms (`macOS`, `Linux x64/ARM64`, `NVIDIA Jetson`, `Windows`), daily CLI operations, safe upgrades, source builds, and advanced remote network forwarding (`Caddy HTTPS`, `Cloudflare / OpenAI Tunnels`, `SSH Forwarding`, `IPv6`, & network troubleshooting). |
| **2. Security & Authentication** | **[`SECURITY.md`](SECURITY.md)** | Permission modes (`Read-Only` vs. `Coding`), network trust boundaries, Web Access Console (`starmux dashboard`), **Bearer API Keys** (`api-key`), and **OAuth 2.0 + PKCE** (`oauth` with self-hosted Keycloak). |
| **3. AI Client Setup Guides** | **[`CLIENTS.md`](CLIENTS.md)** | Step-by-step connection guides (including 1-step Prompt Auto-Setup) for **ChatGPT Web**, **Claude App / Code**, **Antigravity**, **Codex**, **Cursor**, **WorkBuddy**, **DSH-Harness**, **Kimi Code**, **Minimax Code**, **ZCode**, and **Doubao (豆包)**. |
| **4. Multi-Instance & Config** | **[`INSTANCES.md`](INSTANCES.md)** | Running multiple instances (`-i NAME`), editing and hot-reloading `config.jsonc`, mounting extra local `stdio` MCP servers (`upstreams`), managing secrets (`envRefs`), and diagnosing runtime states. |

---

## Common Use Cases

For task-first walkthroughs, start with [Use Cases](use-cases/README.md): ChatGPT to your computer, self-hosted Remote MCP, and Remote Desktop Commander.

---

### Additional Project Docs
- **[macOS Menu Bar App Build Guide](../app/README.md)** — Building the native SwiftUI menu bar app on Apple Silicon.
- **[Contributing](../CONTRIBUTING.md)** — Repository layout, build scripts, and test suite.
