# WorkBuddy API-key acceptance over HTTPS and IPv6

Date: 2026-10-21. Client: WorkBuddy 5.8.3 on macOS.

## Initial same-host result (2026-10-21)

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

## Limits of the initial same-host test

The client and server ran on the same Mac. This validates real WorkBuddy protocol/credential compatibility and HTTPS over the host's global IPv6 address, but does not prove external router/firewall reachability from another network. No WorkBuddy AI programming task, reboot persistence, token expiry, OAuth, or unattended certificate renewal was tested in this pass. The test Core and HTTPS proxy are foreground processes, not installed login services. The proxy uses the existing certificate explicitly; this setup is not a permanent certificate-renewal deployment.

## Remote-host follow-up (2026-10-22)

The owner subsequently tested WorkBuddy from a remote host over public IPv6 and HTTPS. For this follow-up, the owner started the CLI with the dedicated API-key access store and `--profile live` on port 8793, then changed Caddy's upstream and upstream Host header to `127.0.0.1:8793`. This differs from the initial isolated port-18894 test above. Other clients targeting port 8793 now also require a valid key.

Evidence and scope:

- Owner-reported remote network test; supplied screenshot shows the Gateway connected, 27/27 tools enabled and two Desktop Commander resources discovered.
- Owner-supplied remote WorkBuddy transcript reports successful `health_check`, with trace ID `5fb9bd4b-139a-4947-a458-d577ad13069f`.
- The transcript reports reading a 48-line Markdown document from the server Mac's Downloads directory and summarizing it, using only the Gateway connector.
- The transcript reports writing a 32-line story to the server Mac's Downloads directory, using only the Gateway connector.
- Independently inspected the resulting `~/Downloads/story.txt` on the server Mac: 1,844 bytes, 32 lines, modified at 2026-10-22 01:19:58 +08:00. Its title and content match the reported lighthouse story. The inspecting agent did not create or modify that file.

Conclusion: the owner reports successful remote HTTPS/IPv6/API-key connection and actual file reading/writing; the written artifact is independently confirmed on the server. The inspecting agent did not capture the remote client's network traffic or independently replay its remote read call. No credentials, personal document contents, or story contents are included in this report.

Tool-count clarification: the route health result reports 25 upstream tools; the screenshot shows 27 total tools including Gateway tools. The transcript's manually grouped list of 26 omits `list_sessions`; it is not evidence of a routing failure.

Remaining acceptance: a remote WorkBuddy edit-and-execute coding workflow, external-client revocation behavior, restart persistence, OAuth, and sustained service operation. Remote file reading/writing does not by itself establish terminal execution or completion of the OAuth roadmap.
