// Execute emitted tests with an isolated HOME, including the real stdio upstream.
import {spawn} from 'node:child_process';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const directory=fileURLToPath(new URL('.',import.meta.url));
const home=await mkdtemp(join(tmpdir(),'gateway-suite-home-'));
const env: NodeJS.ProcessEnv={...process.env,HOME:home,...(process.platform==='win32'?{USERPROFILE:home}:{})};
for(const key of Object.keys(env))if(key.startsWith('MAC_MCP_'))delete env[key];
async function run(args:string[]):Promise<void>{
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(process.execPath,args,{env,stdio:'inherit'});
    child.once('error',reject);
    child.once('exit',(code,signal)=>code===0?resolve():reject(Error(`TEST_PROCESS_FAILED: ${code??signal}`)));
  });
}
try{
  for(const name of process.platform==='darwin'?['test-community-onboarding','test-release1-onboarding','test-gateway-status-format','test-upstream-router']:[])
    await run([join(directory,name+'.js')]);
  const tests=(await readdir(directory)).filter(file=>file.endsWith('.test.js')&&(process.platform==='darwin'||['access.test.js','platform.test.js','invocation.test.js','upstream-failures.test.js'].includes(file))).sort();
  await run(['--test',...tests.map(file=>join(directory,file))]);
}finally{await rm(home,{recursive:true,force:true});}
