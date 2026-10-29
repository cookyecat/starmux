import path from 'node:path';
import { fileURLToPath } from 'node:url';
// This module executes from <installation>/dist/src, never directly as TS.
export const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
export const cliEntry = (name = 'starmux') => path.join(packageRoot, 'bin', name + '.mjs');
// Vendored zero-telemetry build of Desktop Commander bundled inside dist/vendor.
export const desktopCommanderEntry = path.join(packageRoot, 'dist', 'vendor', 'desktop-commander', 'dist', 'index.js');
export const desktopCommanderPackageJson = path.join(packageRoot, 'dist', 'vendor', 'desktop-commander', 'package.json');
