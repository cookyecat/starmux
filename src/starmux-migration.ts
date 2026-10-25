import {homedir} from 'node:os';
import path from 'node:path';
import {readdir,rename,rm,rmdir,lstat,mkdir} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import {createPrivateDirectory} from './platform.js';
import {instanceRequest} from './instance-runtime.js';
import {createAccessControl} from './access-control.js';
import {migrateLegacy} from './instance-migration.js';
import {atomicPrivate,configTemplate,exists,instancesRoot,parseConfig,readRegistry,readTrusted,registrySchema,sourceRevision,fingerprint,validateConfig,withLock} from './instance-store.js';

const oldRoot=()=>path.join(homedir(),'.config','mac-mcp-gateway');
// Only recover locks positively identified as belonging to a dead migration process.
async function migrationLock<T>(file:string,action:()=>Promise<T>):Promise<T>{
  const marker=path.join(file,'starmux-migration-owner.json');
  if(await exists(marker)){
    const recovery=file+'.starmux-recovery';await mkdir(recovery,{mode:0o700});
    try{
      const owner=JSON.parse(await readTrusted(marker)) as {pid:number;source:string};
      if(!Number.isSafeInteger(owner.pid)||owner.pid<2||owner.source!==oldRoot())throw Error('Unrecognized migration lock.');
      let alive=true;try{process.kill(owner.pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')alive=false;else throw error;}
      if(!alive)await rm(file,{recursive:true});
    }finally{await rmdir(recovery);}
  }
  return withLock(file,async()=>{
    await atomicPrivate(marker,JSON.stringify({pid:process.pid,source:oldRoot()}));
    return action();
  });
}
async function copyPrivate(source:string,target:string){
  const info=await lstat(source);
  if(info.isSymbolicLink())throw Error('Migration refuses symbolic links: '+source);
  if(info.isDirectory()){
    createPrivateDirectory(target);
    for(const name of await readdir(source)){
      if(name.endsWith('.lock')||name.endsWith('-lock')||name==='last-runtime.json')continue;
      await copyPrivate(path.join(source,name),path.join(target,name));
    }
  }else await atomicPrivate(target,await readTrusted(source,true,32*1024*1024));
}
async function migrateRegistry(){
  const source=oldRoot(),target=instancesRoot(),stage=target+'.migration';
  if(await exists(target)&&(await readdir(target)).length)throw Error('Migration destination already exists; no files were overwritten.');
  return migrationLock(path.join(source,'.registry-lock'),async()=>{
    const registry=registrySchema.parse(JSON.parse(await readTrusted(path.join(source,'registry.json'))));
    if(new Set(registry.instances.map(i=>i.id)).size!==registry.instances.length||new Set(registry.instances.map(i=>i.name)).size!==registry.instances.length)throw Error('Invalid duplicate identities in old registry.');
    for(const instance of registry.instances){
      const managed=path.join(source,'instances',instance.id,'config.jsonc');
      if(instance.source.kind==='managed'&&instance.source.path!==managed)throw Error('Invalid old managed source path.');
      await validateConfig(parseConfig(await readTrusted(instance.source.path,instance.source.kind==='managed')));
    }
    if(await exists(stage)){
      const marker=JSON.parse(await readTrusted(path.join(stage,'migration.json'))) as {source?:string};
      if(marker.source!==source)throw Error('Unrecognized migration staging directory.');
      await rm(stage,{recursive:true});
    }
    createPrivateDirectory(stage);
    await atomicPrivate(path.join(stage,'migration.json'),JSON.stringify({source,result:'PREPARING',oldFilesRetained:true}));
    for(const instance of registry.instances){
      const stopped=await instanceRequest(instance,'stop');
      if(stopped&&stopped.phase!=='stopped')throw Error('Could not stop old instance '+instance.name);
      // Wait until the old supervisor has released its control identity.
      for(let n=0;n<100;n++){
        try{if(!await instanceRequest(instance,'status'))break;}catch{break;}
        if(n===99)throw Error('Old supervisor is still exiting: '+instance.name);
        await new Promise(r=>setTimeout(r,100));
      }
      const from=path.join(source,'instances',instance.id),to=path.join(stage,'instances',instance.id);
      await migrationLock(path.join(from,'state','access-v1.json.lock'),async()=>{await copyPrivate(from,to);});
      if(instance.source.kind==='managed')instance.source.path=path.join(target,'instances',instance.id,'config.jsonc');
      const accessFile=path.join(to,'state','access-v1.json');
      if(await exists(accessFile))await (await createAccessControl(accessFile)).snapshot();
      else if(instance.requiredAccess!=='ingress'||await exists(accessFile+'.initialized'))throw Error('Missing old authentication state: '+instance.name);
      const snapshot=path.join(to,'snapshots','active.json');
      if(await exists(snapshot)){
        const active=JSON.parse(await readTrusted(snapshot)) as {config:unknown;sourcePath:string;revision:string;effectiveRevision:string};
        const config=await validateConfig(parseConfig(JSON.stringify(active.config)));
        active.sourcePath=instance.source.path;
        active.revision=sourceRevision(instance.source.path,configTemplate(config));
        active.effectiveRevision=fingerprint(JSON.stringify({...config,$schema:undefined}));
        await atomicPrivate(snapshot,JSON.stringify(active));
      }
    }
    if(await exists(path.join(source,'gateway.schema.json')))await copyPrivate(path.join(source,'gateway.schema.json'),path.join(stage,'gateway.schema.json'));
    await atomicPrivate(path.join(stage,'registry.json'),JSON.stringify(registry,null,2));
    await atomicPrivate(path.join(stage,'migration.json'),JSON.stringify({source,result:'MIGRATED_NOT_STARTED',oldFilesRetained:true,at:new Date().toISOString()}));
    if(await exists(target))await rmdir(target);
    await rename(stage,target);
    return {result:'MIGRATED_NOT_STARTED',instances:registry.instances.length,oldFilesRetained:true};
  });
}
export async function migrate(source:string|undefined,yes=false,json=false){
  if(!source){
    const registry=await exists(path.join(oldRoot(),'registry.json'));
    const legacy=await migrateLegacy();
    process.stdout.write(JSON.stringify({registry:registry?path.join(oldRoot(),'registry.json'):null,legacy,next:'starmux migrate registry|setup|live [-y]'},null,2)+'\n');return;
  }
  if(!['registry','setup','live'].includes(source))throw Error('Choose registry, setup or live.');
  if(source!=='registry'&&await exists(path.join(oldRoot(),'registry.json')))throw Error('Old registry found. Migrate registry to preserve existing identities.');
  if(!yes){
    if(!process.stdin.isTTY)throw Error('Migration stops the selected old gateway. Re-run with -y to confirm.');
    const rl=createInterface({input:process.stdin,output:process.stderr});
    try{if(!/^y(es)?$/i.test((await rl.question('Migrate '+source+' and stop its old processes? Originals will be retained. [y/N] ')).trim()))throw Error('Cancelled.');}finally{rl.close();}
  }
  let result:unknown;
  if(source==='registry')result=await migrateRegistry();
  else {
    const marker=path.join(instancesRoot(),'migration-in-progress.json');
    if(await exists(instancesRoot())&&(await readdir(instancesRoot())).length){
      if(!await exists(marker))throw Error('Migration destination already exists.');
      const previous=JSON.parse(await readTrusted(marker)) as {source:string};
      if(previous.source!==source||(await readRegistry()).instances.length)throw Error('Migration destination already has instances.');
    }
    createPrivateDirectory(instancesRoot());await atomicPrivate(marker,JSON.stringify({source}));
    result=await migrateLegacy(source,true);
    await atomicPrivate(path.join(instancesRoot(),'migration.json'),JSON.stringify({source,result:'MIGRATED_NOT_STARTED',oldFilesRetained:true}));await rm(marker);
  }
  if(json)process.stdout.write(JSON.stringify(result,null,2)+'\n');else process.stdout.write('Migrated. Originals retained. Start with starmux up.\n');
}
