import {MiddlewareManagement} from '../middleware-management.js';
import {ServerManagement,applySavedGateway} from '../server-management.js';
import {ensureManager,managerStatus,stopManager,startDetachedInstance} from '../dashboard-manager.js';
import {GatewayError} from '../validation.js';
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
import {instanceStatus,instanceRequest,stopInstance,runInstance} from '../instance-runtime.js';
import {atomicPrivate,availablePort,changeRegistry,configJSONSchema,createInstance,ensureAccessReady,exists,instanceConfigSchema,instancePaths,loadInstanceConfig,parseConfig,patchInstanceConfig,readRegistry,readTrusted,resolveInstance,saveInstanceConfig,suggestPort,validateConfig,usesGlobalPermissions,type Instance,type InstanceConfig} from '../instance-store.js';
import {handle} from './instances.js';
import {packageRoot,desktopCommanderEntry} from '../runtime-paths.js';
import {shellQuote} from '../platform.js';
import {formatStarmuxStatus} from './starmux-status.js';
import {readProcessLogTail} from '../process-log.js';
import {trustedFileStat} from '../instance-store.js';

const {version}=JSON.parse(await readFile(path.join(packageRoot,'package.json'),'utf8')) as {version:string};
const strings=['instance','port','lines','expires','issuer','resource','resource-aliases','client-id','subject','subjects','registration','token-auth','callback','revision','patch','file','output','name','target','mode','app-parent-pid','input','page'];
const booleans=['allow-lan','local','no-allow-lan','help','version','json','write','code','read','yes','foreground','follow','archived','all','effective','link','allow-loopback-http','token-stdin','no-open','token','prepare','preview','replace'];
const options:Record<string,{type:'string'|'boolean';short?:string}>={};
for(const k of strings)options[k]={type:'string',...(k==='instance'?{short:'i'}:{})};
for(const k of booleans)options[k]={type:'boolean',...(k==='yes'?{short:'y'}:k==='follow'?{short:'f'}:k==='help'?{short:'h'}:k==='version'?{short:'v'}:{})};
let parsed:ReturnType<typeof parseArgs>;
try{parsed=parseArgs({args:process.argv.slice(2),options,allowPositionals:true,strict:true});}catch(error){process.stderr.write((error instanceof Error?error.message:String(error))+'\n');process.exit(1);}
const flags=parsed.values;const positional=parsed.positionals;const command=positional.shift()??'help';
const string=(key:string)=>typeof flags[key]==='string'?flags[key] as string:undefined;
const yes=()=>flags.yes===true;const json=flags.json===true;
const print=(value:unknown)=>{if(value&&typeof value==='object'&&'application' in value&&value.application==='pending'&&'error' in value)process.exitCode=1;process.stdout.write(JSON.stringify(value,null,2)+'\n');};
function fail(message:string):never{throw Error(message);}
const absolute=(value:string)=>path.resolve(value==='~'?homedir():value.startsWith('~/')?path.join(homedir(),value.slice(2)):value);
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

