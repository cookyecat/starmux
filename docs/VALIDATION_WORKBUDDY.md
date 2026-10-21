# WorkBuddy API-key acceptance over HTTPS and IPv6

Date: 2026-10-21. Client: WorkBuddy 5.8.3 on macOS.

## Result

WorkBuddy loaded a custom Streamable HTTP MCP configuration with an Authorization Bearer header, initialized the Gateway over HTTPS, and discovered 27 tools. Its own daemon log recorded HTTP 200 and `connection-ready` with 27 tools. An authenticated GET returned 405 because this Core does not offer a standalone SSE stream; initialization and discovery still completed successfully.

The test used a domain with only an AAAA record pointing at this Mac, an existing valid Let's Encrypt certificate, and Caddy bound to the Mac's global IPv6 address on port 8443. Port 443 was unavailable to the unprivileged process. Certificate validation was enabled. Only `/mcp` was forwarded to an isolated loopback Core on port 18894; `/dashboard` returned 404.

The existing Tunnel Core on port 8793 and its ingress authentication mode were not changed.

## Client configuration shape

```json
{
  "mcpServers": {
    "mac-mcp-gateway-ipv6": {
      "type": "streamable-http",
      "url": "https://YOUR_DOMAIN:8443/mcp",
      "headers": { "Authorization": "Bearer YOUR_GATEWAY_KEY" }
    }
  }
}
```

The real credential was written directly to the user-authorized WorkBuddy configuration file with mode 0600, never committed. Server authentication state is stored separately in a private validation directory; Gateway stores credential hashes. Reload/restart the client after externally editing its configuration, and follow any client-side approval prompt.

## Authentication checks

- No key: HTTP 401.
- Incorrect key: HTTP 401.
- WorkBuddy key: HTTP 200 and 27 tools.
- Separate temporary key before revocation: HTTP 200.
- Same temporary key after revocation: HTTP 401.
- WorkBuddy key after revoking the temporary key: still HTTP 200.
- TLS verification: passed; actual peer was the Mac's global IPv6 address.

## Limits

The client and server ran on the same Mac. This validates real WorkBuddy protocol/credential compatibility and HTTPS over the host's global IPv6 address, but does not prove external router/firewall reachability from another network. No WorkBuddy AI programming task, reboot persistence, token expiry, OAuth, or unattended certificate renewal was tested in this pass. The test Core and HTTPS proxy are foreground processes, not installed login services. The proxy uses the existing certificate explicitly; this setup is not a permanent certificate-renewal deployment.
