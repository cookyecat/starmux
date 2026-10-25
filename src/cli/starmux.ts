import {parseArgs} from 'node:util';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {open,realpath,readFile,stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createAccessControl} from '../access-control.js';
import {instanceStatus,instanceRequest,runInstance} from '../instance-runtime.js';
import {atomicPrivate,availablePort,changeRegistry,createInstance,ensureAccessReady,exists,instanceConfigSchema,instancePaths,loadInstanceConfig,parseConfig,patchInstanceConfig,readRegistry,readTrusted,resolveInstance,saveInstanceConfig,suggestPort,validateConfig,type Instance,type InstanceConfig} from '../instance-store.js';
import {handle} from './instances.js';
import {desktopCommanderEntry,packageRoot} from '../runtime-paths.js';

const version='0.11.0';
const strings=['instance','port','lines','expires','issuer','resource','resource-aliases','client-id','subject','subjects','registration','token-auth','callback','revision','patch','file','output','name','target','mode','app-parent-pid'];
const booleans=['help','version','json','write','code','read','yes','foreground','follow','archived','all','effective','link','allow-loopback-http','token-stdin','no-open','token'];
const options:Record<string,{type:'string'|'boolean';short?:string}>={};
for(const k of strings)options[k]={type:'string',...(k==='instance'?{short:'i'}:{})};
for(const k of booleans)options[k]={type:'boolean',...(k==='yes'?{short:'y'}:k==='follow'?{short:'f'}:k==='help'?{short:'h'}:k==='version'?{short:'v'}:{})};
let parsed:ReturnType<typeof parseArgs>;
try{parsed=parseArgs({args:process.argv.slice(2),options,allowPositionals:true,strict:true});}catch(error){process.stderr.write((error instanceof Error?error.message:String(error))+'\n');process.exit(1);}
const flags=parsed.values;const positional=parsed.positionals;const command=positional.shift()??'help';
const string=(key:string)=>typeof flags[key]==='string'?flags[key] as string:undefined;
const yes=()=>flags.yes===true;const json=flags.json===true;
const print=(value:unknown)=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
function fail(message:string):never{throw Error(message);}
const absolute=(value:string)=>path.resolve(value==='~'?homedir():value.startsWith('~/')?path.join(homedir(),value.slice(2)):value);
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

