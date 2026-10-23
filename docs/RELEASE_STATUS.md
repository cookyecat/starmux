# Community preview status

- **Available now as source:** strict TypeScript CLI/Core (compiled JavaScript distribution), local setup and doctor tools, English/Chinese menu bar App source, MIT license and pinned upstream dependencies. Private owner-tested Mac runtime: v0.9.0, 27 MCP tools, loopback Core health, trusted Home write scope.
- **For developers:** `build/build_arm64_app.py` builds a **preview-only ad-hoc signed** self-contained Apple Silicon App from an official pinned Node arm64 archive. The signed/notarized GitHub Release ZIP is **not yet publicly available**.
- **Remote options:** Direct HTTPS is recommended when public reachability and caller authentication are configured; OpenAI Tunnel is an outbound alternative. Neither has independently completed community-user external identity / read / deny / revoke acceptance.
- **Authenticated acceptance:** real ChatGPT web OAuth over Tunnel passed login, coding, session revocation and fresh-login recovery. WorkBuddy HTTPS + Bearer API key passed remote file reads/writes. [Deployment steps](REMOTE_SETUP.md) and [client matrix](CLIENTS.md) separate tested paths from compatibility expectations.
- **Stage 4:** deployment documentation and existing CLI/Dashboard management are available. One-click provider provisioning, a guided alias flow, separate native OAuth setup screens and independent first-user validation remain unfinished.
- **Not yet shipped:** general user-defined MCP script hooks, unified multi-computer orchestration, independent clean-Mac onboarding and a production-grade one-click public OAuth setup.
- **Publication:** community-preview documentation is available. Before publishing an artifact or repository, verify that it excludes private configuration, credentials and personal deployment identifiers; review any history being published, third-party notices and security reporting. Documentation review is not a completed artifact/history audit. Signed App distribution has separate signing/notarization gates.

[Install locally](INSTALL.md) · [Connect ChatGPT](CONNECT_CHATGPT.md) · [Security](SECURITY.md)
