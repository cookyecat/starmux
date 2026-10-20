// Published tarballs already contain dist; source installs build locally.
import {existsSync} from 'node:fs';
if (existsSync(new URL('../src/cli/mac-mcp-gateway.ts', import.meta.url))) {
  await import('./build.mjs');
}
