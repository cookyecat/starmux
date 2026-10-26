// Always rebuild from source so deleted entrypoints cannot survive in a package.
import {rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
rmSync(new URL('../dist/', import.meta.url), {recursive:true, force:true});
const result = spawnSync(process.execPath, [root + '/node_modules/typescript/bin/tsc', '-p', root + '/tsconfig.json'], {stdio:'inherit', cwd:root});
if ((result.status ?? 1) !== 0) {
  process.exitCode = result.status ?? 1;
} else {
  await import('./vendor-desktop-commander.mjs');
}
