# Programmable gateway and MCP services

Starmux keeps its existing startup and client connection address. Authentication defaults to `none`; `--allow-lan` changes the listening interface without enabling authentication. Additional servers and middleware are optional. The native macOS App links to the selected instance's **MCP servers** and **Middleware** pages.

## Connect a server

Open `starmux dashboard`, choose **MCP servers**, and paste a command, URL, single server object, or `mcpServers` configuration. **Preview** only parses the input. **Test connection** starts the configured program or connects to the remote endpoint. **Enable tested services** saves the definitions and applies them to a running instance.

```sh
starmux server add 'npx --yes YOUR_MCP_PACKAGE@VERSION' --name example
starmux server add 'https://your-server.example/mcp' --name remote
starmux server import ./client-config.json --preview
starmux server import ./client-config.json --prepare
starmux server list --json
starmux server test example
starmux server disable example
starmux server enable example
starmux server refresh example
starmux server retry example
starmux server remove example
starmux server templates
```

`--instance NAME` selects an instance. `--prepare` gives the explicit connection/preparation operation up to five minutes; daily startup keeps its seven-second shared initialization/discovery budget. Existing Node, uv/uvx and Docker executables are reused. Install a missing runtime yourself using its vendor's instructions; Starmux does not install system runtimes. Package commands may download dependencies, and Docker may pull an image. A preview never performs these actions.

Commands are tokenized into executable and arguments. Shell pipes, redirection, command substitution and unquoted shell operators are rejected. Quote an argument containing spaces. Import-file relative paths use that file's directory; pasted paths use the instance project directory. Existing definitions without `cwd` keep their previous behavior.

The first successful discovery authorizes the tools found in that import. Explicit `allowTools`, including an empty list, is honored. Refreshing a registered service preserves its authorization list. Use **Edit**, change the definition's `allowTools`, preview and test, then **Replace existing service** to deliberately change it. Name conflicts never silently overwrite an existing server. CLI replacement requires `--replace`.

Additional tools retain `<server ID>__<native name>`. Built-in Desktop Commander names remain unchanged. Read-only mode still excludes additional tools; a server's `readOnlyHint` never grants permission or enables a cache. The service page distinguishes discovered, authorized and mode-available counts.

Service updates connect and validate a candidate first. A failed candidate leaves the running version available and the saved configuration pending. Existing calls keep their original routing and middleware generation. Disabling or removing a service removes it from new calls immediately after application; existing calls receive up to five seconds to drain. An interrupted call may have executed upstream: check its effects before retrying.

## Remote credentials

The Web form accepts a header name and API key value. Imported `env` values and sensitive headers are converted to `envRefs`/`headerRefs` in the instance configuration. Resolved values are stored privately per instance and excluded from configuration export. Existing references continue to work. Non-sensitive headers may remain in configuration.

OAuth is a separate outbound account per instance and service. It does not change client access authentication. Choose **Sign in** after previewing an OAuth service, or configure the remote definition:

```json
{
  "id": "remote",
  "transport": "streamable-http",
  "url": "https://your-server.example/mcp",
  "allowTools": ["lookup"],
  "headerRefs": {},
  "auth": {"type": "oauth"}
}
```

Pre-registered clients can supply `clientId`, `issuer`, and optionally `clientSecretRef`. Discovery, PKCE, callback state checks and token refresh use the pinned MCP SDK. Registration and tokens remain bound to the upstream server URL. Headless login returns an authorization URL and the loopback port to forward to the Starmux host. No browser is required on that host.

```sh
starmux server auth remote login
starmux server auth remote status
starmux server auth remote logout
starmux server retry remote
```

After authorization, retry the connection. An expired or revoked refresh token may require signing in again. Legacy HTTP+SSE uses an explicit `"transport":"sse"`; ordinary HTTP errors never trigger a transport downgrade. Authorization behavior follows the [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), using the versions supported by SDK 1.32.1.

## Middleware

Normal configurations do not need a `middlewares` field. Add built-ins using the Web form or CLI:

```sh
starmux middleware add '{"id":"defaults","builtin":"arguments","match":{"servers":["remote"]},"options":{"defaults":{"limit":20},"trim":["query"]}}'
starmux middleware list --json
starmux middleware disable defaults
starmux middleware enable defaults
starmux middleware order defaults,mask
starmux middleware reload
```

Built-in types and their options:

| Type | Options |
| --- | --- |
| `arguments` | `defaults`: missing argument values; `trim`: string argument names |
| `catalog` | `hidden`, `alias`, `description`, optional public `inputSchema`/`outputSchema` |
| `route` | `when`: argument equality conditions; `target`: `{serverId, toolName}` |
| `result` | `fields`: retained structured-content fields; other MCP result fields remain intact |
| `redact` | `fields`: object keys to replace with `[REDACTED]`; this does not parse arbitrary text |
| `cache` | Explicit `match.tools` and `options.readOnly: true` confirmation required; optional `ttlMs` (default 30 seconds, maximum 5 minutes) |

