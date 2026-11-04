# Installation, Platforms & Network Engineering

While the [README Quick Start](../README.md#quick-start) covers the 3-minute default setup, this reference manual documents the complete installation lifecycle, OS-specific runtime behavior, CLI flags, production network forwarding (Caddy, Tunnels, SSH, IPv6), upgrades, and diagnostics.

---

## Table of Contents

1. [Host Requirements & Platform Matrix](#1-host-requirements--platform-matrix)
2. [Installation & Upgrade Lifecycle](#2-installation--upgrade-lifecycle)
3. [Service Startup, Status Anatomy & CLI Reference](#3-service-startup-status-anatomy--cli-reference)
4. [Remote Network Forwarding & Ingress Engineering](#4-remote-network-forwarding--ingress-engineering)
5. [Verification, Diagnostics & Troubleshooting](#5-verification-diagnostics--troubleshooting)

---

## 1. Host Requirements & Platform Matrix

Starmux runs on the target machine whose files, shell, and development tools your AI client will operate.

- **Runtime Requirement:** **Node.js `>=22.12.0`** and `npm`.
- **Bundled Engine:** [Desktop Commander](https://github.com/wonderwhy-er/DesktopCommanderMCP) (`@wonderwhy-er/desktop-commander`) and `@vscode/ripgrep` are bundled automatically as pinned dependencies—no separate installation or global binary setup is required.

### Supported Platforms

| Host OS | CPU Architectures | Core & CLI | Native Menu Bar App | OS-Specific Runtime & Security Mechanics |
| :--- | :--- | :--- | :--- | :--- |
| **macOS** | `Apple Silicon (arm64)`<br/>`Intel (x64)` | ✅ Tested | 🧪 Development Build<br/>([`app/README.md`](../app/README.md)) | • Uses private Unix domain sockets for instance control.<br/>• Subject to macOS TCC / Full Disk Access privacy permissions.<br/>• Supports optional `home-only` write sandbox in custom configs. |
| **Linux** | `x64` (`amd64`)<br/>`ARM64` (`aarch64`)<br/>**NVIDIA Jetson** | ✅ Tested | — | • Uses private Unix domain sockets and `0600`/`0700` POSIX permissions.<br/>• Ideal for headless servers, containers, and edge devices driven remotely from a macOS/Windows laptop or browser. |
| **Windows** | `x64`<br/>`ARM64` | ✅ Tested | — | • Uses authenticated Windows Named Pipes for local instance control.<br/>• Enforces owner-only Windows ACLs on private state files.<br/>• Automatically adapts shell selection and path quoting. |

### On-Disk Storage Layout

Starmux stores all configuration, runtime control leases, and instance state in `~/.config/starmux` (on Windows, `~` resolves to `%USERPROFILE%`):

```text
~/.config/starmux/
  registry.json                 # Instance registry (names, UUIDs, default instance, config source paths)
  gateway.schema.json           # JSON Schema for config.jsonc validation and IDE autocomplete
  control/                      # Durable instance & port-lease ownership records
  instances/<instance-uuid>/
    config.jsonc                # Instance startup settings (port, projectRoot, mode, upstreams)
    state/                      # Private credentials (API key digests, OAuth settings/sessions, secrets)
    logs/                       # Gateway and supervisor execution logs
    snapshots/                  # Last-known-good configuration snapshots for automatic rollback
```

---

## 2. Installation & Upgrade Lifecycle

### 2.1 Global Installation from npm (Recommended)

```sh
npm install -g starmux
starmux --version
```

Published npm tarballs contain pre-compiled JavaScript and the bundled Desktop Commander engine; TypeScript is not required at runtime.

### 2.2 Building & Installing from a Git Checkout

When installing from source or testing local modifications:

```sh
git clone https://github.com/cookyecat/starmux.git
cd starmux
npm ci
npm run build
npm install --global .
starmux --version
```

- `npm run build` compiles TypeScript sources into `dist/src/` and vendors Desktop Commander into `dist/vendor/`.
- If `starmux` is not found after global installation, ensure your npm global bin directory (`$(npm prefix -g)/bin`) is in your shell `PATH` (in `zsh`, run `rehash`).

<a id="upgrade"></a>
### 2.3 Upgrading an Existing Installation

Before installing a newer version of `starmux`, **always stop all running instances using the currently installed CLI**:

```sh
starmux ls                   # 1. Inspect all active instances
starmux down                 # 2. Stop the default instance
starmux down -i NAME         # 3. Stop any additional named instances
npm install -g starmux       # 4. Install the new package version
starmux up                   # 5. Restart your instances
```

#### Why Stopping Before Upgrade Is Mandatory
1. **Live Supervisor Process:** Replacing global files under `node_modules` does not update or restart an already running background supervisor process.
2. **Versioned Control Contract:** The local instance control protocol (between the `starmux` CLI and the background supervisor) is versioned independently of package releases. Newer CLI binaries do not migrate live runtime directories or adapt older unversioned control sockets on the fly.
3. **Confirmed Cleanup:** `starmux down` sends a shutdown request over the control socket and blocks until the worker releases its TCP port lease and control records. It exits with `0` (`Stopped` or `Already stopped`) only after cleanup is confirmed. If `down` reports a timeout or control error (nonzero exit code), run `starmux doctor` to resolve it before upgrading.

---

## 3. Service Startup, Status Anatomy & CLI Reference

### 3.1 First Start & Status Output Anatomy

Navigate to your project directory and start the gateway:

```sh
cd /path/to/your/project
starmux up
```

On first execution, `starmux up` initializes the `default` instance, allocates port `18893` (or the next free port in `18893–19892`), spawns a detached background supervisor, and prints the runtime summary:

```text
● Starmux is running  (instance: default)
  Instance        <instance UUID>
  Listen          http://127.0.0.1:18893/mcp  (this computer only)
  Project         /path/to/your/project
  Mode            Read-only (global · OS account)  (run 'starmux up --code' to enable edits & shell)
  Auth            None (no token required)

Connect an AI client (MCP settings)
  Transport       Streamable HTTP
  URL (Local)     http://127.0.0.1:18893/mcp  (AI client on this computer)
  URL (Remote)    https://<your-domain-or-tunnel>/mcp  (via protected HTTPS proxy or tunnel -> 127.0.0.1:18893)
  Authentication  None  (optional Bearer API key: starmux auth key "My AI Client")

Commands
  Verify          starmux verify
  Auth & keys     starmux auth
  Dashboard       starmux dashboard  (view & copy settings in browser)
  Logs            starmux logs -f
  Stop            starmux down
```

#### Status Fields Explained

| Field | Meaning & Technical Behavior |
| :--- | :--- |
| **Heading (`●` / `◐` / `○` / `!`)** | `●` Running & healthy · `◐` Starting/degraded · `○` Stopped · `!` Configuration, auth, or runtime problem detected. |
| **`Instance`** | Stable UUID across restarts (whereas each start generates a fresh ephemeral `runId`). |
| **`Listen`** | Local loopback MCP endpoint (`http://127.0.0.1:<PORT>/mcp`). Never binds to `0.0.0.0` or public interfaces. |
| **`Project`** | Base directory used to resolve relative file paths in Read-Only mode. It is **not** a chroot or filesystem sandbox boundary. |
| **`Mode`** | Confirmed active permission mode enforced by the live supervisor (`Read-only` or `Coding`). If you have unapplied edits in `config.jsonc`, `status` displays both `Active mode` and `Saved mode (pending)`. |
| **`Auth`** | Active authentication mode: `None (no token required)`, `API key (Bearer token; N active keys)`, or `OAuth (browser sign-in)`. |

### 3.2 Project Path Resolution & Process Lifecycle

- **Reusing vs. Switching Project Context:**
  - When creating a **brand-new** instance, `starmux up` (without a path argument) defaults `Project` to your current working directory (`pwd`).
  - On an **existing** instance, running `starmux up` without a path argument **reuses the instance's saved `Project` path** regardless of your current directory.
  - To switch an existing instance's project directory, pass the path explicitly: `starmux up .` (current folder) or `starmux up ~/new/project`.
- **Switching Permission Modes:**
  - `starmux up --code` (alias `--write`): Enables **Coding Mode** (file edits, Shell execution, and Git) using your OS account permissions. Prompts for interactive confirmation the first time; pass `starmux up --code -y` for non-interactive/automated scripts.
  - `starmux up --read`: Switches back to global **Read-Only Mode** immediately.
- **Background vs. Foreground Execution:**
  - By default, `starmux up` detaches and continues running after you close the terminal (it does not register an OS boot/login service).
  - Pass `starmux up --foreground` to keep the supervisor attached to the current terminal until `Ctrl+C`—recommended when wrapping Starmux inside `systemd`, `launchd`, Docker, or `tmux`.

### 3.3 Everyday CLI Reference

| Command | Description | Supported Flags |
| :--- | :--- | :--- |
| `starmux up [PATH]` | Initialize (if needed), apply pending config, and start the instance | `--code` (`--write`), `--read`, `-y`, `--port <N>`, `--foreground`, `-i <name>`, `--json` |
| `starmux init [PATH]` | Create or update instance configuration without starting the service | `--code` (`--write`), `--read`, `-y`, `--port <N>`, `-i <name>`, `--json` |
| `starmux down` *(or `stop`)* | Stop the running instance and wait for confirmed resource cleanup | `-i <name>`, `--json` |
| `starmux status` | Display live health, permission mode, auth summary, and client config snippets | `--all`, `--json`, `-i <name>` |
| `starmux ls` | List all instances with status, mode, port, and project path | `--archived`, `--json` |
| `starmux rm [NAME]` | Stop and archive an instance (alias for `config archive`; retains snapshot) | `-i <name>`, `--json` |
| `starmux verify` | Run a local self-test (MCP handshake, tool discovery, and test read) | `--token-stdin`, `-i <name>`, `--json` |
| `starmux doctor` | Diagnose Node runtime, bundled dependencies, port leases, control sockets, and auth | `--json`, `-i <name>` |
| `starmux dashboard` | Open the local Web Access Console in your default browser | `--no-open`, `--token`, `-i <name>`, `--json` |
| `starmux logs` | View or stream instance execution logs (continues across restarts) | `-f` (`--follow`), `--lines <1..200>`, `-i <name>` |
| `starmux permissions` | Display the selected instance's active permission mode | `-i <name>`, `--json` |
| `starmux privacy` | Check OS privacy/filesystem access through the running instance | `--all`, `--target <PATH>`, `-i <name>`, `--json` |
| `starmux auth ...` | Manage authentication modes, Bearer API keys, and OAuth sessions | See [`SECURITY.md`](SECURITY.md) |
| `starmux config ...` | Edit, diff, apply, clone, import, or export `config.jsonc` and secrets | See [`INSTANCES.md`](INSTANCES.md) |

---

## 4. Remote Network Forwarding & Ingress Engineering

### 4.1 Loopback Boundary & HTTP `Host` Header Validation

To prevent DNS rebinding attacks and accidental public exposure of local management pages, Starmux enforces two strict transport checks before MCP authentication even runs:

1. **Loopback TCP Peer Check (`403 LOOPBACK_REQUIRED`):**
   The incoming TCP connection to Starmux must originate from the local machine (`127.0.0.1` or `::1`). External network traffic must terminate at a reverse proxy, tunnel client, or SSH daemon running on the same host.
2. **Loopback `Host` Authority Check (`403 HOST_NOT_ALLOWED`):**
   - Requests must contain exactly one `Host` header.
   - On `/mcp`, the `Host` header must match `127.0.0.1[:<port>]` or `localhost[:<port>]` (any port `1–65535` is accepted on `/mcp` so SSH port forwarding works even when local and remote ports differ).
   - On all other routes (`/healthz`, `/.well-known/oauth-protected-resource*`, `/dashboard`, `/access`), the `Host` header must match the exact listening port (`127.0.0.1:18893` or `localhost:18893`).
   - Public domain names in `Host` are always rejected, and `X-Forwarded-Host` is not trusted as a substitute. **Your reverse proxy or tunnel must rewrite the upstream `Host` header to `127.0.0.1:18893`.**

---

### 4.2 Option A — Direct Proxy with Caddy (Public Domain, Custom Port, IPv6, or LAN)

**Best for:** Hosts with a publicly reachable IPv4/IPv6 address or a direct LAN IP.

#### 1. DNS & Network Preparation (for Public Domains)
- **Public IPv4 (`A` record):** Point `mcp.example.com` to your server's public IPv4 (or your router's WAN IPv4 and forward `TCP 443` to your host). Note: Standard inbound IPv4 port forwarding will not work if your ISP uses CGNAT—use [IPv6](#3-custom-https-port-8443-custom-tls-cert-or-ipv6-only-host) or [Option B (Secure Tunnel)](#43-option-b--secure-tunnels-behind-nat--cgnat--firewalls) instead.
- **Public IPv6 (`AAAA` record):** Point `mcp.example.com` to your host's globally reachable IPv6 address and allow inbound `TCP 443` (or `8443`) in your router's IPv6 firewall and host firewall.
- **Verify DNS:** Run `dig +short mcp.example.com A` and `dig +short mcp.example.com AAAA`. Publish only the address family (`A` or `AAAA`) that is actually reachable from the internet.

#### 2. Standard HTTPS Setup on Port `443` (Caddy)

- **Quick one-command execution (reads config from stdin, no file needed):**
  ```bash
  caddy run --adapter caddyfile --config - << 'EOF'
  mcp.example.com {
  	handle /mcp {
  		reverse_proxy 127.0.0.1:18893 {
  			header_up Host 127.0.0.1:18893
  		}
  	}
  }
  EOF
  ```

- **Production `Caddyfile` (disables Caddy admin API and explicitly returns `404` for all non-`/mcp` paths):**
  ```caddyfile
  {
      admin off
  }
  mcp.example.com {
      handle /mcp {
          reverse_proxy 127.0.0.1:18893 {
              header_up Host 127.0.0.1:18893
          }
      }
      handle {
          respond "Not found" 404
      }
  }
  ```
  Validate and start Caddy:
  ```sh
  caddy validate --config /absolute/path/Caddyfile --adapter caddyfile
  caddy run --config /absolute/path/Caddyfile --adapter caddyfile
  ```

#### 3. Custom HTTPS Port (`8443`), Custom TLS Cert, or IPv6-Only Host

If port `443` is blocked by your ISP, or you manage your own TLS certificates on an IPv6 host:

```caddyfile
{
    admin off
}
https://mcp.example.com:8443 {
    bind YOUR_PUBLIC_IPV6_OR_IPV4
    tls /absolute/path/to/cert.crt /absolute/path/to/cert.key

    handle /mcp {
        reverse_proxy 127.0.0.1:18893 {
            header_up Host 127.0.0.1:18893
        }
    }
    handle {
        respond "Not found" 404
    }
}
```
*(Include `:8443` in your AI client URL: `https://mcp.example.com:8443/mcp`.)*

#### 4. Trusted Local Network (LAN HTTP without a Domain)

When connecting across two machines on a trusted home/office LAN (e.g., host IP `192.168.1.2` on port `8080`):

```bash
caddy run --adapter caddyfile --config - << 'EOF'
http://192.168.1.2:8080 {
	handle /mcp {
		reverse_proxy 127.0.0.1:18893 {
			header_up Host 127.0.0.1:18893
		}
	}
}
EOF
```
*(In your AI client on the LAN, set the URL to `http://192.168.1.2:8080/mcp`.)*

---

### 4.3 Option B — Secure Tunnels (Behind NAT / CGNAT / Firewalls)

**Best for:** Hosts behind NAT, CGNAT, or corporate firewalls where opening inbound ports is impossible. The tunnel client establishes an outbound connection from your host.

#### 1. OpenAI Secure MCP Tunnel (`tunnel-client`)

Designed for **ChatGPT Web** and **Codex** (see [official OpenAI Tunnel documentation](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)):

```bash
export MAC_MCP_TUNNEL_KEY="your_restricted_runtime_api_key"

tunnel-client run \
  --control-plane.tunnel-id "tunnel_YOUR_TUNNEL_ID" \
  --control-plane.api-key "env:MAC_MCP_TUNNEL_KEY" \
  --mcp.server-url "http://127.0.0.1:18893/mcp" \
  --health.listen-addr "127.0.0.1:18891" \
  --log.level info
```
- **Using an outbound HTTP proxy:** Append `--control-plane.http-proxy "http://127.0.0.1:PROXY_PORT"`.
- **Profile diagnostics:** If using a saved profile, run `tunnel-client doctor --profile <YOUR_PROFILE> --explain`.

#### 2. Cloudflare Tunnel (`cloudflared`)

- **Temporary Quick Tunnel (`*.trycloudflare.com`):**
  ```sh
  cloudflared tunnel --url http://127.0.0.1:18893 --http-host-header 127.0.0.1:18893
  ```
- **Permanent Named Tunnel (`config.yml`):**
  ```yaml
  tunnel: <YOUR-TUNNEL-UUID>
  credentials-file: /path/to/credentials.json

  ingress:
    - hostname: mcp.example.com
      service: http://127.0.0.1:18893
      originRequest:
        httpHostHeader: 127.0.0.1:18893
    - service: http_status:404
  ```

#### 3. ngrok & Tailscale Funnel

- **ngrok:**
  ```sh
  ngrok http 18893 --host-header=127.0.0.1:18893
  ```
- **Tailscale Funnel / Serve:**
  ```sh
  tailscale funnel 18893
  ```
  *(If your Tailscale version passes the public `.ts.net` hostname in `Host`, place Caddy in front to rewrite `header_up Host 127.0.0.1:18893`.)*

---

### 4.4 Option C — SSH Local Port Forwarding (Laptop $\rightarrow$ Linux / NVIDIA Jetson)

**Best for:** Running a desktop AI client (like WorkBuddy or Cursor) on a macOS/Windows laptop while Starmux runs on a remote Linux server or NVIDIA Jetson device.

On your laptop, keep this SSH port-forwarding command running:

```sh
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:18894:127.0.0.1:18893 \
  -p 2222 nvidia@192.168.1.2
```

#### Technical Notes on SSH Forwarding
- **Explicit `127.0.0.1` local bind:** `-L 127.0.0.1:18894:...` binds port `18894` only on your laptop's loopback interface, preventing other devices on your Wi-Fi from accessing the forwarded port.
- **Why local (`18894`) and remote (`18893`) ports can differ:** Using `18894` on your laptop prevents a port collision if your laptop is also running its own local Starmux instance on `18893`. Because SSH forwards raw TCP bytes without rewriting HTTP headers, Starmux's `/mcp` endpoint explicitly accepts `Host: 127.0.0.1:18894` (or `localhost:18894`) even when listening on `18893`.
- **`ExitOnForwardFailure=yes`:** Forces `ssh` to exit immediately with an error if local port `18894` cannot be bound, rather than silently staying connected without forwarding.

---

## 5. Verification, Diagnostics & Troubleshooting

### 5.1 Local vs. End-to-End Verification

1. **Local Self-Test (`starmux verify`):**
   ```sh
   # When Auth mode is 'none' (default):
   starmux verify

   # When Auth mode is 'api-key' or 'oauth' (via env var or stdin):
   STARMUX_TOKEN=smx_YOUR_API_KEY starmux verify
   starmux verify --token-stdin < /private/token-file
   ```
   `starmux verify` connects to `http://127.0.0.1:<PORT>/mcp`, completes the MCP initialization handshake, lists tools, and performs a test directory read (`list_directory`):
   ```text
   ✓ MCP handshake      http://127.0.0.1:18893/mcp
   ✓ Tool discovery     26 tools available (Read-only mode)
   ✓ Workspace read     /path/to/your/project
   PASS · MCP handshake, tool discovery and workspace read.
   ```
2. **Runtime & Environment Diagnostics (`starmux doctor`):**
   ```sh
   starmux doctor
   ```
   Verifies the Node.js runtime (`>=22.12.0`), bundled Desktop Commander engine, instance state, `config.jsonc` validity, port availability, and authentication store:
   ```text
   ✓ Runtime            Node v22.12.0 & Desktop Commander engine ready
   ✓ Service            Running on 127.0.0.1:18893
   ✓ Workspace          /path/to/your/project (Read-only mode)
   ✓ Configuration      ~/.config/starmux/instances/<uuid>/config.jsonc (active)
   ✓ Authentication     None (no token required)
   PASS · Node, dependencies, workspace, configuration, port and authentication.
   ```
3. **End-to-End Remote Verification:**
   Passing `starmux verify` locally confirms that Starmux itself is healthy, but does **not** test your external Caddy proxy, tunnel, DNS, or SSH forward. Always verify remote setups by triggering a real `health_check` and `read_file` tool call from your remote AI client.

### 5.2 Troubleshooting Matrix

| Symptom / Error Code | Root Cause | Resolution |
| :--- | :--- | :--- |
| **`HTTP 403` (`HOST_NOT_ALLOWED`)** | Reverse proxy or tunnel forwarded a public domain name (e.g., `mcp.example.com` or `*.trycloudflare.com`) in the HTTP `Host` header. | Configure `header_up Host 127.0.0.1:18893` in Caddy, `--http-host-header 127.0.0.1:18893` in `cloudflared`, or `--host-header=127.0.0.1:18893` in `ngrok`. |
| **`HTTP 403` (`LOOPBACK_REQUIRED`)** | A non-loopback IP connected directly to Starmux's TCP port. | Run Caddy, `tunnel-client`, or `sshd` on the same host as Starmux so the TCP peer is `127.0.0.1`. |
| **`HTTP 401 Unauthorized` on `/mcp`** | Client omitted the `Authorization` header, sent a revoked/expired token, or the instance's active auth mode does not match. | Run `starmux auth` to inspect the active mode (`none`, `api-key`, `oauth`) and active credentials. |
| **Instance status shows `unknown`** | The CLI cannot verify live worker state (e.g., control socket in `~/.config/starmux/control` was removed or an older supervisor holds the port). | Run `starmux doctor` and `starmux status` to inspect `runtimeProblem`. Resolve or stop the conflicting process before running `starmux up`. |
| **Port `18893` is already in use** | Another process or instance owns the port. | First run `starmux doctor` to check if an existing Starmux run owns it; to switch ports, run `starmux up --port 18894` (or `starmux config edit`) and update your proxy/client port. |
| **Local `verify` passes, but remote HTTPS fails** | DNS, firewall, router port-forwarding (`TCP 443`), or IPv6 routing issue between the client and your host. | Test `curl -i https://mcp.example.com/mcp` from an external network; verify `A`/`AAAA` records and router/OS firewall rules. |
| **Fake-IP DNS or local VPN/TUN breaks discovery** | Local proxy software on the host is intercepting outbound/loopback DNS or TLS routes. | Add a direct bypass rule for your domain and `127.0.0.1` in your local proxy/TUN client. |
| **Tools appear in AI client, but writes/Shell fail** | Instance is running in default **Read-Only** mode (`starmux up`). | Run `starmux up --code` to enable file writes, Shell, and Git. |
| **CLI commands don't affect the running server** | You have multiple instances and omitted `-i <name>`. | Run `starmux ls` to see all instances and pass `-i <name>` to target the right one. |

---

[Documentation Index](README.md) · [Security & Authentication](SECURITY.md) · [AI Client Guides](CLIENTS.md) · [Multi-Instance & Config](INSTANCES.md)