function help(){
  const requested=command==='help'?positional[0]:command;
  const topic=requested==='stop'?'down':requested;
  const sections:Record<string,string>={
    middleware:'middleware list | add JSON | configure JSON | enable ID | disable ID | remove ID\n  middleware order ID,ID | reload | test --file sample.json\n  Modules run as trusted local code; sample tests do not call upstream tools.',
    server:'server add "COMMAND or URL or JSON" --name ID [--preview] [--prepare]\n  server import FILE [--preview] [--prepare]\n  server list | templates | test ID | enable ID | disable ID | retry ID | refresh ID | remove ID\n  server auth ID login|status|logout\n  --replace explicitly replaces conflicts, preserving existing grants unless allowTools is supplied\n  Test connects or executes the configured program; preview never does.',
    up:'up [path] [--read | --write | --code] [--allow-lan | --local] [-y] [--port N] [--foreground]\n  Initialize and start. First use defaults to CWD; later starts reuse saved settings.',
    init:'init [path] [--read | --write | --code] [--allow-lan | --local] [-y] [--port N]\n  Save settings without starting. --write and --code enable full account coding permissions.',
    auth:'auth\n  auth key "Client name" [--expires 30d]\n  auth mode none|ingress|api-key|oauth\n  auth revoke ID\n  auth oauth init-keycloak --resource URL --callback URL\n  auth oauth setup --issuer URL --resource URL --client-id ID --subject USER_ID\n  auth oauth doctor',
    config:'config [show] [--effective]\n  config edit | diff | apply | validate | path | schema | recover\n  config default NAME | rename NEW_NAME -i SOURCE | copy NEW_NAME -i SOURCE\n  config archive -i NAME | restore -i NAME | import FILE [-i NAME] [--link]\n  config export [--output FILE] | secret set|remove NAME',
    dashboard:'dashboard [--no-open | --token]\n  Open the local management console. status / stop manage the console service. --token prints the legacy instance owner token.',
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
    'An all-in-one MCP server and programmable gateway. Connect and manage your tools in one place.',
    '',
    'Workspace Lifecycle:',
    '  starmux up [path] [--code] [--allow-lan | --local]   Start in the background (default: Read-only)',
    '  starmux down                 Stop the running instance (alias: stop)',
    '  starmux status               Show health, endpoint and connection guide',
    '  starmux logs [-f]            View or stream gateway logs',
    '',
    'Gateway Services & Middleware:',
    '  starmux server              Add, test and manage local or remote MCP servers',
    '  starmux middleware          Configure, test and reload middleware',
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
  process.stdout.write(`Starmux ${version}\n\n${sections[topic??'']??overview}\n\nNetwork (up / init):\n  --allow-lan      Listen on 0.0.0.0 so LAN / Tailscale devices can connect directly to /mcp\n  --local          Listen on 127.0.0.1 only (default; alias: --no-allow-lan)\n\nGlobal: -i, --instance NAME_OR_ID   --json   -h, --help\nUse starmux COMMAND --help for details.\n`);
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
  if(flags['allow-lan']&&(flags.local||flags['no-allow-lan']))throw new GatewayError('CLI_CONFLICTING_NETWORK_FLAGS:Choose either --allow-lan or --local, not both.');
  if(positional.length>1)fail('Usage: starmux '+command+' [path]');
  const registry=await readRegistry();let instance:Instance|undefined;
  const selector=string('instance');
  if(selector)instance=registry.instances.find(i=>i.id===selector||i.name===selector);
  else if(registry.instances.length)instance=await resolveInstance();
  if(instance?.archived)fail('Instance is archived. Use starmux config restore -i '+instance.name);
  if(command==='up'&&instance){
    const state=await instanceStatus(instance);
    if(state.phase!=='running'&&state.phase!=='stopped')fail(`Cannot start ${instance.name}: ${state.runtimeProblem??state.phase}. Run starmux doctor -i ${instance.id}.`);
  }
  const loaded=instance?await loadInstanceConfig(instance):undefined;
  const writing=flags.write||flags.code;
  if(flags.read&&writing)fail('--read cannot be combined with --write or --code.');
  const project=positional[0]??loaded?.config.projectRoot??process.cwd();
  const allowLan=flags['allow-lan']?true:flags.local||flags['no-allow-lan']?false:loaded?.config.allowLan??false;
  const config=await validateConfig(instanceConfigSchema.parse({...loaded?.config,
    projectRoot:await realpath(absolute(project)),schemaVersion:1,
    port:string('port')?Number(string('port')):loaded?.config.port??(selector?await suggestPort(homedir(),allowLan?'0.0.0.0':'127.0.0.1'):18893),
    allowLan,
    ...(writing?{accessRole:'trusted',mode:'read-write',writeScope:'unrestricted'}:{}),
    ...(flags.read?{accessRole:'restricted',mode:'read-only',writeScope:'unrestricted'}:{}),
  }));
  await consent(instance,config);
  if(!instance)instance=await createInstance(selector??'default',{config});
  else if(JSON.stringify(config)!==JSON.stringify(loaded!.config)){
    // Patch only actual changes; parsing defaults must not add advanced fields
    // back into an ordinary config when changing its port/network/mode.
    const patch=Object.fromEntries(Object.entries(config).filter(([key,value])=>
      JSON.stringify(value)!==JSON.stringify(loaded!.config[key as keyof InstanceConfig])));
    await patchInstanceConfig(instance,patch,loaded!.revision);
  }
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
  const config=status.phase==='stopped'?status.saved?.config:status.active?.config;
  process.stdout.write(await formatStarmuxStatus(instance,status,config,{isDefault:await isDefaultInstance(instance)}));
}
async function start(instance:Instance){
  const state=await instanceStatus(instance);
  if(state.phase==='running'){
    if(state.configState==='pending'){
      const applied=await instanceRequest(instance,'apply',(await loadInstanceConfig(instance)).revision);
      if(!applied||applied.phase!=='running')fail('Configuration was not applied: instance changed while starting. Run starmux status.');
    }
    const current=await instanceStatus(instance);
    if(current.phase!=='running'||current.health!=='ok')fail(`Instance is not ready: ${current.runtimeProblem??current.health}. Run starmux doctor -i ${instance.id}.`);
    await show(instance);return;
  }
  if(state.phase!=='stopped')fail(`Cannot start ${instance.name}: ${state.runtimeProblem??state.phase}. Run starmux doctor -i ${instance.id}.`);
  await ensureAccessReady(instance);
  const config=(await loadInstanceConfig(instance)).config;
  if(!await availablePort(config.port,config.allowLan?'0.0.0.0':'127.0.0.1'))fail(`Port ${config.port} is in use. Inspect starmux doctor -i ${instance.id} before changing the port.`);
  if(flags.foreground||string('app-parent-pid')){
    await runInstance(instance,{json,...(!json?{onReady:()=>show(instance)}:{}),...(string('app-parent-pid')?{appParentPid:Number(string('app-parent-pid'))}:{})});return;
  }
  await startDetachedInstance(instance);await show(instance);
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
  const file=path.join(instancePaths(instance).logs,'core.log');
  const tail=await exists(file)?await readProcessLogTail(file):null;
  let offset=tail?.offset??0,identity=tail?.identity??'';const text=tail?.text??'';
  const lines=text.split('\n');if(text.endsWith('\n'))lines.pop();
  const output=lines.slice(-count).join('\n')+(text.endsWith('\n')?'\n':'');
  if(json)print({instanceId:instance.id,output});else process.stdout.write(output||'No logs yet.\n');
  if(!flags.follow)return;
  let done=false;const stop=()=>{done=true;};process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{while(!done){
    await pause(300);
    try{
      const current=await trustedFileStat(file,true,Infinity);
      const nextIdentity=`${current.dev}:${current.ino}`;
      if(nextIdentity!==identity||current.size<offset)offset=0;
      identity=nextIdentity;if(current.size===offset)continue;
      const f=await open(file,'r');
      try{
        const actual=await f.stat();if(`${actual.dev}:${actual.ino}`!==identity)continue;
        const buffer=Buffer.alloc(Math.min(current.size-offset,65536));
        const {bytesRead}=await f.read(buffer,0,buffer.length,offset);offset+=bytesRead;
        const output=buffer.subarray(0,bytesRead).toString();
        if(json)print({instanceId:instance.id,output});else process.stdout.write(output);
      }finally{await f.close();}
    }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }}finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
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
    const saved=await saveInstanceConfig(instance,text,string('revision')??'');await rememberConsent(instance,config);print({result:'SAVED',revision:saved.revision,warnings:saved.warnings});return;
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
async function serverCommand(){
 const manager=new ServerManagement(),instance=await selected();const op=positional[0]??'list';
 if(op==='list'){print(await manager.list(instance));return;}
 if(op==='templates'){print((await manager.list(instance)).templates);return;}
 if(op==='auth'){
  const id=positional[1]??fail('Server ID required'),authAction=positional[2]??'status';const owner=await ensureManager(),base=`http://127.0.0.1:${owner.port}`;
  const response=await fetch(base+`/api/v1/instances/${instance.id}/servers`,{method:'POST',headers:{authorization:'Bearer '+owner.token,origin:base,'content-type':'application/json'},body:JSON.stringify({op:'auth',id,authAction})});const result=await response.json();print(result);if(!response.ok)process.exitCode=1;return;
 }

 if(['add','import'].includes(op)){
  const preview=await manager.preview(instance,string('input')??positional[1]??'',string('name'),op==='import'?absolute(string('file')??positional[1]??fail('Import requires a file')):undefined);
  if(flags.preview){print(preview);return;}
  if(preview.conflicts.length&&!flags.replace)fail('SERVER_ID_CONFLICT: '+preview.conflicts.join(', '));
  const abort=new AbortController();const cancel=()=>abort.abort();process.once('SIGINT',cancel);
  try{const test=await manager.test(instance,{previewId:preview.previewId,prepare:flags.prepare===true,signal:abort.signal});if(test.results.some(r=>r.status!=='READY')){print(test);process.exitCode=1;return;}
   const saved=await manager.savePreview(instance,preview.previewId,preview.revision,flags.replace===true);print({result:'SAVED',revision:saved.revision,servers:test.results,...await applySavedGateway(instance,saved.revision)});
  }finally{process.removeListener('SIGINT',cancel);}return;
 }
 const id=positional[1]??fail('Server ID required');
 if(['retry','refresh'].includes(op)){print(await applySavedGateway(instance,(await manager.list(instance)).revision,id));return;}
 if(op==='test'){const result=await manager.test(instance,{id,prepare:flags.prepare===true});print(result);if(result.results.some(r=>r.status!=='READY'))process.exitCode=1;return;}
 if(['enable','disable','remove'].includes(op)){const saved=await manager.list(instance);const result=await manager.action(instance,id,op as 'enable'|'disable'|'remove',string('revision')??saved.revision);print({result:'SAVED',revision:result.revision,...await applySavedGateway(instance,result.revision)});return;}
 fail('Unknown server action: '+op);
}
async function main(){
  if(flags.version){process.stdout.write(version+'\n');return;}
  if(command==='help'||flags.help){help();return;}
  const allowed:Record<string,string[]>={
    up:['allow-lan','local','no-allow-lan','port','read','write','code','yes','foreground','app-parent-pid'],init:['allow-lan','local','no-allow-lan','port','read','write','code','yes'],
    status:['all'],ls:['archived'],rm:[],down:[],stop:[],logs:['lines','follow'],doctor:[],verify:['token-stdin'],dashboard:['token','no-open','page'],
    auth:['expires','issuer','resource','resource-aliases','client-id','subject','subjects','registration','token-auth','callback','allow-loopback-http'],
    middleware:['input','file','revision'],
    server:['input','file','name','prepare','preview','revision','replace'],
    config:['yes','archived','effective','link','name','revision','patch','file','output'],permissions:['target','mode'],privacy:['all','target']
  };
  for(const key of Object.keys(flags))if(!['instance','json','help','version'].includes(key)&&!allowed[command]?.includes(key))fail('Option --'+key+' is not supported by '+command+'.');
  if(string('instance')!==undefined&&!string('instance')!.trim())fail('--instance requires a non-empty name or ID.');
  validateSubcommand();
  if(['status','ls','down','stop','logs','doctor','verify'].includes(command)&&positional.length)fail('Unexpected argument: '+positional[0]);
  if(command==='dashboard'&&!flags.token){
    if(positional.length>1||positional.length&&!['status','stop'].includes(positional[0]!))fail('Usage: starmux dashboard [status|stop]');
    if(positional[0]==='stop'){await stopManager();if(json)print({result:'STOPPED'});else process.stdout.write('Dashboard stopped. Instances are unchanged.\n');return;}
    if(positional[0]==='status'){const r=await managerStatus();const result={running:!!r,url:r?`http://127.0.0.1:${r.port}`:null};if(json)print(result);else process.stdout.write(JSON.stringify(result)+'\n');return;}
    const target=string('instance')?await selected():null;const r=await ensureManager();const url=`http://127.0.0.1:${r.port}/?${new URLSearchParams({...target?{instance:target.id}:{},...string('page')?{page:string('page')!}:{}})}#token=${r.token}`;
    if(flags['no-open']){if(json)print({url});else process.stdout.write(url+'\n');return;}
    const executable=process.platform==='darwin'?'open':process.platform==='win32'?'rundll32.exe':'xdg-open';
    await new Promise<void>((resolve,reject)=>{const child=spawn(executable,process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url],{stdio:'ignore'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Browser unavailable. Use starmux dashboard --no-open.')));});
    if(json)print({result:'OPENED'});else process.stdout.write('Opened local management console.\n');return;
  }
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
  if(command==='middleware'){
   const manager=new MiddlewareManagement(),instance=await selected(),op=positional[0]??'list';const saved=await manager.list(instance);
   if(op==='list'){print(saved);return;}
   if(op==='reload'){print(await applySavedGateway(instance,saved.revision,'__middleware__'));return;}
   const text=string('file')?await readFile(absolute(string('file')!),'utf8'):string('input')??positional[1]??'';
   if(op==='test'){print(await manager.test(instance,JSON.parse(text)));return;}
   const input=['add','configure'].includes(op)?JSON.parse(text):op==='order'?text.split(','):text;
   const result=await manager.update(instance,op,string('revision')??saved.revision,input);print({result:'SAVED',revision:result.revision,...await applySavedGateway(instance,result.revision)});return;
  }
  if(command==='server'){await serverCommand();return;}
  if(command==='config'){await configCommand();return;}
  if(!['status','down','stop','auth','dashboard','verify','doctor','logs','permissions','privacy'].includes(command))fail('Unknown command: '+command+'. Run starmux --help.');
  if(!(await readRegistry()).instances.length){if(command==='status'||command==='down'||command==='stop'){if(json)print({phase:'stopped',initialized:false});else process.stdout.write('Not initialized. Run starmux up in your project.\n');return;}}
  const instance=await selected();
  if(command==='status')await show(instance);
  else if(command==='down'||command==='stop'){
    const result=await stopInstance(instance);
    if(json)print(result);
    else if(result.restarted)process.stdout.write(`Stopped the previous run of ${instance.name}; another command has started a new run.\n`);
    else process.stdout.write(`${result.result==='ALREADY_STOPPED'?'Already stopped':'Stopped'} ${instance.name}\n`);
  }
  else if(command==='auth')await auth(instance);
  else if(command==='dashboard')await dashboard(instance);
  else if(command==='verify')await verify(instance);
  else if(command==='logs')await logs(instance);
  else if(command==='doctor'){
    if(Number(process.versions.node.split('.')[0])<22||(process.versions.node.startsWith('22.')&&Number(process.versions.node.split('.')[1])<12))fail('Node 22.12 or newer is required.');
    const state=await instanceStatus(instance);
    if(state.configProblem||state.runtimeProblem||state.runtime?.problem)fail(state.configProblem??state.runtimeProblem??state.runtime!.problem!);
    if(state.phase!=='running'&&state.phase!=='stopped')fail('Instance state is '+state.phase+'. Inspect starmux logs -i '+instance.id);
    if(state.phase==='running'&&state.health!=='ok')fail('Instance health is '+state.health+'. Inspect starmux logs -i '+instance.id);
    await stat(desktopCommanderEntry);const loaded=await loadInstanceConfig(instance);await ensureAccessReady(instance);
    if(state.phase==='stopped'&&!await availablePort(loaded.config.port,loaded.config.allowLan?'0.0.0.0':'127.0.0.1'))fail('Configured port is in use: '+loaded.config.port);
    if(json)print({result:'PASS',node:process.version,instanceId:instance.id,configState:state.configState});
    else{
      const isDef=await isDefaultInstance(instance);
      const access=await (await createAccessControl(instancePaths(instance).access,{initialize:false})).snapshot();
      const effective=state.phase==='running'?state.active?.config:loaded.config;
      const modeLabel=!effective?'Mode unavailable':effective.accessRole==='trusted'?'Coding mode':effective.mode==='read-write'?'File writes':'Read-only mode';
      const authLabel=access.mode==='ingress'?'None (no token required)':access.mode==='api-key'?`API key (${access.credentials.filter(c=>c.status==='active').length} active)`:'OAuth';
      const portState=state.phase==='running'?`Running on ${effective?.allowLan?'0.0.0.0':'127.0.0.1'}:${state.port}`:`Stopped · port ${loaded.config.port} available`;
      process.stdout.write(
        `✓ Runtime            Node ${process.version} & Desktop Commander engine ready\n`+
        `✓ Service            ${portState}${isDef?'':` (instance: ${instance.name})`}\n`+
        `✓ Workspace          ${effective?.projectRoot??'Unavailable'} (${modeLabel})\n`+
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
