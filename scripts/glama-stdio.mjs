// Glama-only adapter. The normal Starmux CLI remains a loopback HTTP server.
import {execFile} from 'node:child_process';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {promisify} from 'node:util';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'bin/starmux.mjs');
let home;
let server;
let cleanupPromise;
let started = false;

async function runCli(args) {
  const result = await execute(process.execPath, [cli, ...args], {
    cwd: root,
    env: {...process.env, HOME: home, USERPROFILE: home},
    timeout: 45000,
    maxBuffer: 1024 * 1024,
  });
  // stdout belongs exclusively to MCP JSON-RPC, including during startup.
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function cleanup() {
  return cleanupPromise ??= (async () => {
    try { await server?.close(); } catch (error) { console.error(error); }
    if (home && started) {
      try { await runCli(['down']); }
      catch (error) {
        console.error('[glama] Could not confirm Starmux shutdown:', error.message);
        // Keep runtime records if shutdown could not be confirmed.
        return;
      }
    }
    if (home) await rm(home, {recursive: true, force: true});
  })();
}

async function stop(code) {
  await cleanup();
  process.exit(code);
}

try {
  if (!process.env.GLAMA_VERSION) {
    throw new Error('Run this adapter only inside the isolated Glama container (GLAMA_VERSION is required).');
  }
  // Glama installs mcp-proxy globally. Reuse it without adding a production
  // dependency to Starmux or downloading packages at server startup.
  const {stdout} = await execute('npm', ['root', '-g']);
  const require = createRequire(import.meta.url);
  const proxyPath = require.resolve('mcp-proxy', {paths: [path.dirname(stdout.trim())]});
  const {startStdioServer, ServerType} = await import(pathToFileURL(proxyPath).href);

  home = await mkdtemp(path.join(tmpdir(), 'starmux-glama-'));
  const project = path.join(home, 'workspace');
  await mkdir(project);
  // Fresh private state, no host mounts, no credentials, no coding permissions.
  started = true;
  await runCli(['up', project, '--read', '--port', '18893']);
  server = await startStdioServer({
    serverType: ServerType.HTTPStream,
    url: 'http://127.0.0.1:18893/mcp',
  });
  process.once('SIGTERM', () => void stop(0));
  process.once('SIGINT', () => void stop(0));
  process.stdin.once('end', () => void stop(0));
  process.stdin.once('error', () => void stop(1));
} catch (error) {
  console.error('[glama] Startup failed:', error.message);
  await stop(1);
}
