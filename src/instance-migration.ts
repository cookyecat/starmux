import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {homedir} from 'node:os';
import {rm} from 'node:fs/promises';
import path from 'node:path';
import {legacyProfileDetails} from './operator-cli.js';
import {globalStop,connectOwner} from './global-core-control.js';
import {defaultSetupPath,loadSetupConfig} from './release1-onboarding.js';
import {atomicPrivate,availablePort,changeRegistry,createInstance,exists,instanceConfigSchema,instancePaths,instancesRoot,parseConfig,readRegistry,readTrusted,validateConfig,withLock,type Instance,type InstanceConfig} from './instance-store.js';

const exec=promisify(execFile);
async function discover(profile:'setup'|'live'){
  const details=await legacyProfileDetails(profile);const env=details.env;
  let config:InstanceConfig;
  if(profile==='setup')config=parseConfig(JSON.stringify(await loadSetupConfig(defaultSetupPath())));
  else config=instanceConfigSchema.parse({schemaVersion:1,projectRoot:env.MAC_MCP_PROJECT_ROOT,port:Number(env.MAC_MCP_PROJECT_PORT),mode:env.MAC_MCP_WORKSPACE_MODE??'read-only',
    accessRole:env.MAC_MCP_DC_ACCESS_MODE==='native'?'trusted':'restricted',writeScope:env.MAC_MCP_DC_WRITE_SCOPE??'unrestricted',connection:'local',gitMode:env.MAC_MCP_GIT_MODE??'off',worktreeMode:env.MAC_MCP_WORKTREE_MODE??'off'});
  const secrets:Record<string,string>={};
  if(env.MAC_MCP_UPSTREAMS_FILE){
    const {readConfiguredUpstreams}=await import('./configured-mcp-upstreams.js');
    config.upstreams=(await readConfiguredUpstreams(env.MAC_MCP_UPSTREAMS_FILE)).map(u=>{
      const envRefs:Record<string,string>={};for(const [key,value] of Object.entries(u.env)){const ref=u.id+'_'+key;secrets[ref]=value;envRefs[key]=ref;}
      return {id:u.id,transport:'stdio',command:u.command,args:[...u.args],allowTools:[...u.allowTools],envRefs};
    });
  }
  const known=new Set(['MAC_MCP_PROJECT_ROOT','MAC_MCP_PROJECT_PORT','MAC_MCP_WORKSPACE_MODE','MAC_MCP_DEV_COMMANDS','MAC_MCP_DC_ACCESS_MODE','MAC_MCP_DC_WRITE_SCOPE','MAC_MCP_GIT_MODE','MAC_MCP_WORKTREE_MODE','MAC_MCP_ACCESS_FILE','MAC_MCP_GRANTS_FILE','MAC_MCP_DENY_FILE','MAC_MCP_UPSTREAMS_FILE','MAC_MCP_PRIVATE_ACTIVITY_OBSERVER']);
  const unsupported=Object.keys(env).filter(k=>k.startsWith('MAC_MCP_')&&!known.has(k));
  if(unsupported.length)throw Error('LEGACY_SETTINGS_REQUIRE_MANUAL_IMPORT: '+unsupported.join(', '));
  await validateConfig(config);
  const root=instancesRoot();
  const files={access:env.MAC_MCP_ACCESS_FILE??path.join(root,'access-v1.json'),grants:env.MAC_MCP_GRANTS_FILE??path.join(root,'workspace-grants-v1.json'),deny:env.MAC_MCP_DENY_FILE??path.join(root,'deny-rules-v1.json')};
  let accessMode:'ingress'|'api-key'|'oauth'='ingress';
  if(await exists(files.access)){const state=JSON.parse(await readTrusted(files.access)) as {mode:typeof accessMode};accessMode=state.mode;}
  else if(await exists(files.access+'.initialized'))throw Error('ACCESS_STORE_MISSING');
  return {details,config,files,secrets,accessMode};
}
export async function migrateLegacy(profile?:string,confirm=false,name?:string){
  if(profile&&profile!=='setup'&&profile!=='live')throw Error('MIGRATION_PROFILE_REQUIRED: setup or live');
  const found:Awaited<ReturnType<typeof discover>>[]=[];const errors:{profile:string;error:string}[]=[];
  for(const p of ['setup','live'] as const){
    if(p==='live'&&process.platform!=='darwin')continue;
    try{found.push(await discover(p));}catch(e){errors.push({profile:p,error:(e as Error).message});}
  }
  const preview=found.map(f=>({profile:f.details.kind,source:f.details.source,port:f.config.port,projectRoot:f.config.projectRoot,accessRole:f.config.accessRole,accessMode:f.accessMode,registered:f.details.registered}));
  if(!confirm)return {schemaVersion:1,result:'PREVIEW',sources:preview,errors,message:'Choose a source, then repeat with --confirm. Running legacy instances using these stores will be stopped; original files are retained.'};
  const selected=profile?found.find(f=>f.details.kind===profile):found.length===1?found[0]:null;
  if(!selected)throw Error('MIGRATION_SOURCE_REQUIRED: select setup or live from the preview');
  const root=instancesRoot();
  return withLock(path.join(root,'.migration-lock'),async()=>{
    const registry=await readRegistry();
    if(registry.instances.some(i=>i.legacy))throw Error('LEGACY_STATE_ALREADY_MIGRATED: import another configuration without copying credentials');
    const related=found.filter(f=>Object.values(f.files).some(file=>Object.values(selected.files).includes(file)));
    for(const f of related){
      if(!await availablePort(f.config.port)&&!f.details.registered&&!await connectOwner(f.config.port))throw Error('LEGACY_LISTENER_UNTRUSTED: stop it using its original launcher');
    }
    const stopped:typeof related=[];let instance:Instance|undefined;
    try{
      for(const f of related){
        if(f.details.registered){
          await exec('/bin/launchctl',['disable',`gui/${process.getuid!()}/${f.details.label}`]);
          await exec('/bin/launchctl',['bootout',`gui/${process.getuid!()}`,f.details.plist]);
        }else await globalStop(f.config.port);
        stopped.push(f);
        for(let i=0;i<60&&!await availablePort(f.config.port);i++)await new Promise(r=>setTimeout(r,200));
        if(!await availablePort(f.config.port))throw Error('LEGACY_STOP_UNVERIFIED');
      }
      // Lock every shared access store before copying its live credential state.
      const accessFile=selected.files.access;
      return await withLock(accessFile+'.lock',async()=>{
        instance=await createInstance(name??'default',{config:selected.config,legacy:selected.details.kind,requiredAccess:selected.accessMode});
        const p=instancePaths(instance);
        for(const key of ['access','grants','deny'] as const){
          for(const suffix of ['', '.initialized','.owner-token']){
            const source=selected.files[key]+suffix;if(await exists(source))await atomicPrivate(p[key]+suffix,await readTrusted(source));
          }
        }
        if(Object.keys(selected.secrets).length)await atomicPrivate(path.join(p.state,'secrets.json'),JSON.stringify(selected.secrets));
        await atomicPrivate(path.join(p.root,'migration.json'),JSON.stringify({schemaVersion:1,at:new Date().toISOString(),sources:preview,sourcePaths:selected.files,oldFilesRetained:true},null,2));
        return {result:'MIGRATED_NOT_STARTED',instance,oldFilesRetained:true,message:'Start this instance explicitly. Old automatic starts were disabled.'};
      });
    }catch(error){
      if(instance){await changeRegistry(async r=>{r.instances=r.instances.filter(i=>i.id!==instance!.id);if(r.defaultInstanceId===instance!.id)r.defaultInstanceId=null;});await rm(instancePaths(instance).root,{recursive:true,force:true});}
      const recovery:string[]=[];
      for(const f of stopped){
        if(f.details.registered){try{await exec('/bin/launchctl',['enable',`gui/${process.getuid!()}/${f.details.label}`]);await exec('/bin/launchctl',['bootstrap',`gui/${process.getuid!()}`,f.details.plist]);}catch{recovery.push('Restore legacy service '+f.details.label);}}
        else recovery.push('mac-mcp-gateway run --profile '+f.details.kind);
      }
      throw Error('MIGRATION_FAILED: '+(error as Error).message+'; originals retained; recovery: '+recovery.join('; '));
    }
  });
}
