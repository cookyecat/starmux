import {withPrivateLock as withLock} from './private-store-lock.js';
export {withPrivateLock as withLock} from './private-store-lock.js';
import {randomUUID,createHash} from 'node:crypto';
import {lstat,readFile,writeFile,rename,rm,mkdir,realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:net';
import {parse,modify,applyEdits,printParseErrorCode,type ParseError} from 'jsonc-parser';
import {z} from 'zod';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {validateConfiguredUpstreams} from './configured-mcp-upstreams.js';
import {createPrivateDirectory,ownedByUser} from './platform.js';
import {checkSetupValues,setupRuntimeEnv} from './release1-onboarding.js';
import {createAccessControl} from './access-control.js';

const nameSchema=z.string().trim().min(1).max(80).regex(/^[^\x00-\x1f\x7f/\\]+$/);
const sourceSchema=z.object({kind:z.enum(['managed','linked']),path:z.string()}).strict();
export const instanceSchema=z.object({id:z.string().uuid(),name:nameSchema,source:sourceSchema,archived:z.boolean().default(false),
  requiredAccess:z.enum(['ingress','api-key','oauth']).default('ingress'),legacy:z.enum(['setup','live']).optional()}).strict();
export const registrySchema=z.object({schemaVersion:z.literal(1),defaultInstanceId:z.string().uuid().nullable(),instances:z.array(instanceSchema)}).strict();
export type Instance=z.infer<typeof instanceSchema>;
type Registry=z.infer<typeof registrySchema>;
const upstream=z.object({id:z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),transport:z.literal('stdio'),command:z.string().min(1),args:z.array(z.string()),
  allowTools:z.array(z.string()),envRefs:z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/)).default({})}).strict();
export const instanceConfigSchema=z.object({$schema:z.string().optional(),schemaVersion:z.literal(1),projectRoot:z.string(),
  port:z.number().int().min(1024).max(65535),mode:z.enum(['read-only','read-write']).default('read-only'),
  accessRole:z.enum(['restricted','trusted']).default('restricted'),writeScope:z.enum(['home-only','unrestricted']).default('unrestricted'),
  connection:z.enum(['local','https','tunnel']).default('local'),gitMode:z.enum(['off','review','write','push']).default('off'),
  worktreeMode:z.enum(['off','linked']).default('off'),upstreams:z.array(upstream).default([])}).strict();