Match values use real server IDs and native tool names. Missing match fields mean all servers/tools. Route hooks select the first target, then the target is locked. Source and target request hooks run once in configuration order; response hooks run in reverse. Final permissions use the canonical target, so aliases cannot turn a write tool into a read-only tool. Both public and final target schemas are checked. A synthetic result skips only upstream execution, not permission checks or response transformations.

The read cache is opt-in, bounded to 100 entries / 1 MiB per pipeline, and partitioned by target, effective arguments, caller identity, permission mode, current upstream account and pipeline version. Errors are not cached. The owner must explicitly confirm selected remote tools are reads; known Desktop write/execute tools are rejected. hints do not establish that a tool is suitable for caching.

### Local plugins

```js
import { defineMiddleware } from 'starmux/middleware';

export default defineMiddleware({
  apiVersion: 1,
  request(context) {
    return {
      action: 'continue',
      arguments: { limit: 20, ...context.arguments }
    };
  },
  response(context, result) {
    return { ...result }; // Preserve content, structuredContent, _meta and extensions.
  }
});
```

Save as an ESM `.mjs` file (or `.js` in an ESM package) and configure:

```json
{
  "id": "my-plugin",
  "module": "./middleware/normalize.mjs",
  "match": {"servers": ["remote"]},
  "options": {}
}
```

Module paths are relative to the instance configuration file. TypeScript authors compile to ESM before loading; no runtime TypeScript compiler is embedded. A module must be able to resolve its imports from its own location; install `starmux` in that module's project when importing the public helper. Type declarations ship with the package.

The versioned hooks are `catalog(entries, options)`, `route(context)`, `request(context)`, `response(context, result)` and `observe(event)`. See the exported TypeScript definitions for return shapes. `request` returns `continue`, `reject` with a reason, or `respond` with an MCP result. Conflicting synthetic results fail explicitly. Plugins never receive the SDK Client or a gateway execution credential.

Each enabled plugin configuration owns a Node process. **Plugins are trusted local code with the OS account's permissions; process isolation is not an OS sandbox.** Initialization defaults to 10 seconds, hooks to 2 seconds, concurrency to 16, and the queue to 64. Advanced optional fields are `initializationTimeoutMs`, `timeoutMs`, `concurrency`, and `queueLimit`. A faulty worker is terminated and receives at most three bounded recovery attempts; the original call is never replayed. Use **Reload modules** after correcting code.

Failures include a stable code, plugin ID, phase, and `upstreamExecution`: `not_started`, `returned`, or `uncertain`. Codes include `MIDDLEWARE_REJECTED`, `MIDDLEWARE_FAILED`, `MIDDLEWARE_TIMEOUT`, `MIDDLEWARE_INVALID_OUTPUT`, and `MIDDLEWARE_BUSY`. Response failures never release the unprocessed upstream result. Pure observer failures do not change successful results. A plugin can perform its own side effects even when upstream execution is `not_started`.

### Test and inspect

**Sample test** uses the supplied request/result data and does not call an upstream tool. Custom plugin code still executes as trusted local code. CLI equivalent: `starmux middleware test --file sample.json`; the sample contains `tool`, `request`, `result`, and optional `serverId`/`toolName`.

The logs page defaults to summaries. Opt-in detail recording shows client arguments, actual upstream invocation, upstream response and final response, plus middleware phases and durations. Records remain bounded to 200 calls / 30 minutes in memory. Previews mask common secret keys, omit binary content and truncate large output. Arbitrary text can still contain sensitive material. Calls served synthetically or from cache have no upstream request and corresponding phase records.

## Protocol behavior and troubleshooting

Initialized clients receive independent MCP sessions. Directory changes notify clients with a notification channel; otherwise refresh/reconnect. Resources and templates use reversible `starmux://<server>/<encoded-native-uri>` namespaces; prompts use `<server>__<name>`. Known resource links and MCP App UI URIs are rewritten consistently. Desktop Commander keeps its native resource route.

Sampling, elicitation and roots requests use a dedicated upstream connection for the originating downstream session when the client advertises the relevant capability. They are never broadcast to other clients. Unsupported interactions are rejected. Progress and cancellation are associated with the original call. A canceled or disconnected write is never automatically replayed. Request cancellation does not close a healthy shared upstream connection or terminate a shared plugin worker. A queued plugin hook is removed; a dispatched hook may finish in the background, with its result discarded and its concurrency slot retained until completion. A genuinely stuck hook still triggers the worker timeout and recovery policy. Protocol negotiation follows the SDK-supported versions and [MCP lifecycle rules](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle).

If a service is unavailable, inspect its bounded diagnostics, fix the executable/URL/credentials, then retry. A missing runtime, invalid import field, repeated pagination cursor, catalog limit or name collision is a failure rather than a partially published catalog. A failed apply means the saved configuration and running snapshot differ; the previous running version remains active. Port, listening interface and global permission changes still use the existing instance restart flow.

MCP HTTP request bodies are limited to 1 MiB (1,048,576 bytes), for both Content-Length and chunked transfers. Larger requests return HTTP 413; split large tool arguments into smaller operations.
