import path from 'node:path';
import {createRequire} from 'node:module';
import { fileURLToPath } from 'node:url';
// This module executes from <installation>/dist/src, never directly as TS.
export const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
export const cliEntry = (name = 'mac-mcp-gateway') => path.join(packageRoot, 'bin', name + '.mjs');
// npm may hoist dependencies above this package; resolve exactly as Node does.
export const desktopCommanderEntry = createRequire(import.meta.url).resolve('@wonderwhy-er/desktop-commander/dist/index.js');
export const fixtureRoot = path.join(packageRoot, 'test', 'fixtures');
