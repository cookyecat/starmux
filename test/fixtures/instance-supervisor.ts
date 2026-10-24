// Dependency-injected worker crash exercises rollback without modifying production files.
import {runInstance} from '../../src/instance-runtime.js';
import {resolveInstance} from '../../src/instance-store.js';
await runInstance(await resolveInstance(process.argv[2]),{json:true,workerModule:new URL('./instance-worker.js',import.meta.url)});
