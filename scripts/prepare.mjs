// Published tarballs already contain dist; source installs build locally.
import {existsSync} from 'node:fs';
if (existsSync(new URL('../src/cli/starmux.ts', import.meta.url))) {
  await import('./build.mjs');
}
