# Connect ChatGPT to Starmux

**Your Gateway is running on your Mac. How does ChatGPT reach it?**

For the complete current **OAuth / HTTPS + Bearer API Key** deployment procedure, use [Remote installation](REMOTE_SETUP.md). This page explains network choices.

Choose the connection that matches your network. **Start with Direct HTTPS** if your Mac can accept inbound internet traffic. Choose **Secure MCP Tunnel** if it cannot, or you prefer not to open a public HTTPS entry point.

| | **1. Direct HTTPS — recommended for reachable networks** | **2. Secure MCP Tunnel — for restricted networks** |
| --- | --- | --- |
| ChatGPT connects using | Your public `https://your-domain.example/mcp` URL | Your personal OpenAI Platform `tunnel_id` |
| Network requirement | Publicly reachable IPv4 and/or IPv6 + inbound TCP 443 | Outbound HTTPS from your Mac |
| You operate | DNS, TLS, HTTPS reverse proxy, Gateway; authorization server for OAuth | `tunnel-client`, Gateway; reachable authorization server for OAuth |
| Hosted forwarding | No Desktop Commander relay or OpenAI Tunnel | OpenAI Tunnel is used; no Desktop Commander relay |


## Before either connection

1. Install and start Starmux using [Local installation](INSTALL.md).
2. Run `starmux status` and confirm **`● Starmux is running`**. Note your **actual local port**. The default port is **18893**; use the actual value shown by `status`.
3. The **local** MCP address is `http://127.0.0.1:<PORT>/mcp`. You don't paste that into ChatGPT Web: ChatGPT runs in the cloud and cannot dial your machine's `localhost` directly.
4. Start with the default **Read-only** mode (`starmux up`). Switch to **Coding mode** (`starmux up --code`) when you want ChatGPT to edit files or run Shell commands.

## 1. Direct HTTPS — your domain, your Gateway

**Best for:** a Mac with a publicly reachable IP address, typically on an international home network, office network, or a suitable hosted Mac. This is the preferred direct route when reliable inbound access is possible.

**The idea is simple:**

```text
ChatGPT → https://mcp.your-domain.example/mcp
        → public IP (DNS A/AAAA)
        → HTTPS :443 + authentication
        → reverse proxy on your Mac
        → http://127.0.0.1:<PORT>/mcp
        → Starmux → Desktop Commander
```

The public domain points to **your** machine or home router, not to the Gateway's loopback port. Here are the steps.

### Step 1 — Check whether your Mac can be reached from the internet

Determine how your Mac reaches the internet:

- **Public IPv4:** your DNS **A** record usually points to your router's public WAN IPv4. Configure your router to forward **TCP 443** to an HTTPS reverse proxy running on the Mac. If your ISP uses **CGNAT**, normal inbound IPv4 port-forwarding generally won't work.
- **Public IPv6:** your DNS **AAAA** record can point to the Mac's **globally reachable IPv6** address. Allow inbound **TCP 443** through the router's IPv6 firewall and macOS firewall as appropriate. IPv6 address stability, ISP filters and ChatGPT's actual reachability must still be checked.
- **Changing public IP:** use your DNS provider's **Dynamic DNS (DDNS)** feature or a small updater to keep A/AAAA records current.

