# Architecture

```text
Remote MCP Client(s)
       |
       +--> Authenticated Direct HTTPS (public TLS 443 + caller auth) --+
       |                                                              |
       +--> Secure MCP Tunnel (outbound, OpenAI infrastructure) --------+
                                                                      |
                                                      Mac MCP Gateway Core
                                                      localhost MCP + policy
                                                                      |
                                               Desktop Commander MCP (stdio)
                                                                      |
                                                      User's Mac OS / tools
```

The menu bar App and CLI are two controllers for **one** local Core. Remote transports are separate from those controllers. Gateway owns ingress/routing/authorization boundaries and doesn't reimplement the actual upstream MCP file/Git/Shell tools. Real remote caller identity and authorization must be checked **before** granting trusted developer capabilities.

Foreground startup separates configuration from executable selection. Automatic selection prefers the saved onboarding configuration, then a validated legacy configuration if no onboarding file exists. Legacy configuration supplies settings only: the Core and Node process come from the invoked CLI installation. `run` prints the configuration path, actual compiled Core module path, package version/code fingerprint and port in English; `run --json` and App-parent launches emit structured lifecycle events. Advanced profile selection changes configuration, not the executable version.

This release provides a single-Mac Gateway that was owner-tested with 25 native Desktop Commander tools and 2 Gateway tools. Operator-configured stdio upstreams are supported with explicit tool grants and namespaced tool names; public external client verification, unified multi-Mac management, generalized user-script middleware and GUI Computer Use are **not** fully shipped.

## Core implementation

Gateway Core and CLI are one ESM npm package written in strict TypeScript. SwiftUI remains the native App interface. `tsc` uses NodeNext resolution and ES2022 output; relative source imports end in `.js`. Production entrypoints run emitted JavaScript without a TypeScript loader.

| Boundary | Implementation |
| --- | --- |
| Shared protocol and configuration | `src/contracts.ts`, SDK MCP types, `src/config-schemas.ts` (Zod 3) |
| Upstream lifecycle and native forwarding | `local-desktop-read-probe.ts`, `configured-mcp-upstreams.ts` |
| Names, collisions and default resources | `mcp-upstream-router.ts` |
| Internal identity and revocation primitives (not wired into Core HTTP) | `remote-auth.ts`, `community-remote-revocations.ts` |
| Workspace authorization and argument preparation | workspace policies, grants, explicit deny rules |
| Internal execution and observations | `invocation.ts`, `tool-dispatch.ts` |
| Explicit HTTP lifecycle | `createGatewayRuntime()` in `dc-workspace-http.ts` |
| CLI and owner control | `src/cli/`, `operator-cli.ts`, `global-core-control.ts` |

Calls pass through explicit deny checks, internal `beforeCall` hooks, target dispatch, policy preparation, execution, and `afterCall` observation. Dispatch preserves the priority of Gateway tools, extension routes, owner-enabled native mode, workspace mode and fixed fixtures. The executor consumes an internal authorized invocation once before awaiting an upstream response. An uncertain call is never automatically replayed. Hooks receive frozen copies; failed observers or audit sinks cannot replace an obtained result. The original MCP result is returned, including structured content, resource/image content and extension fields.

These hooks are package-internal code contracts. There is no public Middleware SDK, user-script loader or package-level SDK export. The internal authenticator checks JWT identity, an explicitly required scope and revocation state; it is not an HTTP service and is not connected to Core requests. Core requests remain explicitly `unverified-local` because loopback and ordinary headers do not establish that identity. Remote deployments must supply their actual authenticated access boundary. Owner control uses its separate private socket/lease protocol.

The former optional two-tool read-only ingress and its dedicated doctor command have been removed. Normal Core permission profiles, explicit deny rules and trusted native Desktop Commander forwarding are unchanged. The retained `remote:revoke` helper manages revocation data for the internal authenticator only; it does not disconnect an existing Tunnel or revoke access in an external identity provider.

Importing Core modules or constructing a runtime does not listen, start upstream processes or register signal handlers. `start()` and `close()` manage an instance; `runGateway()` is the process entrypoint that owns signals. Remaining `bin/*.mjs` adapters and `src/dc-workspace-http.mjs` load `dist/src` implementations. Installation paths resolve from the compiled package location, including child CLI restarts, independently of the caller's current directory. Source builds clear `dist` before compiling so removed modules cannot remain in published artifacts.

## Named instance management

`instance-store.ts` owns the private registry, JSONC parsing, generated JSON Schema, source revisions and independent state paths. App and CLI use the same commands. `instance-runtime.ts` supervises one Core process per instance, with authenticated instance-ID/run-ID control plus the existing global port lease. The supervisor applies immutable configuration snapshots, restarts only its worker and restores the prior snapshot once on launch failure. Dynamic credential and authorization state is never restored from a startup snapshot. `instance-migration.ts` provides read-only legacy discovery followed by an explicit switch. Legacy entrypoints remain available before migration.

Swift `InstanceController` invokes the shared CLI and tracks only its own child supervisors. The manager window edits stopped instances and shows saved versus active configuration. Quitting stops that App session's children without adopting CLI instances. The old diagnostic views remain available as supporting code; the primary menu now opens instance management.
