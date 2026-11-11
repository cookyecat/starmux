// Always rebuild from source so deleted entrypoints cannot survive in a package.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareBuildOutput} from './build-output.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
prepareBuildOutput(root);
const result = spawnSync(process.execPath, [root + '/node_modules/typescript/bin/tsc', '-p', root + '/tsconfig.json'], {stdio:'inherit', cwd:root});
if ((result.status ?? 1) !== 0) {
  process.exitCode = result.status ?? 1;
} else {
  await import('./vendor-desktop-commander.mjs');
}
