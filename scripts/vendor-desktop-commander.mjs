// Build-time surgical sterilization and vendoring of @wonderwhy-er/desktop-commander.
// Strips all telemetry, remote-device cloud relay, browser auto-download (Puppeteer),
// welcome-page browser popups, and LLM prompt-injection surveys.
// Enforces a strict Zero-Telemetry Audit Gate on the emitted dist/vendor bundle.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);

const upstreamIndex = require.resolve('@wonderwhy-er/desktop-commander/dist/index.js');
const upstreamRoot = path.resolve(path.dirname(upstreamIndex), '..');
const upstreamPkg = JSON.parse(readFileSync(path.join(upstreamRoot, 'package.json'), 'utf8'));

const vendorRoot = path.join(root, 'dist', 'vendor', 'desktop-commander');
const vendorDist = path.join(vendorRoot, 'dist');

rmSync(vendorRoot, { recursive: true, force: true });
mkdirSync(vendorRoot, { recursive: true });

// 1. Copy compiled dist and MIT LICENSE
cpSync(path.join(upstreamRoot, 'dist'), vendorDist, { recursive: true });
if (existsSync(path.join(upstreamRoot, 'LICENSE'))) {
  cpSync(path.join(upstreamRoot, 'LICENSE'), path.join(vendorRoot, 'LICENSE'));
}

// 2. Write a clean, minimal package.json (no postinstall, no telemetry-contract)
writeFileSync(
  path.join(vendorRoot, 'package.json'),
  JSON.stringify(
    {
      name: '@wonderwhy-er/desktop-commander',
      version: upstreamPkg.version,
      description: 'Purified zero-telemetry build of Desktop Commander MCP for Starmux',
      license: upstreamPkg.license || 'MIT',
      author: upstreamPkg.author,
      repository: upstreamPkg.repository,
      type: 'module',
      bin: {
        'desktop-commander': 'dist/index.js',
      },
    },
    null,
    2
  ) + '\n'
);

// 3. Physically delete all telemetry, cloud-relay, installer, and marketing files
const pathsToRemove = [
  'track-installation.js',
  'track-installation.d.ts',
  'track-installation.js.map',
  'setup-claude-server.js',
  'uninstall-claude-server.js',
  'remote-device',
  'npm-scripts',
  'data/onboarding-prompts.json',
  'ui/file-preview/src',
  'ui/config-editor/src',
  'ui/shared',
];
for (const rel of pathsToRemove) {
  rmSync(path.join(vendorDist, rel), { recursive: true, force: true });
}

// 4. Replace telemetry & cloud modules with 100% offline no-op stubs
writeFileSync(
  path.join(vendorDist, 'utils', 'capture.js'),
  `import { AsyncLocalStorage } from 'async_hooks';

const uiOriginCallContext = new AsyncLocalStorage();
export function runInUiOriginCallContext(fn) {
  return uiOriginCallContext.run(true, fn);
}
export function isInsideUiOriginCall() {
  return uiOriginCallContext.getStore() === true;
}

const toolCallPaths = new AsyncLocalStorage();
export function runWithToolCallPaths(fn) {
  return toolCallPaths.run(new Set(), fn);
}
export function addToolCallPaths() {}

export function isTelemetryDisabledByEnv() {
  return true;
}

export function sanitizeError(error) {
  if (error instanceof Error) {
    return {
      message: \`\${error.name}: \${error.message}\`,
      code: 'code' in error ? error.code : undefined,
    };
  }
  return {
    message: typeof error === 'string' ? error : 'Unknown error',
    code: undefined,
  };
}

export const captureBase = async () => {};
export const buildEventProperties = async () => ({});
export const capture = async () => {};
export const captureTransport = async () => {};
export const capture_call_tool = async () => {};
export const capture_ui_event = async () => {};
export const captureRemote = async () => {};
`
);

writeFileSync(
  path.join(vendorDist, 'utils', 'feature-flags.js'),
  `class FeatureFlagManager {
  async initialize() {}
  get(_flagName, defaultValue = false) {
    return defaultValue;
  }
  getAll() {
    return {};
  }
  async refresh() {
    return false;
  }
  wasLoadedFromCache() {
    return true;
  }
  async waitForFreshFlags() {}
  destroy() {}
}
export const featureFlagManager = new FeatureFlagManager();
`
);

writeFileSync(
  path.join(vendorDist, 'utils', 'open-browser.js'),
  `export async function openBrowser() {}
export async function openWelcomePage() {}
`
);

writeFileSync(
  path.join(vendorDist, 'utils', 'welcome-onboarding.js'),
  `export async function skipWelcomePageOnboarding() {}
export async function handleWelcomePageOnboarding() {}
`
);

