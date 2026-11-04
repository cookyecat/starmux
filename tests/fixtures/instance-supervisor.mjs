import {runInstance} from '../../dist/src/instance-runtime.js';
import {resolveInstance} from '../../dist/src/instance-store.js';

const [home, id] = process.argv.slice(2);
try {
  await runInstance(await resolveInstance(id, home), {
    home,
    json: true,
    background: true,
    workerModule: new URL('./instance-worker.mjs', import.meta.url),
    onReady: async () => { process.send?.({type: 'ready'}); }
  });
} catch (error) {
  process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
} finally {
  if (process.connected) process.disconnect();
}