function help(){
  const topic=command==='help'?positional[0]:command;
  const sections:Record<string,string>={
    up:'up [path] [--read | --write | --code] [-y] [--port N] [--foreground]\n  Initialize and start. First use defaults to CWD; later starts reuse saved settings.',
    init:'init [path] [--read | --write | --code] [-y] [--port N]\n  Save settings without starting. --write and --code enable full account coding permissions.',
    auth:'auth\n  auth key "Client name" [--expires 30d]\n  auth mode ingress|api-key|oauth\n  auth revoke ID\n  auth oauth init-keycloak --resource URL --callback URL\n  auth oauth setup --issuer URL --resource URL --client-id ID --subject USER_ID\n  auth oauth doctor',
    config:'config show|path|edit|validate|diff|apply|schema|recover\n  config import FILE [-i NAME] [--link] [-y]\n  config copy NEW_NAME -i SOURCE\n  config rename NEW_NAME -i SOURCE\n  config default NAME\n  config archive|restore -i NAME\n  config export --output FILE\n  config relink --file FILE | manage\n  config save --file FILE --revision REV\n  config patch --patch JSON --revision REV [-y]\n  config secret set|remove NAME',
    dashboard:'dashboard [--no-open | --token]\n  Open the local Access console. --no-open prints a private login link.',
    verify:'verify [--token-stdin]\n  Test MCP initialization and a directory read. Authenticated instances use STARMUX_TOKEN or stdin.',
    doctor:'doctor\n  Check Node, bundled dependencies, workspace, configuration, port and authentication.',
    logs:'logs [-f | --follow] [--lines 1..200]\n  Follow continues across restarts. Ctrl+C exits the follower only.',
    migrate:'migrate [registry|setup|live] [-y]\n  No source: preview. Select a source to migrate, retaining originals.',
    status:'status [--all]\n  Show the selected instance, its actual endpoint and Dashboard.',
    ls:'ls [--archived]\n  List local instances.',
    down:'down (alias: stop)\n  Stop the selected instance.'
  };
  process.stdout.write(`Starmux ${version}\n\n${sections[topic??'']??'Connect AI clients to your computer’s files and development tools.\n\n  starmux up [path] [--code]   Start in the background\n  starmux init [path]         Save settings\n  starmux status              Show local endpoints\n  starmux verify | doctor     Check tools or environment\n  starmux logs [-f]           Read logs\n  starmux down                Stop\n  starmux auth                Manage client access\n  starmux dashboard           Open local Access console\n  starmux ls                  List instances\n  starmux config              Advanced configuration\n  starmux migrate             Import an old installation'}\n\nGlobal: -i, --instance NAME_OR_ID   --json   -h, --help\nUse starmux COMMAND --help for details.\nDocumentation: ${path.join(packageRoot,'docs','README.md')}\n`);
}
async function confirm(message:string){
  if(yes())return;
  if(!process.stdin.isTTY)fail(message+' Re-run with -y to confirm.');
  const rl=createInterface({input:process.stdin,output:process.stderr});
  try{if(!/^y(es)?$/i.test((await rl.question(message+' [y/N] ')).trim()))fail('Cancelled.');}finally{rl.close();}
}
async function consent(instance:Instance|undefined,config:InstanceConfig){
  if(config.accessRole!=='trusted'||config.writeScope!=='unrestricted')return;
  if(instance&&await exists(path.join(instancePaths(instance).state,'coding-consent.json'))){
    const record=JSON.parse(await readTrusted(path.join(instancePaths(instance).state,'coding-consent.json'))) as {version?:number;scope?:string};
    if(record.version===1&&record.scope==='os-account')return;
  }
  await confirm('Coding mode can modify files accessible to your OS account and execute Shell and Git. Enable?');
}
async function rememberConsent(instance:Instance,config:InstanceConfig){
  if(config.accessRole==='trusted'&&config.writeScope==='unrestricted'&&!await exists(path.join(instancePaths(instance).state,'coding-consent.json')))await atomicPrivate(path.join(instancePaths(instance).state,'coding-consent.json'),JSON.stringify({version:1,scope:'os-account',approvedAt:new Date().toISOString()}));
}
async function selected(){return resolveInstance(string('instance'));}
async function configure(){
  if(positional.length>1)fail('Usage: starmux '+command+' [path]');
  const registry=await readRegistry();let instance:Instance|undefined;
  const selector=string('instance');
  if(selector)instance=registry.instances.find(i=>i.id===selector||i.name===selector);
  else if(registry.instances.length)instance=await resolveInstance();
  if(instance?.archived)fail('Instance is archived. Use starmux config restore -i '+instance.name);
  if(!instance&&await exists(path.join(homedir(),'.config','mac-mcp-gateway'))&&!registry.instances.length)fail('Existing installation found. Run starmux migrate first.');
  const loaded=instance?await loadInstanceConfig(instance):undefined;
  const writing=flags.write||flags.code;
  if(flags.read&&writing)fail('--read cannot be combined with --write or --code.');
  const project=positional[0]??loaded?.config.projectRoot??process.cwd();
  const config=await validateConfig(instanceConfigSchema.parse({...loaded?.config,
    projectRoot:await realpath(absolute(project)),schemaVersion:1,
    port:string('port')?Number(string('port')):loaded?.config.port??(selector?await suggestPort():18893),
    ...(writing?{accessRole:'trusted',mode:'read-write',writeScope:'unrestricted'}:{}),
    ...(flags.read?{accessRole:'restricted',mode:'read-only',writeScope:'unrestricted',gitMode:'off',worktreeMode:'off',upstreams:[]}:{}),
  }));
  await consent(instance,config);
  if(!instance)instance=await createInstance(selector??'default',{config});
  else if(JSON.stringify(config)!==JSON.stringify(loaded!.config))await patchInstanceConfig(instance,config,loaded!.revision);
  await rememberConsent(instance,config);return instance;
}
async function show(instance:Instance){
  const status=await instanceStatus(instance);
  if(json){print(status);return;}
  const config=status.phase==='running'?status.active?.config:(await loadInstanceConfig(instance).catch(()=>null))?.config;
  process.stdout.write(`\nStarmux · ${instance.name} · ${status.phase}\nWorkspace  ${config?.projectRoot??'Unavailable'}\nMode       ${config?.accessRole==='trusted'?(config.writeScope==='home-only'?'Coding (Home sandbox)':'Coding (OS account)'):config?.mode==='read-write'?'File writes (restricted)':'Read-only'}\nRuntime    ${status.executionMode}\n`);
  if(status.port&&status.phase==='running')process.stdout.write(`MCP        http://127.0.0.1:${status.port}/mcp\nDashboard  http://127.0.0.1:${status.port}/access\n`);
  if(status.configProblem||status.runtimeProblem)process.stdout.write(`Problem    ${status.configProblem??status.runtimeProblem}\n`);
  process.stdout.write(`Logs       starmux logs -f -i ${JSON.stringify(instance.name)}\n`);
}
async function start(instance:Instance){
  const state=await instanceStatus(instance);
  if(state.phase==='running'){
    if(state.configState==='pending')await instanceRequest(instance,'apply',(await loadInstanceConfig(instance)).revision);
    await show(instance);return;
  }
  await ensureAccessReady(instance);
  const config=(await loadInstanceConfig(instance)).config;
  if(!await availablePort(config.port))fail(`Port ${config.port} is in use. Choose another with starmux up --port PORT.`);
  if(flags.foreground||string('app-parent-pid')){
    await runInstance(instance,{json,...(string('app-parent-pid')?{appParentPid:Number(string('app-parent-pid'))}:{})});return;
  }
  const log=path.join(instancePaths(instance).logs,'supervisor.log');
  if(await exists(log))await readTrusted(log,true,32*1024*1024);
  const fd=await open(log,'a',0o600);
  const child=spawn(process.execPath,[fileURLToPath(new URL('./starmux-supervisor.js',import.meta.url)),instance.id],{detached:true,stdio:['ignore',fd.fd,fd.fd],env:process.env,windowsHide:true});
  let launchError:Error|undefined;child.once('error',e=>{launchError=e;});await fd.close();child.unref();
  for(let n=0;n<150;n++){
    if(launchError)throw launchError;
    const status=await instanceStatus(instance);
    if(status.phase==='running'&&status.health==='ok'){await show(instance);return;}
    if(child.exitCode!==null||child.signalCode!==null)fail('Startup failed. Inspect '+log);
    await pause(200);
  }
  child.kill('SIGTERM');fail('Startup timed out. Inspect '+log);
}
async function bearer(){
  if(!flags['token-stdin'])return process.env.STARMUX_TOKEN;
  let value='';for await(const part of process.stdin){value+=String(part);if(value.length>16384)fail('Token input too large.');}return value.trim();
}
async function verify(instance:Instance){
  const status=await instanceStatus(instance);if(status.phase!=='running'||!status.port)fail('Start this instance with starmux up first.');
  const token=await bearer();const client=new Client({name:'starmux-verify',version});
  const transport=new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${status.port}/mcp`),{requestInit:{headers:token?{Authorization:'Bearer '+token}:{}}});
  try{await client.connect(transport as Transport);await client.listTools();const result=await client.callTool({name:'list_directory',arguments:{path:'.',depth:0}});if(result.isError)fail('Directory read failed.');}
  catch(e){throw Error('Verification failed: '+String(e)+'. For authenticated instances provide STARMUX_TOKEN or --token-stdin.');}
  finally{await client.close();}
  if(json)print({result:'PASS',instanceId:instance.id,port:status.port,remoteClientVerified:false});else process.stdout.write('PASS · MCP handshake, tool discovery and workspace read.\n');
}
function expires(value:string|undefined){
  if(!value)return null;
  const match=/^([1-9]\d*)([mhdw])$/.exec(value);
  const date=match?new Date(Date.now()+Number(match[1])*({m:60000,h:3600000,d:86400000,w:604800000}[match[2]!]??0)):new Date(value);
  if(!Number.isFinite(date.getTime())||date.getTime()<=Date.now())fail('Expiry must be a future ISO timestamp or positive duration such as 30d.');
  return date.toISOString();
}
async function auth(instance:Instance){
  const access=await createAccessControl(instancePaths(instance).access);const op=positional[0];
  if(!op){const state=await access.snapshot();if(json)print(state);else{process.stdout.write(`Authentication: ${state.mode}\n`);for(const c of state.credentials)process.stdout.write(`${c.id}  ${c.name}  ${c.status}\n`);for(const c of state.oauthConnections)process.stdout.write(`${c.id}  OAuth ${c.clientId}  ${c.revokedAt?'revoked':'active'}\n`);}return;}
  if(op==='key'){
    const result=await access.create(positional[1]??'',expires(string('expires')),true);
    await changeRegistry(async r=>{r.instances.find(i=>i.id===instance.id)!.requiredAccess='api-key';});
    if(json)print({...result,mode:'api-key'});else process.stdout.write(`API key enabled for ${result.name}\nID: ${result.id}\n\n${result.key}\n\nCopy this key now; it is shown once.\n`);return;
  }
  if(op==='mode'){
    const mode=positional[1];if(mode!=='ingress'&&mode!=='api-key'&&mode!=='oauth')fail('Choose ingress, api-key or oauth.');
    await access.setMode(mode);await changeRegistry(async r=>{r.instances.find(i=>i.id===instance.id)!.requiredAccess=mode;});
    if(json)print(await access.snapshot());else process.stdout.write('Authentication: '+mode+'\n');return;
  }
  if(op==='revoke'){
    const id=positional[1]??'';const state=await access.snapshot();
    if(state.credentials.some(c=>c.id===id))await access.revoke(id);
    else if(state.oauthConnections.some(c=>c.id===id))await access.revokeOAuth(id);else fail('Credential or OAuth session not found: '+id);
    if(json)print({result:'REVOKED',id});else process.stdout.write('Revoked '+id+'\n');return;
  }
  if(op==='oauth'){
    process.env.MAC_MCP_ACCESS_FILE=instancePaths(instance).access;
    const action=positional[1]??'status';const map:Record<string,string>={'init-keycloak':'keycloak-realm',setup:'configure',doctor:'doctor',status:'status'};
    if(!map[action])fail('Unknown OAuth command. See starmux auth --help.');
    const args=[map[action]!];for(const key of ['issuer','resource','resource-aliases','client-id','subject','subjects','registration','token-auth','callback','allow-loopback-http'])if(flags[key]!==undefined)args.push('--'+(key==='subject'?'subjects':key),...(typeof flags[key]==='string'?[flags[key] as string]:[]));
    if(json)args.push('--json');await (await import('./oauth.js')).oauthCommand(args);return;
  }
  fail('Unknown auth command. See starmux auth --help.');
}
async function dashboard(instance:Instance){
  const access=await createAccessControl(instancePaths(instance).access);const token=await access.ownerToken();
  if(flags.token){if(json)print({token});else process.stdout.write(token+'\n');return;}
  const status=await instanceStatus(instance);if(status.phase!=='running'||!status.port)fail('Start this instance with starmux up first.');
  const url=`http://127.0.0.1:${status.port}/access#token=${token}`;
  if(flags['no-open']){if(json)print({url});else process.stdout.write(url+'\n');return;}
  const executable=process.platform==='darwin'?'open':process.platform==='win32'?'rundll32.exe':'xdg-open';
  const child=spawn(executable,process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url],{stdio:'ignore'});
  await new Promise<void>((resolve,reject)=>{child.once('error',()=>reject(Error('Browser unavailable. Use starmux dashboard --no-open.')));child.once('exit',code=>code===0?resolve():reject(Error('Browser failed. Use starmux dashboard --no-open.')));});
  if(json)print({result:'OPENED'});else process.stdout.write('Opened local Access console.\n');
}
async function logs(instance:Instance){
  const count=Number(string('lines')??60);if(!Number.isInteger(count)||count<1||count>200)fail('--lines must be 1..200.');
  const file=path.join(instancePaths(instance).logs,'core.log');let offset=0;
  if(await exists(file)){const text=await readTrusted(file,true,32*1024*1024);offset=Buffer.byteLength(text);const output=text.split('\n').slice(-count).join('\n');if(json)print({instanceId:instance.id,output});else process.stdout.write(output);}
  if(!flags.follow)return;
  let done=false;const stop=()=>{done=true;};process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{while(!done){await pause(300);if(!await exists(file))continue;const size=(await stat(file)).size;if(size<offset)offset=0;if(size===offset)continue;const f=await open(file,'r');try{const buffer=Buffer.alloc(Math.min(size-offset,65536));const {bytesRead}=await f.read(buffer,0,buffer.length,offset);offset+=bytesRead;const output=buffer.subarray(0,bytesRead).toString();if(json)print({instanceId:instance.id,output});else process.stdout.write(output);}finally{await f.close();}}}finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
async function configCommand(){
  const op=positional[0]??'show';const selector=string('instance');
  if(op==='import'){
    const file=positional[1];if(!file)fail('config import requires a file.');const config=await validateConfig(parseConfig(await readTrusted(absolute(file),false)));await consent(undefined,config);
    const instance=await createInstance(selector??string('name')??path.basename(file,path.extname(file)),{file:absolute(file),link:flags.link===true});await rememberConsent(instance,config);print({instance});return;
  }
  if(['copy','rename','default','archive','restore'].includes(op)){
    const target=op==='default'?positional[1]:selector??(await selected()).id;
    const args=[op,target??''];if(op==='copy'||op==='rename')args.push(positional[1]??'');if(json)args.push('--json');await handle('instance',args);return;
  }
  const instance=await selected();
  if(op==='save'){
    let text=string('file')?await readTrusted(absolute(string('file')!),false):'';
    if(!string('file'))for await(const part of process.stdin){text+=String(part);if(text.length>262144)fail('Config input too large.');}
    const config=await validateConfig(parseConfig(text));await consent(instance,config);
    const saved=await saveInstanceConfig(instance,text,string('revision')??'');await rememberConsent(instance,config);print({result:'SAVED',revision:saved.revision});return;
  }
  if(op==='patch'&&!string('patch')){
    let text='';for await(const part of process.stdin){text+=String(part);if(text.length>262144)fail('Config input too large.');}flags.patch=text;
  }
  if(op==='apply'||op==='patch'){
    let config=(await loadInstanceConfig(instance)).config;
    if(op==='patch'&&string('patch'))config=await validateConfig(instanceConfigSchema.parse({...config,...JSON.parse(string('patch')!)}));
    await consent(instance,config);await rememberConsent(instance,config);
  }
  const args=[...positional,'--instance',instance.id];
  for(const [key,value] of Object.entries(flags))if(!['instance','help','yes'].includes(key)&&value!==undefined)args.push('--'+key,...(typeof value==='string'?[value]:[]));
  // The shared operation layer retains its internal approval contract.
  if(op==='patch')args.push('--approve-trusted-developer','--approve-unrestricted');
  await handle('config',args);
}
async function main(){
  if(flags.version){process.stdout.write(version+'\n');return;}
  if(command==='help'||flags.help){help();return;}
  const allowed:Record<string,string[]>={
    up:['port','read','write','code','yes','foreground','app-parent-pid'],init:['port','read','write','code','yes'],
    status:['all'],ls:['archived'],down:[],stop:[],logs:['lines','follow'],doctor:[],verify:['token-stdin'],dashboard:['token','no-open'],migrate:['yes'],
    auth:['expires','issuer','resource','resource-aliases','client-id','subject','subjects','registration','token-auth','callback','allow-loopback-http'],
    config:['yes','archived','effective','link','name','revision','patch','file','output'],permissions:['target','mode'],privacy:['all','target']
  };
  for(const key of Object.keys(flags))if(!['instance','json','help','version'].includes(key)&&!allowed[command]?.includes(key))fail('Option --'+key+' is not supported by '+command+'.');
  if(['status','ls','down','stop','logs','doctor','verify','dashboard'].includes(command)&&positional.length)fail('Unexpected argument: '+positional[0]);
  if(command==='auth'&&['key','mode','revoke'].includes(positional[0]??'')&&positional.length!==2)fail('Usage: starmux auth '+positional[0]+' VALUE');
  if(command==='migrate'&&positional.length>1)fail('Usage: starmux migrate [registry|setup|live] [-y]');
  // Public commands never inherit old environment overlays. Core's private protocol is retained.
  for(const key of Object.keys(process.env))if(key.startsWith('MAC_MCP_'))delete process.env[key];
  for(const [key,value] of Object.entries(process.env))if(key.startsWith('STARMUX_')&&key!=='STARMUX_TOKEN')process.env['MAC_MCP_'+key.slice(8)]=value;
  if(command==='up'||command==='init'){
    const instance=await configure();if(command==='up')await start(instance);else if(json)print({result:'SAVED',instance});else process.stdout.write(`Saved ${instance.name}. Start with starmux up -i ${JSON.stringify(instance.name)}\n`);return;
  }
  if(command==='migrate'){await (await import('../starmux-migration.js')).migrate(positional[0],yes(),json);return;}
  if(command==='ls'||command==='status'&&flags.all){await handle('instance',['list',...(flags.archived?['--archived']:[]),...(json?['--json']:[])]);return;}
  if(command==='config'){await configCommand();return;}
  if(!['status','down','stop','auth','dashboard','verify','doctor','logs','permissions','privacy'].includes(command))fail('Unknown command: '+command+'. Run starmux --help.');
  if(!(await readRegistry()).instances.length){if(command==='status'||command==='down'||command==='stop'){if(json)print({phase:'stopped',initialized:false});else process.stdout.write('Not initialized. Run starmux up in your project.\n');return;}}
  const instance=await selected();
  if(command==='status')await show(instance);
  else if(command==='down'||command==='stop'){await instanceRequest(instance,'stop');if(json)print({result:'STOPPED',instanceId:instance.id});else process.stdout.write('Stopped '+instance.name+'\n');}
  else if(command==='auth')await auth(instance);
  else if(command==='dashboard')await dashboard(instance);
  else if(command==='verify')await verify(instance);
  else if(command==='logs')await logs(instance);
  else if(command==='doctor'){
    if(Number(process.versions.node.split('.')[0])<22||(process.versions.node.startsWith('22.')&&Number(process.versions.node.split('.')[1])<12))fail('Node 22.12 or newer is required.');
    await stat(desktopCommanderEntry);const loaded=await loadInstanceConfig(instance);await ensureAccessReady(instance);const state=await instanceStatus(instance);
    if(state.phase!=='running'&&!await availablePort(loaded.config.port))fail('Configured port is in use: '+loaded.config.port);
    if(json)print({result:'PASS',node:process.version,instanceId:instance.id,configState:state.configState});else process.stdout.write('PASS · Node, dependencies, workspace, configuration, port and authentication.\n');
  }else{
    const args=[...positional,'--instance',instance.id];for(const [key,value] of Object.entries(flags))if(key!=='instance'&&value!==undefined)args.push('--'+key,...(typeof value==='string'?[value]:[]));await handle(command,args);
  }
}
try{await main();}catch(error){const message=error instanceof Error?error.message:String(error);if(json)print({schemaVersion:1,error:message});else process.stderr.write(message+'\n');process.exitCode=1;}