DNS is only the **address book**. Pointing a domain at an IP does **not** automatically open ports, install HTTPS, authenticate clients, or make an IPv6-only endpoint reachable by ChatGPT. If inbound access is unavailable, choose [Secure MCP Tunnel](#2-secure-mcp-tunnel--no-inbound-port).

### Step 2 — Register a domain and set its DNS record

Buy or use a domain from any registrar, then open the DNS dashboard for the provider hosting its DNS zone. Create a subdomain such as `mcp.your-domain.example`.

| DNS record | Name | Value (example only) | When to use |
| --- | --- | --- | --- |
| **A** | `mcp` | `203.0.113.10` | Public IPv4 of your router/server |
| **AAAA** | `mcp` | `2001:db8::10` | Publicly reachable IPv6 of your Mac |

These are **documentation-only addresses**, not usable addresses. Use your own public IP. For the first test, publish only the address family you can actually reach; a broken AAAA record alongside a working A record can complicate connection attempts.

Check the result with `dig +short mcp.your-domain.example A` and `dig +short mcp.your-domain.example AAAA`. DNS changes can take time to propagate.

### Step 3 — Set up HTTPS *and* authentication

Run an HTTPS reverse proxy such as **Caddy** or **Nginx**, listen on public **TCP 443**, and obtain a valid TLS certificate for `mcp.your-domain.example`. Its protected MCP route forwards requests internally to `http://127.0.0.1:<PORT>/mcp`.

**Before** exposing this route, configure **real caller authentication and authorization**. Core OAuth validates the token and checks owner/session authorization; Core API-key mode validates supported clients’ Bearer keys. A separately controlled ingress is also supported in ingress mode. HTTPS encryption by itself **does not** authenticate the AI client; a private-looking domain name is not access control.

Follow the [deployment guide](REMOTE_SETUP.md) to configure authentication before exposing `/mcp`. Keep the local Gateway port on loopback.

### Step 4 — Add the URL in ChatGPT

Once the public HTTPS MCP endpoint is reachable **and authenticated**:

1. Open **ChatGPT on the web** and navigate to **Plugins → + → Add custom MCP server**.
2. Enter a recognizable name, e.g. *My Mac Gateway*.
3. Under **Connection**, enter the **full public URL**, including `/mcp`:

   `https://mcp.your-domain.example/mcp`

4. Configure the authentication requested by your server. Read and accept the security warning, then choose **Create as a plugin**.
5. Review the discovered tools. Make a harmless authorized `read_file` request from ChatGPT and verify that a forbidden write is rejected. Also verify that revoked access stops working.

**Success means a real ChatGPT tool call worked**, not just that DNS resolved, a browser displayed a certificate, or `/healthz` answered locally.

## 2. Secure MCP Tunnel — no inbound port

**Best for:** Mac users behind CGNAT, restrictive firewalls, unstable inbound IP networking, or those who cannot/won't expose a public HTTPS entry point.

A Tunnel keeps the Gateway local and uses an **outbound connection from your Mac to OpenAI**. This avoids opening your router's inbound ports. The trade-off is that **OpenAI's Tunnel service forwards the requests**; it is not a completely third-party-free transport.

The steps below are intentionally short because **the official OpenAI guide is the authoritative source**: [Secure MCP Tunnel documentation](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).

### Step 1 — Create your own Tunnel in OpenAI Platform

Visit [OpenAI Platform Tunnel settings](https://platform.openai.com/settings/organization/tunnels), sign in to the intended organization and create a Tunnel. Confirm the Tunnel is associated with the **ChatGPT workspace** that will use it.

Creating or editing a Tunnel requires **Tunnels Read + Manage** permission; running `tunnel-client` or choosing a Tunnel in ChatGPT requires **Tunnels Read + Use**. Ask your organization/workspace admin if these controls aren't available.

Save your **own `tunnel_id`**. The Starmux release doesn't bundle the maintainer's Tunnel ID, organization identity or runtime credential.

### Step 2 — Run the official tunnel-client on your Mac

Install OpenAI's supported `tunnel-client` using the official guide. Follow its current instructions to configure a profile with:

- Your own Platform Tunnel ID and **restricted runtime API key**, kept out of Git, shell history and screenshots.
- For ingress-managed mode, the MCP target **`http://127.0.0.1:<PORT>/mcp`**, reachable locally on the Mac.
- For the **OAuth** layout, use the same-origin HTTPS target and trusted issuer described in [OAuth Tunnel setup](REMOTE_SETUP.md#official-openai-tunnel), not the loopback target above.

Use the version-specific help and health check:

```bash
tunnel-client help quickstart
tunnel-client doctor --profile <YOUR_PROFILE> --explain
tunnel-client run --profile <YOUR_PROFILE>
```

Keep both Starmux and `tunnel-client` running.

### Step 3 — Choose the Tunnel in ChatGPT

1. Open **ChatGPT web → Plugins → + → Add custom MCP server**.
2. Set a name and choose **Connection: Tunnel**.
3. Select your available Tunnel, or enter your **own `tunnel_id`** if the UI permits.
4. Complete authentication and risk review; create the plugin.
5. Verify a real permitted `read_file` request and a denied write from ChatGPT.

If ChatGPT doesn't list your Tunnel, check the Platform organization ↔ ChatGPT workspace association, **Tunnels Read + Use**, runtime readiness and custom MCP permissions.

## Which route should you choose?

**Reachable international network with a stable domain?** Start with **Direct HTTPS**, once you have secure authentication in place.

**Behind CGNAT, restrictive NAT/firewall, or unable to verify inbound IPv6?** Use **Secure MCP Tunnel**. It sacrifices independent transport but avoids an inbound listener.

Neither route replaces Desktop Commander or changes your local file permissions. The Gateway owns the connection and routing boundary; the upstream MCP server does the actual work.

## Troubleshooting & current limits

- **Can reach the Dashboard, but ChatGPT fails:** Dashboard is local. Verify public `https://.../mcp` reachability, valid TLS and authentication, or check Tunnel readiness and workspace linking.
- **DNS resolves, but HTTPS fails:** DNS alone doesn't open TCP 443. Recheck router port-forward/IPv6 firewall, ISP blocks, proxy and certificate.
- **Tools appear, but write is denied:** This may be correct. Check remote caller authorization and local restricted/developer mode. Don't disable security just to make discovery green.
- **No “Add custom MCP server” option:** ChatGPT's available custom MCP features depend on plan and workspace permissions. See [OpenAI's current connection instructions](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt).

[Main README](../README.md) · [Local installation](INSTALL.md) · [Security](SECURITY.md)
