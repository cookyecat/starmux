# TypeScript migration acceptance record

Validated on Apple Silicon macOS, 2026-10-20.

## Subsequent product scope change

At the owner's request, the optional fixed two-tool read-only ingress and its dedicated doctor command were removed after migration. Their CLI adapters and implementation modules are no longer shipped. The normal Core, trusted native forwarding, restricted workspace profile and Swift sources are unchanged. JWT verification and revocation remain internal, tested primitives; they no longer depend on ingress configuration and are not an active HTTP authentication layer.

Source build and prepare now clear `dist` before compilation so removed modules cannot leak into npm or App artifacts. The original counts and validation matrix below record the migration milestone, including the now-removed ingress test; they are not the current file inventory. The post-removal suite has four integration scripts and 13 Node tests.

## Implemented

Subsequent CLI usability fixes add direct `setup`, saved-configuration `doctor`, and `verify` commands; visible English startup identity; onboarding-first configuration selection; and current-CLI Core execution even with legacy settings. Integration coverage includes trusted Home setup/doctor/write/Shell/status/stop and legacy settings whose old executable paths no longer exist. These supersede the original implicit legacy executable selection.

- Migrated all 28 original Core modules, 9 CLI implementations and 4 original test scripts to TypeScript. Added shared contracts, Zod schemas, unknown-value boundary helpers, centralized runtime paths, result validation, remote authentication, internal invocation middleware and a separate dispatcher. There are 45 business TypeScript modules in `src/`, including the CLI.
- One ESM package; NodeNext/ES2022, strict checking, unchecked-index protection, exact optional properties, verbatim module syntax and no emit on errors. Runtime JavaScript and source maps are emitted to `dist/src`. Source maps contain original sources. No TypeScript loader, broad `any`, `@ts-nocheck` or parallel JavaScript business implementation is used.
- Retained nine CLI `.mjs` adapters and `src/dc-workspace-http.mjs`. Stable CLI paths survive subprocess launches; Desktop Commander resolves through Node's dependency resolution, including hoisted npm installs.
- Core construction/import is inert. Runtime instances explicitly start and close, coalesce concurrent starts and clean up failed startup. Signal ownership is confined to the process entrypoint.
- Explicit deny checks and before hooks precede dispatch. Dispatcher preserves Gateway/extension/native/workspace/fixture priority. Upstream execution consumes an authorized invocation once. After hooks receive frozen copies; observation/audit exceptions do not mask returned results or replay effects. Remote identity validation remains separate from workspace authorization and local owner control.
- Swift sources are unchanged: all 12 `.swift` files are byte-identical to the pre-migration snapshot. Existing launcher, setup wizard and live settings paths remain present.
- App build compiles a separate source staging directory with locked development dependencies, then includes emitted runtime files and locked production dependencies. Pinned bundled Node and ad-hoc signature order remain unchanged.

## Validation results

| Check | Result |
| --- | --- |
| Original JavaScript baseline before edits | All four scripts passed |
| `npm run typecheck` | Passed |
| Delete `dist`, then `npm test` on Node 26.10.0 | Four integration scripts plus 14 Node tests passed |
| Same compiled test suite on official Node 22.0.0 arm64 | Four integration scripts plus 14 Node tests passed |
| Real Desktop Commander 0.3.0 | 25 native tools; discovery, authorized write/read roundtrip and restricted write refusal passed |
| Router and MCP results | Schema, annotations, `_meta`, structured/text/image/resource content and extension preservation; unknown names/collisions and default resources passed |
| Authentication | Local ES256 keys: invalid signatures/issuer/audience/expiry/subject/scope rejected; live token revocation and unavailable/unsafe state fail closed |
| Ingress authorization | Read-only discovery and calls; write refusal; caller identity headers not forwarded as trusted Core identity |
| Invocation faults | Rejection causes zero calls; extension grants checked before native passthrough; failing observers/audit preserve results; uncertain stdio effects executed once |
| Configuration and control | v1/v2/v3, roles, private permissions, symlink/traversal refusal, sandbox unavailable refusal, duplicate ownership, forged socket messages and unknown listeners passed |
| Lifecycle | Coalesced starts, close/restart, occupied port, failed startup, trusted stop and parent App exit release resources/ports |
| Source installation | Fresh staging `npm ci` ran prepare and produced runtime artifacts |
| Packed npm installation | Explicit allowlist, source maps and stable entries; production install without TypeScript; Node 22.0.0 onboarding/doctor/status/MCP/stop from unrelated working directory passed |
| Self-contained App | Fresh staging build, bundled Node 26.10.0, Swift `--selftest`, deep/strict codesign verification and isolated onboarding/doctor/status/MCP/stop passed |

The tests run emitted JavaScript. `test/run.ts` supplies a temporary HOME and removes inherited Gateway configuration variables; individual configuration/control tests also allocate temporary roots and ports. `test/test-release1-onboarding.ts` accepts `GATEWAY_TEST_PACKAGE_ROOT` to exercise a packed install or App Core using the same external CLI contract checks, from an unrelated working directory.

## Dependency and compatibility notes

The direct runtime versions remain MCP SDK 1.32.1, Desktop Commander 0.3.0, jose 6.2.12 and Zod 3.25.76. Existing lock entries changed only for `@types/node`, now pinned to 22.20.5; TypeScript is pinned to 5.9.3. npm tarball consumers use npm's normal dependency resolution; the App uses the committed lockfile for its production install.

The declared package Node floor remains 22 for compatibility. Runtime tests also passed on 22.0.0; Desktop Commander's own existing package metadata requires >=22.12.0, so use 22.12 or later when installing with strict engine enforcement. The App includes Node 26.10.0.

The pinned MCP SDK transport declarations do not fully align with exact optional properties. One documented `Transport` assertion remains at the SDK HTTP connection boundary. This does not weaken the Gateway compiler options or expose an `any` contract.

`typescript-baseline-sha256.json` records the pre-migration snapshot. `FILE_INVENTORY.sha256` covers the current source delivery, excluding dependencies, emitted output and the local CodeGraph index. The JavaScript baseline was supplied as a source snapshot. Local Git history begins with the TypeScript refactor; the earlier history is not reconstructed.

## Separate release gates

This validates the TypeScript refactor and local distribution layouts. It does not establish public release approval, Developer ID signing/notarization, independent clean-Mac UI onboarding, or live cloud/Tunnel client acceptance. Authentication tests use local signing keys and a simulated upstream; the genuine remote acceptance matrix remains in `RELEASE_STATUS.md`. No public Middleware SDK, script plugin loader, Catalog or new authentication mechanism was introduced.
