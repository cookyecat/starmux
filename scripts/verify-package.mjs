// Exact-package acceptance. All generated files remain in .internal.
import {cpSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,symlinkSync,realpathSync,appendFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const npm=process.env.npm_execpath;if(!npm)throw Error('Run npm run verify:package so the active npm CLI is used.');
mkdirSync(path.join(root,'.internal'),{recursive:true});
const work=mkdtempSync(path.join(root,'.internal/package-acceptance-')),source=path.join(work,'source'),consumer=path.join(work,'consumer');mkdirSync(source);mkdirSync(consumer);
const log=path.join(work,'verification.log');
function run(program,args,cwd=source,env=process.env){const result=spawnSync(program,args,{cwd,env,encoding:'utf8',timeout:300000,maxBuffer:16777216});appendFileSync(log,(result.stdout??'')+(result.stderr??''));if(result.status!==0)throw Error(`PACKAGE_CHECK_FAILED (${args[0]}): see ${log}`);return result.stdout;}
for(const name of ['src','scripts','bin','docs','package.json','package-lock.json','tsconfig.json','README.md','CHANGELOG.md','LICENSE','server.json'])cpSync(path.join(root,name),path.join(source,name),{recursive:true});
symlinkSync(path.join(root,'node_modules'),path.join(source,'node_modules'),process.platform==='win32'?'junction':'dir');
run(process.execPath,['scripts/build.mjs']);
const packed=JSON.parse(run(process.execPath,[npm,'pack','--ignore-scripts','--json','--pack-destination',work]));
const tarball=path.join(work,packed[0].filename);
writeFileSync(path.join(consumer,'package.json'),JSON.stringify({name:'starmux-production-acceptance',private:true,type:'module'}));
run(process.execPath,[npm,'install','--omit=dev','--ignore-scripts','--no-audit','--no-fund',tarball],consumer);
const typescript=path.join(root,'node_modules/typescript/bin/tsc');
writeFileSync(path.join(consumer,'middleware-typecheck.ts'),`import {defineMiddleware} from 'starmux/middleware';
export default defineMiddleware({apiVersion:1,request(context){return {action:'continue',arguments:{...context.arguments}};},response(context,result){return {...result};}});
`);
writeFileSync(path.join(consumer,'tsconfig.json'),JSON.stringify({compilerOptions:{noEmit:true,strict:true,module:'NodeNext',moduleResolution:'NodeNext',target:'ES2022',types:[]},files:['middleware-typecheck.ts']}));
run(process.execPath,[typescript,'-p','tsconfig.json'],consumer);
// A consumer under the repository must not accidentally fall back to dev dependencies.
const allowed=realpathSync(consumer)+path.sep;
writeFileSync(path.join(consumer,'guard.cjs'),`const Module=require('node:module'),path=require('node:path');const resolve=Module._resolveFilename;Module._resolveFilename=function(...args){const file=resolve.apply(this,args);if(path.isAbsolute(file)&&!file.startsWith(${JSON.stringify(allowed)}))throw Error('DEPENDENCY_OUTSIDE_PRODUCTION_INSTALL: '+file);return file;};const cp=require('node:child_process');for(const name of ['spawn','fork']){const original=cp[name];cp[name]=function(command,args,options={}){return original.call(this,command,args,{...options,env:{...(options.env??process.env),NODE_OPTIONS:process.env.NODE_OPTIONS}});};}Module.syncBuiltinESMExports();`);
writeFileSync(path.join(consumer,'guard.mjs'),`import {fileURLToPath} from 'node:url';export async function resolve(specifier,context,next){const result=await next(specifier,context);if(result.url.startsWith('file:')&&!fileURLToPath(result.url).startsWith(${JSON.stringify(allowed)}))throw Error('DEPENDENCY_OUTSIDE_PRODUCTION_INSTALL');return result;}`);
writeFileSync(path.join(consumer,'plugin.mjs'),`import {defineMiddleware} from 'starmux/middleware';export default defineMiddleware({apiVersion:1,request(context){return {action:'continue',arguments:context.arguments};},response(context,result){return {...result,_meta:{...result._meta,packageMarker:context.options.marker??'initial'}};}});`);
cpSync(path.join(root,'tests/package-smoke.mjs'),path.join(consumer,'smoke.mjs'));
const env={...process.env,NODE_OPTIONS:`--require ${JSON.stringify(path.join(consumer,'guard.cjs'))} --experimental-loader ${JSON.stringify(path.join(consumer,'guard.mjs'))}`};
run(process.execPath,['smoke.mjs'],consumer,env);
mkdirSync(path.join(consumer,'tests/fixtures'),{recursive:true});
cpSync(path.join(root,'tests/vendor-telemetry.test.mjs'),path.join(consumer,'tests/vendor-telemetry.test.mjs'));
cpSync(path.join(root,'tests/fixtures/deny-network.cjs'),path.join(consumer,'tests/fixtures/deny-network.cjs'));
run(process.execPath,['--test','tests/vendor-telemetry.test.mjs'],consumer,{...env,STARMUX_TEST_VENDOR_ROOT:path.join(consumer,'node_modules/starmux/dist/vendor/desktop-commander')});
writeFileSync(path.join(work,'receipt.json'),JSON.stringify({tarball,sha512:packed[0].integrity,platform:process.platform,arch:process.arch,node:process.version,productionOnly:true,publicTypes:true,telemetryOffline:true,passed:true},null,2));
console.log(`Exact package acceptance passed: ${work}`);
