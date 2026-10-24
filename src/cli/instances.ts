import {createInterface} from 'node:readline/promises';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import path from 'node:path';
import {createAccessControl} from '../access-control.js';
import {createWorkspaceGrants} from '../workspace-grants.js';
import {createDenyRules} from '../explicit-deny-rules.js';
import {createPrivateDirectory} from '../platform.js';
import {instanceStatus,instanceRequest,runInstance} from '../instance-runtime.js';
import {atomicPrivate,changeRegistry,configJSONSchema,sourceRevision,configTemplate,createInstance,exists,fingerprint,instanceConfigSchema,instanceEnv,instancePaths,instancesRoot,loadInstanceConfig,parseConfig,patchInstanceConfig,readRegistry,readTrusted,resolveInstance,saveInstanceConfig,suggestPort,validateConfig,withLock,type Instance,type InstanceConfig} from '../instance-store.js';

const booleans=new Set(['--json','--all','--link','--archived','--approve-trusted-developer','--approve-unrestricted','--confirm','--effective','--allow-loopback-http']);
function options(args:string[]){
  const flags=new Map<string,string>();const positional:string[]=[];
  for(let i=0;i<args.length;i++){const arg=args[i]!;if(!arg.startsWith('--')){positional.push(arg);continue;}
    if(flags.has(arg))throw Error('DUPLICATE_OPTION: '+arg);
    if(booleans.has(arg))flags.set(arg,'true');else {if(!args[i+1]||args[i+1]!.startsWith('--'))throw Error('MISSING_OPTION_VALUE: '+arg);flags.set(arg,args[++i]!);}
  }
  return {flags,positional};
}
const message=(error:unknown)=>error instanceof Error?error.message:'UNKNOWN_ERROR';
async function readInput(){let text='';for await(const chunk of process.stdin){text+=String(chunk);if(text.length>262144)throw Error('CONFIG_TOO_LARGE');}return text;}
function output(value:unknown){process.stdout.write(JSON.stringify(value,null,2)+'\n');}
function requireApprovals(config:InstanceConfig,flags:Map<string,string>){
  if(config.accessRole==='trusted'&&!flags.has('--approve-trusted-developer'))throw Error('TRUSTED_APPROVAL_REQUIRED: add --approve-trusted-developer');
  if(config.accessRole==='trusted'&&process.platform!=='darwin'&&!flags.has('--approve-unrestricted'))throw Error('UNRESTRICTED_APPROVAL_REQUIRED: add --approve-unrestricted');
}
async function wizard(flags:Map<string,string>,current?:InstanceConfig){
  let project=flags.get('--project')??current?.projectRoot;let role=flags.get('--access-role')??current?.accessRole??'restricted';
  let port=Number(flags.get('--port')??current?.port??await suggestPort());
  if(!project){
    if(!process.stdin.isTTY)throw Error('PROJECT_REQUIRED: use --project /absolute/directory');
    const rl=createInterface({input:process.stdin,output:process.stderr});
    try{project=await rl.question('Work directory: ');role=(await rl.question('Capability (restricted / trusted) [restricted]: '))||'restricted';
      if(role==='trusted'&&(await rl.question('Enable native tools and Shell as your OS account? Type yes: '))==='yes'){
        flags.set('--approve-trusted-developer','true');if(process.platform!=='darwin')flags.set('--approve-unrestricted','true');
      }
      port=Number((await rl.question(`Local port [${port}]: `))||port);
    }finally{rl.close();}
  }
  const config=instanceConfigSchema.parse({...current,schemaVersion:1,projectRoot:await realpath(path.resolve(project)),port,
    accessRole:role,mode:current?.accessRole===role?current.mode:role==='trusted'?'read-write':'read-only',writeScope:current?.accessRole===role?current.writeScope:role==='trusted'&&process.platform==='darwin'?'home-only':'unrestricted',connection:flags.get('--connection')??current?.connection??'local'});
  requireApprovals(config,flags);return validateConfig(config);
}
export async function maybeHandleInstances(argv:string[]):Promise<boolean>{
  let command=argv[0]??'help';
  if(command==='start-setup'&&!process.env.MAC_MCP_INTERNAL_SETUP_OWNER_PID){command='run';argv=['run','--profile','setup',...argv.slice(1)];}
  if(command==='doctor-setup'){command='doctor';argv=['doctor','--profile','setup',...argv.slice(1)];}
  const supported=['instance','config','run','status','stop','restart','logs','doctor','verify','access','permissions','privacy','setup'];
  if(!supported.includes(command))return false;
  try {
  const explicit=argv.includes('--instance');const registry=await readRegistry();
  const managed=registry.instances.length>0;
  const firstWizard=command==='setup'&&argv.length===1&&process.stdin.isTTY;
  if(!['instance','config'].includes(command)&&!explicit&&!managed&&!firstWizard)return false;
  // A retained legacy profile remains available until the owner migrates it.
  const profileIndex=argv.indexOf('--profile');
  if(profileIndex>=0&&!registry.instances.some(i=>i.legacy===argv[profileIndex+1])&&argv[profileIndex+1]!=='auto'){
    if(registry.instances.some(i=>i.legacy))throw Error('LEGACY_PROFILE_NOT_MIGRATED_USE_INSTANCE: select --instance explicitly');
    return false;
  }
  await handle(command,argv.slice(1));}catch(error){
    if(argv.includes('--json'))output({schemaVersion:1,error:message(error)});
    else process.stderr.write(message(error)+'\n');process.exitCode=1;
  }
  return true;
}
async function handle(command:string,args:string[]){
  const {flags,positional}=options(args);const json=flags.has('--json');
  const known=new Set([...booleans,'--instance','--name','--project','--port','--access-role','--connection','--profile','--app-parent-pid','--revision','--patch','--file','--output','--lines','--expires','--issuer','--resource','--resource-aliases','--client-id','--subjects','--registration','--token-auth','--callback','--target','--mode']);
  for(const flag of flags.keys())if(!known.has(flag))throw Error('UNKNOWN_OPTION: '+flag);
  if(command==='instance'){
    const op=positional[0]??'list';
    if(op==='list'){
      const registry=await readRegistry();const instances=await Promise.all(registry.instances.filter(i=>flags.has('--archived')||!i.archived).map(i=>instanceStatus(i)));
      if(json)output({schemaVersion:1,defaultInstanceId:registry.defaultInstanceId,instances});
      else {for(const i of instances)process.stdout.write(`${i.instanceId===registry.defaultInstanceId?'*':' '} ${i.name}\t${i.phase}\t${i.configState}\t${i.port??'—'}\t${i.source.path}\n`);if(!instances.length)process.stdout.write('No instances. Run: mac-mcp-gateway instance create default\n');}return;
    }
    if(op==='create'){
      const config=await wizard(flags);const instance=await createInstance(positional[1]??flags.get('--name')??'default',{config});
      output({instance,message:'Saved. Start with: mac-mcp-gateway run --instance '+JSON.stringify(instance.name)});return;
    }
    if(op==='import'){
      const file=positional[1];if(!file)throw Error('IMPORT_FILE_REQUIRED');
      const config=await validateConfig(parseConfig(await readTrusted(path.resolve(file),false)));requireApprovals(config,flags);
      output({instance:await createInstance(flags.get('--name')??path.basename(file,path.extname(file)),{file,link:flags.has('--link')}),
        message:flags.has('--link')?'Bound to original file. Changes require apply.':'Imported a private copy. The original file is no longer used.'});return;
    }
    if(op==='migrate'){
      const {migrateLegacy}=await import('../instance-migration.js');output(await migrateLegacy(positional[1],flags.has('--confirm'),flags.get('--name')));return;
    }
    const instance=await resolveInstance(positional[1]??flags.get('--instance'),homedir(),op==='restore');
    if(op==='copy'){
      const config={...(await loadInstanceConfig(instance)).config,port:await suggestPort()};
      const access=await createAccessControl(instancePaths(instance).access);const mode=(await access.snapshot()).mode;
      output({instance:await createInstance(positional[2]??flags.get('--name')??instance.name+' copy',{config,requiredAccess:instance.requiredAccess!=='ingress'?instance.requiredAccess:mode}),message:'Copied settings only. Credentials and sessions were not copied.'});return;
    }
    await changeRegistry(async registry=>{
      const item=registry.instances.find(i=>i.id===instance.id)!;
      if(op==='rename'){
        const name=positional[2];if(!name)throw Error('NAME_REQUIRED');if(registry.instances.some(i=>i.name===name))throw Error('INSTANCE_NAME_EXISTS');item.name=name;
      }else if(op==='default')registry.defaultInstanceId=item.id;
      else if(op==='archive'||op==='remove'){const stopped=await instanceRequest(instance,'stop');if(stopped&&stopped.phase!=='stopped')throw Error('INSTANCE_STILL_RUNNING');item.archived=true;if(registry.defaultInstanceId===item.id)registry.defaultInstanceId=null;}
      else if(op==='restore')item.archived=false;
      else throw Error('INSTANCE_ACTION_INVALID');
    });output({result:'OK',instanceId:instance.id});return;
  }
  if(command==='status'&&!flags.has('--instance')&&(!json||flags.has('--all')))return handle('instance',['list',...(json?['--json']:[])]);
  const profile=flags.get('--profile');
  let selector=flags.get('--instance');
  if(profile&&profile!=='auto'){
    const legacy=(await readRegistry()).instances.find(i=>i.legacy===profile);if(!legacy)throw Error('LEGACY_PROFILE_NOT_MIGRATED');selector=legacy.id;
  }
  if(command==='setup'&&!(await readRegistry()).instances.length){await handle('instance',['create','default',...args]);return;}
  const instance=await resolveInstance(selector);const p=instancePaths(instance);
  if(command==='status'){output(await instanceStatus(instance));return;}
  if(command==='run'){
    if(flags.has('--port'))throw Error('INSTANCE_PORT_OVERRIDE_DENIED: edit configuration and apply');
    await runInstance(instance,{json,...(flags.has('--app-parent-pid')?{appParentPid:Number(flags.get('--app-parent-pid'))}:{})});return;
  }
  if(command==='stop'){output({result:(await instanceRequest(instance,'stop'))?'STOPPED':'ALREADY_STOPPED',instanceId:instance.id});return;}
  if(command==='restart'){await handle('config',['apply','--instance',instance.id,...(json?['--json']:[])]);return;}
  if(command==='setup'){
    const current=await loadInstanceConfig(instance);const config=await wizard(flags,current.config);
    await patchInstanceConfig(instance,config,current.revision);output({result:'SAVED',instanceId:instance.id,message:'Apply changes to restart the running instance.'});return;
  }
  if(command==='config'){
    const op=positional[0]??'show';
    if(op==='path'){if(json)output({instanceId:instance.id,...p,source:instance.source});else process.stdout.write(instance.source.path+'\n');return;}
    if(op==='schema'){output(configJSONSchema());return;}
    if(op==='show'){
      if(flags.has('--effective'))output((await instanceStatus(instance)).active);
      else {
        const text=await readTrusted(instance.source.path,instance.source.kind==='managed');
        let config:InstanceConfig|null=null;let problem:string|null=null;
        try{config=await validateConfig(parseConfig(text));}catch(e){problem=message(e);}
        output({instanceId:instance.id,text,config,problem,revision:sourceRevision(instance.source.path,text),source:instance.source});
      }return;
    }
    if(op==='recover'){
      const snapshot=(await instanceStatus(instance)).active;if(!snapshot)throw Error('NO_SUCCESSFUL_CONFIG_SNAPSHOT');
      await validateConfig(snapshot.config);
      const target=path.join(p.root,'config.jsonc');
      await changeRegistry(async registry=>{
        if(await exists(target))throw Error('CONFIG_RECOVERY_WOULD_OVERWRITE: repair the existing file instead');
        await atomicPrivate(target,configTemplate(snapshot.config));
        registry.instances.find(i=>i.id===instance.id)!.source={kind:'managed',path:target};
      });output({result:'RECOVERED_MANAGED_CONFIG',path:target});return;
    }
    if(op==='secret'){
      const action=positional[1];const name=positional[2];if(!name||! /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(name))throw Error('SECRET_NAME_REQUIRED');
      const file=path.join(p.state,'secrets.json');
      await withLock(file+'.lock',async()=>{
        const secrets:Record<string,string>=await exists(file)?JSON.parse(await readTrusted(file)) as Record<string,string>:{};
        if(action==='set')secrets[name]=(await readInput()).replace(/\r?\n$/,'');
        else if(action==='remove')delete secrets[name];else throw Error('SECRET_ACTION_INVALID');
        await atomicPrivate(file,JSON.stringify(secrets));
      });output({result:'SECRET_UPDATED',name});return;
    }
    if(op==='relink'||op==='manage'){
      const file=flags.get('--file')??positional[1];const loaded=op==='manage'?await loadInstanceConfig(instance):null;
      if(op==='relink'&&!file)throw Error('CONFIG_FILE_REQUIRED');
      const target=op==='manage'?path.join(p.root,'config.jsonc'):path.resolve(file!);
      if(op==='relink')await validateConfig(parseConfig(await readTrusted(target,false)));
      await changeRegistry(async registry=>{
        if(registry.instances.some(i=>i.id!==instance.id&&i.source.path===target))throw Error('CONFIG_ALREADY_BOUND');
        if(loaded)await atomicPrivate(target,loaded.text);
        registry.instances.find(i=>i.id===instance.id)!.source={kind:op==='manage'?'managed':'linked',path:target};
      });output({result:'SOURCE_UPDATED',path:target});return;
    }
    if(op==='save'){
      const text=flags.get('--file')?await readTrusted(path.resolve(flags.get('--file')!),false):await readInput();
      const saved=await saveInstanceConfig(instance,text,flags.get('--revision')??'');output({result:'SAVED',revision:saved.revision});return;
    }
    if(op==='patch'){
      const patch=JSON.parse(flags.get('--patch')??await readInput()) as Record<string,unknown>;
      if(patch.accessRole==='trusted'&&(await loadInstanceConfig(instance)).config.accessRole!=='trusted')requireApprovals(parseConfig(JSON.stringify({...((await loadInstanceConfig(instance)).config),...patch})),flags);
      output({result:'SAVED',revision:(await patchInstanceConfig(instance,patch,flags.get('--revision')??'')).revision});return;
    }
    const loaded=await loadInstanceConfig(instance);
    if(op==='validate'){output({result:'VALID',revision:loaded.revision,source:instance.source});return;}
    if(op==='diff'){
      const active=(await instanceStatus(instance)).active?.config??null;
      const changes=Object.entries(loaded.config).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(active?.[key as keyof InstanceConfig])).map(([field,value])=>({field,before:active?.[field as keyof InstanceConfig]??null,after:value}));
      output({instanceId:instance.id,revision:loaded.revision,changes});return;
    }
    if(op==='apply'){
      const state=await instanceRequest(instance,'apply',flags.get('--revision')??loaded.revision);
      output({result:state?'APPLIED':'VALID_ON_NEXT_START',instanceId:instance.id,runtime:state});return;
    }
    if(op==='export'){
      const file=flags.get('--output');const text=configTemplate(loaded.config);
      if(file){await writeFile(path.resolve(file),text,{flag:'wx',mode:0o600});output({result:'EXPORTED',file:path.resolve(file)});}else process.stdout.write(text);return;
    }
    if(op==='edit'){
      const editor=process.env.VISUAL||process.env.EDITOR;if(!editor)throw Error('EDITOR_REQUIRED: set EDITOR to an executable, or use config path');
      const temp=await mkdtemp(path.join(await realpath(tmpdir()),'gateway-edit-'));const file=path.join(temp,'config.jsonc');
      try{await writeFile(file,loaded.text,{mode:0o600});await new Promise<void>((resolve,reject)=>{const child=spawn(editor,[file],{stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('EDITOR_FAILED')));});
        const text=await readFile(file,'utf8');await saveInstanceConfig(instance,text,loaded.revision);output({result:'SAVED',message:'Use config diff, then config apply.'});
      }finally{await rm(temp,{recursive:true,force:true});}return;
    }
    throw Error('CONFIG_ACTION_INVALID');
  }
  if(command==='logs'){
    const file=path.join(p.logs,'core.log');const lines=Math.min(200,Math.max(1,Number(flags.get('--lines')??60)));
    if(!Number.isSafeInteger(Number(flags.get('--lines')??60))||Number(flags.get('--lines')??60)<1||Number(flags.get('--lines')??60)>200)throw Error('INVALID_LINES: expected 1..200');
    const text=await exists(file)?(await readTrusted(file,true,32*1024*1024)).split('\n').slice(-lines).join('\n'):'No logs yet.';
    if(json)output({instanceId:instance.id,output:text});else process.stdout.write(text+'\n');return;
  }
  if(command==='access'){
    process.env.MAC_MCP_ACCESS_FILE=p.access;
    const clean=args.filter((_,i)=>args[i]!=='--instance'&&args[i-1]!=='--instance'&&args[i]!=='--profile'&&args[i-1]!=='--profile');
    await (await import('./access.js')).accessCommand(clean);
    if(positional[0]==='mode'){const mode=positional[1];if(mode==='ingress'||mode==='api-key'||mode==='oauth')await changeRegistry(async r=>{r.instances.find(i=>i.id===instance.id)!.requiredAccess=mode;});}
    return;
  }
  if(command==='permissions'){
    const grants=await createWorkspaceGrants({file:p.grants});const deny=await createDenyRules({file:p.deny});const op=positional[0]??'status';
    if(op==='token')output({token:await readTrusted(grants.tokenFile)});
    else if(op==='status')output({grants:await grants.snapshot(),denied:await deny.snapshot()});
    else if(['disable-tool','enable-tool','deny-directory','allow-directory'].includes(op))output(await deny.update(op,flags.get('--target')??positional[1]));
    else {output(await grants.update(op,{target:flags.get('--target'),mode:flags.get('--mode')}));}return;
  }
  const loaded=await loadInstanceConfig(instance);
  if(command==='doctor'){
    const {ensureAccessReady}=await import('../instance-store.js');await ensureAccessReady(instance);
    const status=await instanceStatus(instance);
    output({result:'PASS',instanceId:instance.id,source:instance.source,config:loaded.config,configState:status.configState,
      message:'Configuration and access state validated. Run verify after starting to check real tools.'});return;
  }
  if(command==='privacy'){
    const status=await instanceStatus(instance);if(!status.runtime?.port)throw Error('INSTANCE_NOT_RUNNING');
    output(await (await import('../privacy-diagnostics.js')).privacyReport({port:status.runtime.port,home:homedir(),all:flags.has('--all'),target:flags.get('--target')??null}));return;
  }
  if(command==='verify'){
    const state=await instanceRequest(instance,'status');if(state?.phase!=='running'||!state.port)throw Error('INSTANCE_NOT_RUNNING');
    const endpoint=`http://127.0.0.1:${state.port}`;
    const health=await fetch(endpoint+'/healthz',{signal:AbortSignal.timeout(3000)}).then(r=>r.json()) as {instanceId?:string};
    if(health.instanceId!==instance.id)throw Error('INSTANCE_HEALTH_IDENTITY_MISMATCH');
    const request=async(method:string,params:unknown)=>{
      const reply=await fetch(endpoint+'/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',...(process.env.MAC_MCP_API_KEY?{authorization:'Bearer '+process.env.MAC_MCP_API_KEY}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)});
      if(!reply.ok)throw Error(reply.status===401?'VERIFICATION_CREDENTIAL_REQUIRED: set MAC_MCP_API_KEY':'MCP_VERIFICATION_FAILED');
      const data=await reply.json() as {error?:unknown;result?:{isError?:boolean}};if(data.error||data.result?.isError)throw Error('MCP_VERIFICATION_FAILED');return data.result;
    };
    await request('tools/list',{});await request('tools/call',{name:'list_directory',arguments:{path:'.',depth:0}});
    output({result:'PASS',instanceId:instance.id,port:state.port,remoteClientVerified:false});return;
  }
}