writeFileSync(
  path.join(vendorDist, 'utils', 'dockerPrompt.js'),
  `export async function shouldPromptForDockerInfo() {
  return false;
}
export function getDockerInfoMessage() {
  return '';
}
export async function processDockerPrompt(result) {
  return result;
}
`
);

writeFileSync(
  path.join(vendorDist, 'tools', 'feedback.js'),
  `export async function giveFeedbackToDesktopCommander() {
  return {
    content: [
      {
        type: 'text',
        text: 'Telemetry and external feedback forms are disabled in Starmux.',
      },
    ],
  };
}
`
);

// Replace tools/pdf/markdown.js: keep pure-JS PDF reading (@opendocsg/pdf2md),
// completely strip Puppeteer / @puppeteer/browsers / md-to-pdf headless Chrome download.
writeFileSync(
  path.join(vendorDist, 'tools', 'pdf', 'markdown.js'),
  `import fs from 'fs/promises';
import { pdf2md } from './lib/pdf2md.js';
import { LazyPackage } from '../../utils/lazy-package.js';

const isUrl = (source) => source.startsWith('http://') || source.startsWith('https://');

export const mdToPdfPackage = new LazyPackage('md-to-pdf', 'PDF writing support', () => ({}));

export function ensureChromeAvailable() {}

export function resolveRender(markdown, options = {}) {
  return { body: markdown, options: { ...options }, ignoredOptions: [] };
}

async function loadPdfToBuffer(source) {
  if (isUrl(source)) {
    const response = await fetch(source);
    return await response.arrayBuffer();
  }
  return await fs.readFile(source);
}

export async function parsePdfToMarkdown(source, pageNumbers = []) {
  const data = await loadPdfToBuffer(source);
  return await pdf2md(new Uint8Array(data), pageNumbers);
}

export async function parseMarkdownToPdf() {
  throw new Error('Headless browser PDF rendering (Puppeteer/Chrome) is stripped in Starmux for security and privacy.');
}
`
);

// Replace index.js to remove setup/remove/remote CLI branches and ensureChromeAvailable()
writeFileSync(
  path.join(vendorDist, 'index.js'),
  `#!/usr/bin/env node
import './bootstrap.js';
import { FilteredStdioServerTransport } from './custom-stdio.js';
import { server, flushDeferredMessages } from './server.js';
import { configManager } from './config-manager.js';
import { logToStderr, logger } from './utils/logger.js';
import { exitProcess } from './utils/exit-process.js';
import { preloadFileSupport } from './utils/files/index.js';

const deferredMessages = [];
function deferLog(level, message) {
  deferredMessages.push({ level, message });
}

async function runServer() {
  try {
    global.disableOnboarding = true;
    const transport = new FilteredStdioServerTransport();
    global.mcpTransport = transport;
    try {
      deferLog('info', 'Loading configuration...');
      await configManager.loadConfig();
      deferLog('info', 'Configuration loaded successfully');
    } catch (configError) {
      deferLog('error', \`Failed to load configuration: \${configError instanceof Error ? configError.message : String(configError)}\`);
      deferLog('warning', 'Continuing with in-memory configuration only');
    }

    process.on('uncaughtException', async (error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('JSON') && errorMessage.includes('Unexpected token')) {
        logger.error(\`JSON parsing error: \${errorMessage}\`);
        return;
      }
      logger.error(\`Uncaught exception: \${errorMessage}\`);
      exitProcess(1);
    });

    process.on('unhandledRejection', async (reason) => {
      const errorMessage = reason instanceof Error ? reason.message : String(reason);
      if (errorMessage.includes('JSON') && errorMessage.includes('Unexpected token')) {
        logger.error(\`JSON parsing rejection: \${errorMessage}\`);
        return;
      }
      logger.error(\`Unhandled rejection: \${errorMessage}\`);
    });

    deferLog('info', 'Connecting server...');
    server.oninitialized = () => {
      transport.enableNotifications();
      while (deferredMessages.length > 0) {
        const msg = deferredMessages.shift();
        transport.sendLog('info', msg.message);
      }
      flushDeferredMessages();
      transport.sendLog('info', 'Server connected successfully');
      transport.sendLog('info', 'MCP fully initialized, all startup messages sent');
      preloadFileSupport();
    };
    await server.connect(transport);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(\`FATAL ERROR: \${errorMessage}\`);
    const errorNotification = {
      jsonrpc: '2.0',
      method: 'notifications/message',
      params: {
        level: 'error',
        logger: 'desktop-commander',
        data: \`Failed to start server: \${errorMessage} (\${new Date().toISOString()})\`,
      },
    };
    process.stdout.write(JSON.stringify(errorNotification) + '\\n');
    exitProcess(1);
  }
}

runServer().catch(async (error) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    JSON.stringify({
      type: 'error',
      timestamp: new Date().toISOString(),
      message: \`Fatal error running server: \${errorMessage}\`,
    }) + '\\n'
  );
  exitProcess(1);
});
`
);

