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
import {atomicPrivate,availablePort,changeRegistry,configJSONSchema,createInstance,ensureAccessReady,exists,instanceConfigSchema,instancePaths,loadInstanceConfig,parseConfig,patchInstanceConfig,readRegistry,readTrusted,resolveInstance,saveInstanceConfig,suggestPort,validateConfig,usesGlobalPermissions,type Instance,type InstanceConfig} from '../instance-store.js';
import {handle} from './instances.js';
import {packageRoot,desktopCommanderEntry} from '../runtime-paths.js';
import {shellQuote} from '../platform.js';
import {formatStarmuxStatus} from './starmux-status.js';

const {version}=JSON.parse(await readFile(path.join(packageRoot,'package.json'),'utf8')) as {version:string};
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
  const requested=command==='help'?positional[0]:command;
  const topic=requested==='stop'?'down':requested;
  const sections:Record<string,string>={
    up:'up [path] [--read | --write | --code] [-y] [--port N] [--foreground]\n  Initialize and start. First use defaults to CWD; later starts reuse saved settings.',
    init:'init [path] [--read | --write | --code] [-y] [--port N]\n  Save settings without starting. --write and --code enable full account coding permissions.',
    auth:'auth\n  auth key "Client name" [--expires 30d]\n  auth mode none|ingress|api-key|oauth\n  auth revoke ID\n  auth oauth init-keycloak --resource URL --callback URL\n  auth oauth setup --issuer URL --resource URL --client-id ID --subject USER_ID\n  auth oauth doctor',
    config:'config [show] [--effective]\n  config edit | diff | apply | validate | path | schema | recover\n  config default NAME | rename NEW_NAME -i SOURCE | copy NEW_NAME -i SOURCE\n  config archive -i NAME | restore -i NAME | import FILE [-i NAME] [--link]\n  config export [--output FILE] | secret set|remove NAME',
    dashboard:'dashboard [--no-open | --token]\n  Open the local Access console. --no-open prints a private login link.',
    verify:'verify [--token-stdin]\n  Test MCP initialization, tool discovery and workspace read. Authenticated instances use STARMUX_TOKEN or stdin.',
    doctor:'doctor\n  Check Node, bundled dependencies, workspace, configuration, port and authentication.',
    logs:'logs [-f | --follow] [--lines 1..200]\n  Follow continues across restarts. Ctrl+C exits the follower only.',
    status:'status [--all]\n  Show the selected instance, its actual endpoint and connection guide.',
    ls:'ls [--archived]\n  List local workspace instances.',
    rm:'rm [NAME] (alias for: config archive)\n  Stop and archive an instance.',
    down:'down (alias: stop)\n  Stop the selected instance.',
    permissions:'permissions [status]\n  Show the selected instance’s mode. Switch with up --read or up --code.',
    privacy:'privacy [--all] [--target PATH]\n  Check privacy access through the running instance.'
  };
  if(topic&&topic!=='help'&&!sections[topic])fail('Unknown command: '+topic+'. Run starmux --help.');
  const overview=[
    'Connect AI clients to your computer’s files, shell and development tools.',
    '',
    'Workspace Lifecycle:',
    '  starmux up [path] [--code]   Start in the background (default: Read-only)',
    '  starmux down                 Stop the running instance (alias: stop)',
    '  starmux status               Show health, endpoint and connection guide',
    '  starmux logs [-f]            View or stream gateway logs',
    '',
    'Access & Verification:',
    '  starmux auth                 Manage auth mode, API keys and OAuth',
    '  starmux dashboard            Open the local Web Access Console',
    '  starmux verify               Test local MCP handshake and workspace read',
    '  starmux doctor               Check runtime, config, port and auth state',
    '',
    'Multi-Instance & Config:',
    '  starmux ls                   List workspace instances',
    '  starmux rm [name]            Stop and archive an instance',
    '  starmux init [path]          Save instance settings without starting',
    '  starmux config               Inspect, edit or apply configuration'
  ].join('\n');
  process.stdout.write(`Starmux ${version}\n\n${sections[topic??'']??overview}\n\nGlobal: -i, --instance NAME_OR_ID   --json   -h, --help\nUse starmux COMMAND --help for details.\n`);
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
async function isDefaultInstance(instance:Instance){
  const registry=await readRegistry().catch(()=>({defaultInstanceId:null,instances:[] as Instance[]}));
  return instance.name==='default'&&(registry.defaultInstanceId===instance.id||registry.instances.filter(i=>!i.archived).length<=1);
}
async function instanceFlag(instance:Instance){
  if(await isDefaultInstance(instance))return '';
  const selector=/^[A-Za-z0-9_.-]+$/.test(instance.name)&&!instance.name.startsWith('-')?instance.name:shellQuote(instance.name);
  return instance.name.startsWith('-')?`--instance=${selector}`:`-i ${selector}`;
}
async function show(instance:Instance){
  const status=await instanceStatus(instance);
  if(json){print(status);return;}
  const config=status.phase==='running'?status.active?.config:(await loadInstanceConfig(instance).catch(()=>null))?.config;
  process.stdout.write(await formatStarmuxStatus(instance,status,config,{isDefault:await isDefaultInstance(instance)}));
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
    await runInstance(instance,{json,...(!json?{onReady:()=>show(instance)}:{}),...(string('app-parent-pid')?{appParentPid:Number(string('app-parent-pid'))}:{})});return;
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
  const endpoint=`http://127.0.0.1:${status.port}/mcp`;
  const transport=new StreamableHTTPClientTransport(new URL(endpoint),{requestInit:{headers:token?{Authorization:'Bearer '+token}:{}}});
  let toolCount=0;
  try{
    await client.connect(transport as Transport);
    const listed=await client.listTools();toolCount=listed.tools.length;
    const result=await client.callTool({name:'list_directory',arguments:{path:'.',depth:0}});
    if(result.isError)fail('Directory read failed.');
  }
  catch(e){throw Error('Verification failed: '+String(e)+'. For authenticated instances provide STARMUX_TOKEN or --token-stdin.');}
  finally{await client.close();}
  if(json)print({result:'PASS',instanceId:instance.id,port:status.port,remoteClientVerified:false});
  else{
    const cfg=status.active?.config;
    const mode=cfg?.accessRole==='trusted'?'Coding mode':'Read-only mode';
    const root=cfg?.projectRoot??'.';
    process.stdout.write(
      `✓ MCP handshake      ${endpoint}\n`+
      `✓ Tool discovery     ${toolCount} tools available (${mode})\n`+
      `✓ Workspace read     ${root}\n`+
      `PASS · MCP handshake, tool discovery and workspace read.\n`
    );
  }
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
  if(!op){
    const state=await access.snapshot();
    if(json){print(state);return;}
    const flag=await instanceFlag(instance);
    const cmd=(action:string)=>`starmux ${action}${flag?' '+flag:''}`;
    const activeKeys=state.credentials.filter(c=>c.status==='active').length;
    const modeDesc=state.mode==='ingress'
      ?'None (no Starmux token · local or ingress proxy)'
      :state.mode==='api-key'
      ?`API key (Bearer token · ${activeKeys} active)`
      :'OAuth (browser sign-in)';
    const lines=[
      ...(flag?[`Instance       ${instance.name}`]:[]),
      `Auth mode      ${modeDesc}`,
      `API keys       ${activeKeys} active (${state.credentials.length} total)`,
      `OAuth          ${state.oauth?`${state.oauth.issuer} (${state.oauthConnections.filter(c=>!c.revokedAt).length} active sessions)`:'Not configured'}`
    ];
    if(state.credentials.length){
      lines.push('','API Keys');
      for(const c of state.credentials){
        const exp=c.expiresAt?`  expires ${c.expiresAt.slice(0,10)}`:'';
        lines.push(`  ${c.id.padEnd(26)}  ${c.name.padEnd(20)}  ${c.status}${exp}`);
      }
    }
    if(state.oauthConnections.length){
      lines.push('','OAuth Sessions');
      for(const c of state.oauthConnections){
        lines.push(`  ${c.id.padEnd(26)}  OAuth ${c.clientId.padEnd(14)}  ${c.revokedAt?'revoked':'active'}`);
      }
    }
    lines.push(
      '',
      'Commands',
      `  Create API key   ${cmd('auth key "My AI Client"')}`,
      `  Switch mode      ${cmd('auth mode <none|api-key|oauth>')}`,
      ...(activeKeys>0||state.oauthConnections.some(c=>!c.revokedAt)?[`  Revoke access    ${cmd('auth revoke <ID>')}`]:[])
    );
    process.stdout.write(lines.join('\n')+'\n');
    return;
  }
  if(op==='key'){
    const result=await access.create(positional[1]??'',expires(string('expires')),true);
    await changeRegistry(async r=>{r.instances.find(i=>i.id===instance.id)!.requiredAccess='api-key';});
    if(json){print({...result,mode:'api-key'});return;}
    const cfg=(await loadInstanceConfig(instance).catch(()=>null))?.config;
    const port=cfg?.port??18893;
    process.stdout.write(
      `API key enabled for ${result.name} (ID: ${result.id})\n`+
      `Copy this key now; it is shown only once:\n\n`+
      `  ${result.key}\n\n`+
      `Option A — Fill in AI client form UI:\n`+
      `  Transport       Streamable HTTP\n`+
      `  URL (Local)     http://127.0.0.1:${port}/mcp\n`+
      `  URL (Remote)    https://<your-domain-or-tunnel>/mcp\n`+
      `  Authentication  Bearer API key\n`+
      `  Header          Authorization: Bearer ${result.key}\n\n`+
      `Option B — Or paste JSON config (mcpServers):\n`+
      `  {\n`+
      `    "mcpServers": {\n`+
      `      "starmux": {\n`+
      `        "type": "streamable-http",\n`+
      `        "url": "https://<your-domain-or-tunnel>/mcp",\n`+
      `        "headers": {\n`+
      `          "Authorization": "Bearer ${result.key}"\n`+
      `        }\n`+
      `      }\n`+
      `    }\n`+
      `  }\n`
    );
    return;
  }
  if(op==='mode'){
    const raw=positional[1];
    const mode=raw==='none'?'ingress':raw;
    if(mode!=='ingress'&&mode!=='api-key'&&mode!=='oauth')fail('Choose none (or ingress), api-key or oauth.');
    await access.setMode(mode);await changeRegistry(async r=>{r.instances.find(i=>i.id===instance.id)!.requiredAccess=mode;});
    const label=mode==='ingress'?'none (ingress)':mode;
    if(json)print(await access.snapshot());else process.stdout.write('Authentication: '+label+'\n');return;
  }
  if(op==='revoke'){
    const id=positional[1]??'';const state=await access.snapshot();
    if(state.credentials.some(c=>c.id===id))await access.revoke(id);
    else if(state.oauthConnections.some(c=>c.id===id))await access.revokeOAuth(id);else fail('Credential or OAuth session not found: '+id);
    if(json)print({result:'REVOKED',id});else process.stdout.write('Revoked '+id+'\n');return;
  }
  if(op==='oauth'){
    process.env.STARMUX_ACCESS_FILE=instancePaths(instance).access;
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
  const text=await exists(file)?await readTrusted(file,true,32*1024*1024):'';offset=Buffer.byteLength(text);
  const lines=text.split('\n');if(text.endsWith('\n'))lines.pop();
  const output=lines.slice(-count).join('\n')+(text.endsWith('\n')?'\n':'');
  if(json)print({instanceId:instance.id,output});else process.stdout.write(output||'No logs yet.\n');
  if(!flags.follow)return;
  let done=false;const stop=()=>{done=true;};process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{while(!done){await pause(300);if(!await exists(file))continue;const size=(await stat(file)).size;if(size<offset)offset=0;if(size===offset)continue;const f=await open(file,'r');try{const buffer=Buffer.alloc(Math.min(size-offset,65536));const {bytesRead}=await f.read(buffer,0,buffer.length,offset);offset+=bytesRead;const output=buffer.subarray(0,bytesRead).toString();if(json)print({instanceId:instance.id,output});else process.stdout.write(output);}finally{await f.close();}}}finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
async function configCommand(){
  const op=positional[0]??'show';const selector=string('instance');
  if(op==='schema'){print(configJSONSchema());return;}
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
function validateSubcommand(){
  if(command!=='config'&&command!=='auth')return;
  const op=positional[0]??(command==='config'?'show':'');
  let name=command+(op?' '+op:'');let count=positional.length-(positional.length?1:0);
  let minimum=0;let maximum=0;let supported:string[]|undefined;
  if(command==='config'){
    const commands:Record<string,string[]>={show:['effective'],path:[],edit:[],validate:[],diff:[],apply:['revision','yes'],schema:[],recover:[],
      import:['name','link','yes'],copy:[],rename:[],default:[],archive:[],restore:[],export:['output'],relink:['file'],manage:[],
      save:['file','revision','yes'],patch:['patch','revision','yes'],secret:[]};
    supported=commands[op];
    if(['import','copy','rename','default'].includes(op))minimum=maximum=1;
    if(op==='relink'){minimum=string('file')?0:1;maximum=minimum;}
    if(op==='secret'){minimum=maximum=2;if(!['set','remove'].includes(positional[1]??''))fail('Usage: starmux config secret set|remove NAME');}
  }else if(op==='oauth'){
    const action=positional[1]??'status';name+=' '+action;count=Math.max(0,positional.length-2);
    const actions:Record<string,string[]>={status:[],doctor:[],
      'init-keycloak':['resource','callback','allow-loopback-http'],
      setup:['issuer','resource','resource-aliases','client-id','subject','subjects','registration','token-auth','allow-loopback-http']};
    supported=actions[action];
    if(flags.subject!==undefined&&flags.subjects!==undefined)fail('Use either --subject or --subjects.');
  }else{
    const commands:Record<string,string[]>={'':[],key:['expires'],mode:[],revoke:[]};supported=commands[op];
    if(['key','mode','revoke'].includes(op))minimum=maximum=1;
  }
  if(!supported)fail('Unknown command: '+name+'. See starmux '+command+' --help.');
  if(count<minimum||count>maximum||positional.slice(1).some(value=>!value.trim()))fail('Invalid arguments for starmux '+name+'. See starmux '+command+' --help.');
  for(const key of Object.keys(flags))if(!['instance','json','help','version'].includes(key)&&!supported.includes(key))fail('Option --'+key+' is not supported by '+name+'.');
}
async function main(){
  if(flags.version){process.stdout.write(version+'\n');return;}
  if(command==='help'||flags.help){help();return;}
  const allowed:Record<string,string[]>={
    up:['port','read','write','code','yes','foreground','app-parent-pid'],init:['port','read','write','code','yes'],
    status:['all'],ls:['archived'],rm:[],down:[],stop:[],logs:['lines','follow'],doctor:[],verify:['token-stdin'],dashboard:['token','no-open'],
    auth:['expires','issuer','resource','resource-aliases','client-id','subject','subjects','registration','token-auth','callback','allow-loopback-http'],
    config:['yes','archived','effective','link','name','revision','patch','file','output'],permissions:['target','mode'],privacy:['all','target']
  };
  for(const key of Object.keys(flags))if(!['instance','json','help','version'].includes(key)&&!allowed[command]?.includes(key))fail('Option --'+key+' is not supported by '+command+'.');
  if(string('instance')!==undefined&&!string('instance')!.trim())fail('--instance requires a non-empty name or ID.');
  validateSubcommand();
  if(['status','ls','down','stop','logs','doctor','verify','dashboard'].includes(command)&&positional.length)fail('Unexpected argument: '+positional[0]);
  if(command==='rm'&&positional.length>1)fail('Usage: starmux rm [NAME]');
  if(command==='auth'&&['key','mode','revoke'].includes(positional[0]??'')&&positional.length!==2)fail('Usage: starmux auth '+positional[0]+' VALUE');
  if(command==='up'||command==='init'){
    const instance=await configure();
    if(command==='up')await start(instance);
    else if(json)print({result:'SAVED',instance});
    else{
      const flag=await instanceFlag(instance);
      process.stdout.write(`Saved ${instance.name}. Start with starmux up${flag?' '+flag:''}\n`);
    }
    return;
  }
  if(command==='ls'||command==='status'&&flags.all){await handle('instance',['list',...(flags.archived?['--archived']:[]),...(json?['--json']:[])]);return;}
  if(command==='rm'){
    const target=positional[0]??string('instance')??(await selected()).id;
    await handle('instance',['archive',target,...(json?['--json']:[])]);return;
  }
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
    if(json)print({result:'PASS',node:process.version,instanceId:instance.id,configState:state.configState});
    else{
      const isDef=await isDefaultInstance(instance);
      const access=await (await createAccessControl(instancePaths(instance).access,{initialize:false})).snapshot();
      const modeLabel=loaded.config.accessRole==='trusted'?'Coding mode':'Read-only mode';
      const authLabel=access.mode==='ingress'?'None (no token required)':access.mode==='api-key'?`API key (${access.credentials.filter(c=>c.status==='active').length} active)`:'OAuth';
      const portState=state.phase==='running'?`Running on 127.0.0.1:${state.port}`:`Stopped · port ${loaded.config.port} available`;
      process.stdout.write(
        `✓ Runtime            Node ${process.version} & Desktop Commander engine ready\n`+
        `✓ Service            ${portState}${isDef?'':` (instance: ${instance.name})`}\n`+
        `✓ Workspace          ${loaded.config.projectRoot} (${modeLabel})\n`+
        `✓ Configuration      ${instance.source.path} (${state.configState})\n`+
        `✓ Authentication     ${authLabel}\n`+
        `PASS · Node, dependencies, workspace, configuration, port and authentication.\n`
      );
    }
  }else{
    if(command==='permissions'&&usesGlobalPermissions((await loadInstanceConfig(instance)).config)){
      if(positional.length&&positional[0]!=='status')fail('Directory grants and tool filters do not apply to global modes. Use starmux up --read or starmux up --code.');
      await show(instance);return;
    }
    const args=[...positional,'--instance',instance.id];for(const [key,value] of Object.entries(flags))if(key!=='instance'&&value!==undefined)args.push('--'+key,...(typeof value==='string'?[value]:[]));await handle(command,args);
  }
}
try{await main();}catch(error){const message=error instanceof Error?error.message:String(error);if(json)print({schemaVersion:1,error:message});else process.stderr.write(message+'\n');process.exitCode=1;}
