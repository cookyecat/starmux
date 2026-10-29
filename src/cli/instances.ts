import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import path from 'node:path';
import {createAccessControl} from '../access-control.js';
import {createWorkspaceGrants} from '../workspace-grants.js';
import {createDenyRules} from '../explicit-deny-rules.js';
import {createPrivateDirectory} from '../platform.js';
import {instanceStatus,instanceRequest} from '../instance-runtime.js';
import {atomicPrivate,changeRegistry,configJSONSchema,sourceRevision,configTemplate,validateConfig,withLock,createInstance,exists,fingerprint,instancePaths,loadInstanceConfig,parseConfig,patchInstanceConfig,readRegistry,readTrusted,resolveInstance,saveInstanceConfig,suggestPort,type InstanceConfig} from '../instance-store.js';

const booleans=new Set(['--json','--all','--link','--archived','--approve-trusted-developer','--approve-unrestricted','--effective','--allow-loopback-http']);
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
export async function handle(command:string,args:string[]){
  const {flags,positional}=options(args);const json=flags.has('--json');
  const known=new Set([...booleans,'--instance','--name','--project','--port','--access-role','--connection','--app-parent-pid','--revision','--patch','--file','--output','--lines','--expires','--issuer','--resource','--resource-aliases','--client-id','--subjects','--registration','--token-auth','--callback','--target','--mode']);
  for(const flag of flags.keys())if(!known.has(flag))throw Error('UNKNOWN_OPTION: '+flag);
  if(command==='instance'){
    const op=positional[0]??'list';
    if(op==='list'){
      const registry=await readRegistry();const filtered=registry.instances.filter(i=>flags.has('--archived')||!i.archived);
      const instances=await Promise.all(filtered.map(i=>instanceStatus(i)));
      if(json)output({schemaVersion:1,defaultInstanceId:registry.defaultInstanceId,instances});
      else {
        if(!instances.length){
          process.stdout.write(registry.instances.length
            ?'No active instances. Run: starmux ls --archived\nRestore an instance with: starmux config restore -i NAME\n'
            :'No instances. Run: starmux up\n');
          return;
        }
        const rows=await Promise.all(instances.map(async(s,idx)=>{
          const raw=filtered[idx]!;
          const cfg=s.active?.config??(await loadInstanceConfig(raw).catch(()=>null))?.config;
          const mark=s.instanceId===registry.defaultInstanceId?'*':' ';
          const state=s.archived?'archived':s.configState==='pending'?`${s.phase} (pending)`:s.phase;
          const mode=cfg?.accessRole==='trusted'?'coding':(s.workspaceMode??'read-only');
          const port=String(s.port??'—');
          const workspace=cfg?.projectRoot??s.source.path;
          return {mark,name:s.name,state,mode,port,workspace};
        }));
        const wName=Math.max(4,...rows.map(r=>r.name.length));
        const wState=Math.max(6,...rows.map(r=>r.state.length));
        const wMode=Math.max(4,...rows.map(r=>r.mode.length));
        const wPort=Math.max(4,...rows.map(r=>r.port.length));
        process.stdout.write(`  ${'NAME'.padEnd(wName)}  ${'STATUS'.padEnd(wState)}  ${'MODE'.padEnd(wMode)}  ${'PORT'.padEnd(wPort)}  WORKSPACE\n`);
        for(const r of rows){
          process.stdout.write(`${r.mark} ${r.name.padEnd(wName)}  ${r.state.padEnd(wState)}  ${r.mode.padEnd(wMode)}  ${r.port.padEnd(wPort)}  ${r.workspace}\n`);
        }
      }return;
    }
    if(op==='import'){
      const file=positional[1];if(!file)throw Error('IMPORT_FILE_REQUIRED');
      const config=await validateConfig(parseConfig(await readTrusted(path.resolve(file),false)));requireApprovals(config,flags);
      output({instance:await createInstance(flags.get('--name')??path.basename(file,path.extname(file)),{file,link:flags.has('--link')}),
        message:flags.has('--link')?'Bound to original file. Changes require apply.':'Imported a private copy. The original file is no longer used.'});return;
    }
    const instance=await resolveInstance(positional[1]??flags.get('--instance'),homedir(),op==='restore');
    if(op==='copy'){
      const config={...(await loadInstanceConfig(instance)).config,port:await suggestPort()};
      const access=await createAccessControl(instancePaths(instance).access);const mode=(await access.snapshot()).mode;
      const created=await createInstance(positional[2]??flags.get('--name')??instance.name+' copy',{config,requiredAccess:instance.requiredAccess!=='ingress'?instance.requiredAccess:mode});
      if(json)output({instance:created,message:'Copied settings only. Credentials and sessions were not copied.'});
      else process.stdout.write(`Copied '${instance.name}' to '${created.name}' (port ${config.port}). Credentials and sessions were not copied.\n`);
      return;
    }
    await changeRegistry(async registry=>{
      const item=registry.instances.find(i=>i.id===instance.id)!;
      if(op==='rename'){
        const name=positional[2];if(!name)throw Error('NAME_REQUIRED');if(registry.instances.some(i=>i.name===name))throw Error('INSTANCE_NAME_EXISTS');item.name=name;
      }else if(op==='default')registry.defaultInstanceId=item.id;
      else if(op==='archive'||op==='remove'){const stopped=await instanceRequest(instance,'stop');if(stopped&&stopped.phase!=='stopped')throw Error('INSTANCE_STILL_RUNNING');item.archived=true;if(registry.defaultInstanceId===item.id)registry.defaultInstanceId=null;}
      else if(op==='restore')item.archived=false;
      else throw Error('INSTANCE_ACTION_INVALID');
    });
    if(json)output({result:'OK',instanceId:instance.id});
    else if(op==='rename')process.stdout.write(`Renamed '${instance.name}' to '${positional[2]}'.\n`);
    else if(op==='default')process.stdout.write(`Default instance set to '${instance.name}'.\n`);
    else if(op==='archive'||op==='remove')process.stdout.write(`Archived instance '${instance.name}'.\n`);
    else if(op==='restore')process.stdout.write(`Restored instance '${instance.name}'.\n`);
    return;
  }
  const selector=flags.get('--instance');
  const instance=await resolveInstance(selector);const p=instancePaths(instance);
  if(command==='config'){
    const op=positional[0]??'show';
    if(op==='path'){if(json)output({instanceId:instance.id,...p,source:instance.source});else process.stdout.write(instance.source.path+'\n');return;}
    if(op==='schema'){output(configJSONSchema());return;}
    if(op==='show'){
      if(flags.has('--effective')){
        const active=(await instanceStatus(instance)).active;
        if(json)output(active);
        else if(!active)process.stdout.write(`Instance ${instance.name} has no active running configuration.\n`);
        else process.stdout.write(
          `Instance       ${instance.name} (effective running config)\n`+
          `Workspace      ${active.config.projectRoot}\n`+
          `Port           ${active.config.port}\n`+
          `Mode           ${active.config.accessRole==='trusted'?'Coding (read-write, shell & git)':active.config.mode}\n`+
          `Git workflow   ${active.config.gitMode}\n`+
          `Extra MCPs     ${active.config.upstreams.length}\n`
        );
      }else{
        const text=await readTrusted(instance.source.path,instance.source.kind==='managed');
        let config:InstanceConfig|null=null;let problem:string|null=null;
        try{config=await validateConfig(parseConfig(text));}catch(e){problem=message(e);}
        if(json)output({instanceId:instance.id,text,config,problem,revision:sourceRevision(instance.source.path,text),source:instance.source});
        else if(problem||!config)process.stdout.write(`Instance       ${instance.name}\nConfig file    ${instance.source.path}\nProblem        ${problem??'Invalid configuration'}\n`);
        else process.stdout.write(
          `Instance       ${instance.name}\n`+
          `Config file    ${instance.source.path} (${instance.source.kind})\n`+
          `Workspace      ${config.projectRoot}\n`+
          `Port           ${config.port}\n`+
          `Mode           ${config.accessRole==='trusted'?'Coding (read-write, shell & git)':config.mode}\n`+
          `Git workflow   ${config.gitMode}\n`+
          `Extra MCPs     ${config.upstreams.length}\n\n`+
          `Commands\n`+
          `  Edit config  starmux config edit${instance.name==='default'?'':` -i ${instance.name}`}\n`+
          `  Apply        starmux config apply${instance.name==='default'?'':` -i ${instance.name}`}\n`
        );
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
    if(op==='validate'){
      if(json)output({result:'VALID',revision:loaded.revision,source:instance.source});
      else process.stdout.write(`✓ Configuration is valid (${instance.source.path})\n`);
      return;
    }
    if(op==='diff'){
      const active=(await instanceStatus(instance)).active?.config??null;
      const changes=Object.entries(loaded.config).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(active?.[key as keyof InstanceConfig])).map(([field,value])=>({field,before:active?.[field as keyof InstanceConfig]??null,after:value}));
      if(json)output({instanceId:instance.id,revision:loaded.revision,changes});
      else if(!changes.length)process.stdout.write('No pending configuration changes.\n');
      else{
        for(const c of changes)process.stdout.write(`${c.field}: ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}\n`);
      }
      return;
    }
    if(op==='apply'){
      const state=await instanceRequest(instance,'apply',flags.get('--revision')??loaded.revision);
      if(json)output({result:state?'APPLIED':'VALID_ON_NEXT_START',instanceId:instance.id,runtime:state});
      else process.stdout.write(state?`Applied configuration to '${instance.name}'.\n`:`Configuration validated; will take effect on next 'starmux up'.\n`);
      return;
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
  if(command==='permissions'){
    const grants=await createWorkspaceGrants({file:p.grants});const deny=await createDenyRules({file:p.deny});const op=positional[0]??'status';
    if(op==='token')output({token:await readTrusted(grants.tokenFile)});
    else if(op==='status')output({grants:await grants.snapshot(),denied:await deny.snapshot()});
    else if(['disable-tool','enable-tool','deny-directory','allow-directory'].includes(op))output(await deny.update(op,flags.get('--target')??positional[1]));
    else {output(await grants.update(op,{target:flags.get('--target'),mode:flags.get('--mode')}));}return;
  }
  if(command==='privacy'){
    const status=await instanceStatus(instance);if(!status.runtime?.port)throw Error('INSTANCE_NOT_RUNNING');
    output(await (await import('../privacy-diagnostics.js')).privacyReport({port:status.runtime.port,home:homedir(),all:flags.has('--all'),target:flags.get('--target')??null}));return;
  }
  throw Error('INSTANCE_COMMAND_UNSUPPORTED');
}