// 5. Patch config-manager.js defaults to disable telemetry & onboarding by default
const configManagerPath = path.join(vendorDist, 'config-manager.js');
if (existsSync(configManagerPath)) {
  const cm = readFileSync(configManagerPath, 'utf8')
    .replace(/telemetryEnabled:\s*true/g, 'telemetryEnabled: false')
    .replace(/pendingWelcomeOnboarding:\s*true/g, 'pendingWelcomeOnboarding: false')
    .replace(/welcomeOnboardingEligible:\s*true/g, 'welcomeOnboardingEligible: false');
  writeFileSync(configManagerPath, cm);
}

// 6. Patch usageTracker.js to disable survey prompt injections
const usageTrackerPath = path.join(vendorDist, 'utils', 'usageTracker.js');
if (existsSync(usageTrackerPath)) {
  let ut = readFileSync(usageTrackerPath, 'utf8');
  ut = ut.replace(/async shouldPromptForFeedback\(\)\s*\{[\s\S]*?return daysSinceFirstUse >= 3 && stats\.totalToolCalls >= 10;\s*\}/, 'async shouldPromptForFeedback() { return false; }');
  ut = ut.replace(/async shouldPromptForErrorFeedback\(\)\s*\{[\s\S]*?stats\.totalSessions >= 3;\s*\}/, 'async shouldPromptForErrorFeedback() { return false; }');
  ut = ut.replace(/async getFeedbackPromptMessage\(\)\s*\{[\s\S]*?return messages\[randomIndex\];\s*\}/, "async getFeedbackPromptMessage() { return { variant: 'disabled', message: '' }; }");
  writeFileSync(usageTrackerPath, ut);
}

// 7. Patch server.js to strip [FEEDBACK DEBUG] stdout pollution
const serverPath = path.join(vendorDist, 'server.js');
if (existsSync(serverPath)) {
  const srv = readFileSync(serverPath, 'utf8').replace(/console\.log\(\`\[FEEDBACK DEBUG\][^\n]*\);\s*/g, '');
  writeFileSync(serverPath, srv);
}

// 7b. Patch tools/filesystem.js to use Node 22 built-in global fetch instead of cross-fetch
const fsToolPath = path.join(vendorDist, 'tools', 'filesystem.js');
if (existsSync(fsToolPath)) {
  const fst = readFileSync(fsToolPath, 'utf8').replace(/import fetch from ['"]cross-fetch['"];\s*/g, '');
  writeFileSync(fsToolPath, fst);
}

// 8. Remove all .d.ts and .d.ts.map files from vendorDist to keep published tarball lean
function pruneDeclarationsAndCollectFiles(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      pruneDeclarationsAndCollectFiles(full, files);
    } else if (entry.name.endsWith('.d.ts') || entry.name.endsWith('.d.ts.map')) {
      rmSync(full, { force: true });
    } else {
      files.push(full);
    }
  }
  return files;
}
const remainingFiles = pruneDeclarationsAndCollectFiles(vendorRoot);

// 9. Automated Zero-Telemetry & Zero-Bloat Security Gate
const forbiddenPatterns = [
  'desktopcommander.app',
  'dc-telemetry-proxy',
  'tally.so',
  'supabase',
  '@puppeteer/browsers',
  'md-to-pdf/dist',
  'telemetry-contract',
  'track-installation',
  'cross-fetch',
  'Desktop Commander Team request',
  'telemetryEnabled: true',
];

const violations = [];
for (const file of remainingFiles) {
  if (!file.endsWith('.js') && !file.endsWith('.json')) continue;
  const content = readFileSync(file, 'utf8');
  for (const pattern of forbiddenPatterns) {
    if (content.includes(pattern)) {
      violations.push(`${path.relative(vendorRoot, file)} contains forbidden pattern "${pattern}"`);
    }
  }
}

if (violations.length > 0) {
  console.error('ZERO_TELEMETRY_AUDIT_FAILED:\n' + violations.map((v) => '  - ' + v).join('\n'));
  process.exit(1);
}

let totalBytes = 0;
for (const file of remainingFiles) totalBytes += statSync(file).size;
console.log(
  `[vendor-desktop-commander] Sterilized @wonderwhy-er/desktop-commander@${upstreamPkg.version} -> dist/vendor/desktop-commander (${remainingFiles.length} files, ${(totalBytes / 1024).toFixed(1)} KiB, 0 telemetry/cloud endpoints)`
);
