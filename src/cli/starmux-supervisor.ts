// Private detached-process entrypoint. No public command aliases.
import {resolveInstance} from '../instance-store.js';
import {runInstance} from '../instance-runtime.js';
try { await runInstance(await resolveInstance(process.argv[2]),{json:true,background:true}); }
catch(error){process.stderr.write(String(error)+'\n');process.exitCode=1;}
