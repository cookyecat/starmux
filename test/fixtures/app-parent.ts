import {spawn} from 'node:child_process';
import {legacyCliEntry as cliEntry} from '../../src/runtime-paths.js';
const child=spawn(process.execPath,[cliEntry(),'run','--profile','setup','--app-parent-pid',String(process.pid)],{
  stdio:['ignore','inherit','inherit']
});
process.stdout.write(JSON.stringify({testChildPid:child.pid})+'\n');
child.once('error',()=>{process.exitCode=1;});
child.once('exit',code=>{process.exitCode=code??1;});