export type InstanceConfig=z.infer<typeof instanceConfigSchema>;
export const fingerprint=(value:string)=>createHash('sha256').update(value).digest('hex');
export const instancesRoot=(home=homedir())=>path.join(home,'.config','starmux');
export function instancePaths(instance:Instance,home=homedir()){
  const root=path.join(instancesRoot(home),'instances',instance.id);
  return {root,config:instance.source.path,state:path.join(root,'state'),logs:path.join(root,'logs'),snapshots:path.join(root,'snapshots'),
    access:path.join(root,'state','access-v1.json'),grants:path.join(root,'state','workspace-grants-v1.json'),deny:path.join(root,'state','deny-rules-v1.json')};
}
export async function exists(file:string){try{await lstat(file);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}}
export async function readTrusted(file:string,privateFile=true,max=262144){
  if(!path.isAbsolute(file))throw Error('CONFIG_PATH_ABSOLUTE_REQUIRED');
  const stat=await lstat(file);
  if(!stat.isFile()||stat.nlink!==1||!ownedByUser(file,stat,privateFile)||(!privateFile&&process.platform!=='win32'&&(stat.mode&0o022)!==0)||stat.size>max)
    throw Error('CONFIG_FILE_UNSAFE: use an owner-owned regular file; private state requires owner-only permissions');
  // Refuse symlinked ancestors and writable shared source directories as well.
  let parent=path.dirname(file);
  while(true){
    const st=await lstat(parent);
    if(st.isSymbolicLink()||!st.isDirectory())throw Error('CONFIG_DIRECTORY_UNSAFE');
    // Sticky system temporary directories are allowed; other shared writable parents are not.
    if(process.platform!=='win32'&&(st.mode&0o022)!==0&&(st.mode&0o1000)===0)throw Error('CONFIG_DIRECTORY_UNSAFE');
    const next=path.dirname(parent);if(next===parent)break;parent=next;
  }
  return readFile(file,'utf8');
}
export async function atomicPrivate(file:string,text:string){
  createPrivateDirectory(path.dirname(file));
  if(await exists(file))await readTrusted(file);
  const temporary=file+'.'+randomUUID()+'.tmp';
  try{await writeFile(temporary,text,{flag:'wx',mode:0o600});await rename(temporary,file);}finally{await rm(temporary,{force:true});}
}
export async function readRegistry(home=homedir()):Promise<Registry>{
  const file=path.join(instancesRoot(home),'registry.json');
  if(!await exists(file))return {schemaVersion:1,defaultInstanceId:null,instances:[]};
  const registry=registrySchema.parse(JSON.parse(await readTrusted(file)) as unknown);
  if(new Set(registry.instances.map(i=>i.id)).size!==registry.instances.length||new Set(registry.instances.map(i=>i.name)).size!==registry.instances.length)
    throw Error('REGISTRY_DUPLICATE_INSTANCE');
  for(const i of registry.instances){
    if(!path.isAbsolute(i.source.path))throw Error('REGISTRY_SOURCE_INVALID');
    if(i.source.kind==='managed'&&i.source.path!==path.join(instancesRoot(home),'instances',i.id,'config.jsonc'))throw Error('REGISTRY_SOURCE_INVALID');
  }
  return registry;
}
export async function changeRegistry<T>(action:(registry:Registry)=>Promise<T>,home=homedir()){
  const root=instancesRoot(home);createPrivateDirectory(root);
  return withLock(path.join(root,'.registry-lock'),async()=>{
    const registry=await readRegistry(home);const result=await action(registry);
    await atomicPrivate(path.join(root,'registry.json'),JSON.stringify(registrySchema.parse(registry),null,2)+'\n');return result;
  });
}
export async function resolveInstance(selector?:string,home=homedir(),includeArchived=false){
  const registry=await readRegistry(home);const rows=registry.instances.filter(i=>includeArchived||!i.archived);
  const result=selector?rows.find(i=>i.id===selector||i.name===selector):rows.find(i=>i.id===registry.defaultInstanceId)??(rows.length===1?rows[0]:undefined);
  if(!result)throw Error(selector?'INSTANCE_NOT_FOUND: '+selector:'INSTANCE_REQUIRED: use --instance NAME or instance default NAME');
  return result;
}
export function parseConfig(text:string):InstanceConfig{
  const errors:ParseError[]=[];let value:unknown=parse(text,errors,{allowTrailingComma:true});
  if(errors.length){const e=errors[0]!;const prefix=text.slice(0,e.offset);throw Error(`CONFIG_JSON_INVALID line ${prefix.split('\n').length}, column ${e.offset-(prefix.lastIndexOf('\n')+1)+1}: ${printParseErrorCode(e.error)}`);}
  // Import the three historical onboarding formats without changing their authority.
  if(value&&typeof value==='object'&&'version' in value){
    const legacy=value as Record<string,unknown>;
    if(![1,2,3].includes(Number(legacy.version)))throw Error('CONFIG_VERSION_UNSUPPORTED');
    const allowed=new Set(['version','projectRoot','mode','connection','port','accessRole','writeScope']);
    if(Object.keys(legacy).some(k=>!allowed.has(k)))throw Error('CONFIG_UNKNOWN_LEGACY_FIELD');
    value={schemaVersion:1,projectRoot:legacy.projectRoot,mode:legacy.mode,connection:legacy.connection,port:legacy.port,
      accessRole:legacy.version===1?'restricted':legacy.accessRole,writeScope:legacy.version===3?'home-only':'unrestricted'};
  }
  const result=instanceConfigSchema.safeParse(value);
  if(!result.success)throw Error('CONFIG_INVALID: '+result.error.issues.map(i=>`${i.path.join('.')||'config'}: ${i.message}`).join('; '));
  return result.data;
}
export async function validateConfig(config:InstanceConfig){
  const {accessRole,writeScope}=config;
  if(writeScope==='home-only'&&(accessRole!=='trusted'||config.upstreams.length||config.gitMode!=='off'))
    throw Error('CONFIG_INVALID writeScope: home-only requires trusted mode without extra upstreams or Gateway Git');
  const legacy={projectRoot:config.projectRoot,mode:config.mode,port:config.port,connection:config.connection==='local'?'https':config.connection};
  await checkSetupValues(accessRole==='restricted'&&config.mode==='read-write'?{...legacy,version:1}:writeScope==='home-only'?{...legacy,version:3,accessRole,writeScope}:{...legacy,version:2,accessRole});
  validateConfiguredUpstreams({version:1,upstreams:config.upstreams.map(({envRefs,...u})=>({...u,env:Object.fromEntries(Object.keys(envRefs).map(k=>[k,'reference']))}))});
  return config;
}
export const sourceRevision=(file:string,text:string)=>fingerprint(file+'\0'+text);
export function configJSONSchema(){return zodToJsonSchema(instanceConfigSchema,{name:'GatewayInstance'});}
export async function loadInstanceConfig(instance:Instance){
  const text=await readTrusted(instance.source.path,instance.source.kind==='managed');
  const config=await validateConfig(parseConfig(text));
  return {text,config,revision:sourceRevision(instance.source.path,text),effectiveRevision:fingerprint(JSON.stringify({...config,$schema:undefined})),source:instance.source};
}
export async function availablePort(port:number){
  return new Promise<boolean>(resolve=>{const server=createServer();server.once('error',()=>resolve(false));server.listen(port,'127.0.0.1',()=>server.close(()=>resolve(true)));});
}
export async function suggestPort(home=homedir()){
  const used=new Set<number>();
  for(const instance of (await readRegistry(home)).instances){if(!instance.archived)try{used.add((await loadInstanceConfig(instance)).config.port);}catch{}}
  for(let port=18893;port<19893;port++)if(!used.has(port)&&await availablePort(port))return port;
  throw Error('NO_AVAILABLE_INSTANCE_PORT');
}
export function configTemplate(config:InstanceConfig){return '// Gateway startup settings. Save, then apply to restart this instance.\n// Credentials and grants live in the private instance state directory.\n'+JSON.stringify(config,null,2)+'\n';}
export async function createInstance(name:string,options:{config?:InstanceConfig;file?:string;link?:boolean;requiredAccess?:Instance['requiredAccess'];legacy?:'setup'|'live'}={},home=homedir()){
  name=nameSchema.parse(name);
  const input=options.file?path.resolve(options.file):undefined;
  if(options.link&&!input)throw Error('LINK_SOURCE_REQUIRED');
  const text=input?await readTrusted(input,false):undefined;
  if(!options.config&&!text)throw Error('INSTANCE_CONFIG_REQUIRED');
  const config=await validateConfig(options.config??parseConfig(text!));
  return changeRegistry(async registry=>{
    if(registry.instances.some(i=>i.name===name))throw Error('INSTANCE_NAME_EXISTS');
    if(input&&options.link&&registry.instances.some(i=>i.source.path===input))throw Error('CONFIG_ALREADY_BOUND');
    const id=randomUUID();const root=path.join(instancesRoot(home),'instances',id);
    const instance=instanceSchema.parse({id,name,archived:false,requiredAccess:options.requiredAccess??'ingress',
      source:{kind:options.link?'linked':'managed',path:options.link?input!:path.join(root,'config.jsonc')},...(options.legacy?{legacy:options.legacy}:{})});
    createPrivateDirectory(path.join(instancesRoot(home),'instances'));createPrivateDirectory(root);
    for(const dir of ['state','logs','snapshots'])createPrivateDirectory(path.join(root,dir));
    try{
      await atomicPrivate(path.join(instancesRoot(home),'gateway.schema.json'),JSON.stringify(configJSONSchema(),null,2)+'\n');
      if(!options.link){
        const original=text&&!('version' in (parse(text) as object))?text:configTemplate(config);
        await atomicPrivate(instance.source.path,applyEdits(original,modify(original,['$schema'],'../../gateway.schema.json',{formattingOptions:{insertSpaces:true,tabSize:2}})));
      }
      registry.instances.push(instance);if(registry.instances.length===1)registry.defaultInstanceId=id;
      return instance;
    }catch(e){await rm(root,{recursive:true,force:true});throw e;}
  },home);
}
export async function saveInstanceConfig(instance:Instance,text:string,expectedRevision:string,home=homedir()){
  await validateConfig(parseConfig(text));
  const paths=instancePaths(instance,home);
  return withLock(path.join(paths.root,'.config-lock'),async()=>{
    const registered=await resolveInstance(instance.id,home);
    if(registered.source.path!==instance.source.path||registered.source.kind!==instance.source.kind)throw Error('CONFIG_SOURCE_CHANGED: reload before saving');
    const current=await readTrusted(instance.source.path,instance.source.kind==='managed');
    if(sourceRevision(instance.source.path,current)!==expectedRevision)throw Error('CONFIG_CONFLICT: reload and review changes before saving');
    const temporary=instance.source.path+'.'+randomUUID()+'.tmp';
    try{await writeFile(temporary,text,{flag:'wx',mode:0o600});await rename(temporary,instance.source.path);}finally{await rm(temporary,{force:true});}
    return loadInstanceConfig(instance);
  });
}
export async function patchInstanceConfig(instance:Instance,patch:Record<string,unknown>,revision:string,home=homedir()){
  let text=(await loadInstanceConfig(instance)).text;
  for(const [key,value] of Object.entries(patch))text=applyEdits(text,modify(text,[key],value,{formattingOptions:{insertSpaces:true,tabSize:2}}));
  return saveInstanceConfig(instance,text,revision,home);
}
export function instanceEnv(instance:Instance,config:InstanceConfig,home=homedir()):NodeJS.ProcessEnv{
  const legacy={projectRoot:config.projectRoot,mode:config.mode,port:config.port,connection:config.connection==='local'?'https':config.connection,
    ...(config.accessRole==='restricted'&&config.mode==='read-write'?{version:1}:config.writeScope==='home-only'?{version:3,accessRole:config.accessRole,writeScope:'home-only'}:{version:2,accessRole:config.accessRole})};
  const p=instancePaths(instance,home);
  return {...setupRuntimeEnv(legacy),MAC_MCP_ACCESS_FILE:p.access,MAC_MCP_GRANTS_FILE:p.grants,MAC_MCP_DENY_FILE:p.deny,
    MAC_MCP_GIT_MODE:config.gitMode,MAC_MCP_WORKTREE_MODE:config.worktreeMode,MAC_MCP_INSTANCE_ID:instance.id,MAC_MCP_INSTANCE_NAME:instance.name,
    MAC_MCP_PRIVATE_ACTIVITY_OBSERVER:'1'};
}
export async function ensureAccessReady(instance:Instance,home=homedir()){
  const access=await createAccessControl(instancePaths(instance,home).access);const state=await access.snapshot();
  if(instance.requiredAccess!=='ingress'&&state.mode!==instance.requiredAccess)throw Error('INSTANCE_ACCESS_INCOMPLETE: configure '+instance.requiredAccess+' for this instance before starting');
  if(state.mode==='api-key'&&!state.credentials.some(c=>c.status==='active'))throw Error('INSTANCE_ACCESS_INCOMPLETE: create an active API key');
}
export async function prepareUpstreams(instance:Instance,config:InstanceConfig,home=homedir()){
  if(!config.upstreams.length)return undefined;
  const p=instancePaths(instance,home);const secretFile=path.join(p.state,'secrets.json');
  const needsSecrets=config.upstreams.some(u=>Object.keys(u.envRefs).length);
  const secrets=needsSecrets?z.record(z.string()).parse(JSON.parse(await readTrusted(secretFile)) as unknown):{};
  const definitions=config.upstreams.map(({envRefs,...u})=>({...u,env:Object.fromEntries(Object.entries(envRefs).map(([key,ref])=>{
    if(secrets[ref]===undefined)throw Error('INSTANCE_SECRET_MISSING: '+ref);return [key,secrets[ref]];
  }))}));
  const file=path.join(p.state,'resolved-upstreams.json');await atomicPrivate(file,JSON.stringify({version:1,upstreams:definitions}));return file;
}
