import path from 'node:path';
import {access,readFile,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {parse,parseTree,type Node,type ParseError} from 'jsonc-parser';
import {upstreamConfigSchema} from './config-schemas.js';
import type {InstanceConfig} from './instance-store.js';
export type ServerConfig=InstanceConfig['upstreams'][number];
export interface ServerImport {servers:ServerConfig[];secrets:Record<string,string>;warnings:string[];discoverGrants:string[]}
function fail(code:string):never{throw Error(code);}
/** Tokenize a command line, never execute it through a shell. */
export function commandWords(text:string):string[]{
 const words:string[]=[];let word='',quote='',started=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i]!;
  if(ch==='\0'||ch==='\n'||ch==='\r')fail('SERVER_COMMAND_INVALID');
  if(quote){if(ch===quote)quote='';else if(ch==='\\'&&quote==='"'&&['"','\\'].includes(text[i+1]??''))word+=text[++i];else word+=ch;started=true;continue;}
  if(ch==='"'||ch==="'"){quote=ch;started=true;continue;}
  if(/\s/.test(ch)){if(started){words.push(word);word='';started=false;}continue;}
  if(/[|;&<>`$]/.test(ch))fail('SERVER_SHELL_SYNTAX_UNSUPPORTED');
  if(ch==='\\'&&/[\s"']/.test(text[i+1]??''))word+=text[++i];else word+=ch;started=true;
 }
 if(quote)fail('SERVER_COMMAND_UNCLOSED_QUOTE');if(started)words.push(word);
 if(!words.length||words.length>41)fail('SERVER_COMMAND_INVALID');return words;
}
export async function findExecutable(command:string,base:string):Promise<string>{
 if(command==='node')return process.execPath;
 const candidates=path.isAbsolute(command)||/[\\/]/.test(command)?[path.resolve(base,command)]:(process.env.PATH??'').split(path.delimiter).filter(Boolean).map(dir=>path.join(dir,command));
 for(const file of candidates)for(const suffix of process.platform==='win32'?['','.exe','.cmd','.bat']:[''])try{
  await access(file+suffix,process.platform==='win32'?constants.F_OK:constants.X_OK);if((await stat(file+suffix)).isFile())return path.resolve(file+suffix);
 }catch{}
 throw Error('SERVER_RUNTIME_MISSING: '+command+'; install this runtime and retry.');
}
/** Preview reads and parses only. It never starts a process or connects to a URL. */
export async function previewServerImport(input:string,{base,id='server',file}:{base:string;id?:string;file?:string}):Promise<ServerImport>{
 if(file){const filename=path.resolve(base,file);if((await stat(filename)).size>262144)fail('SERVER_IMPORT_TOO_LARGE');input=await readFile(filename,'utf8');base=path.dirname(filename);}
 if(Buffer.byteLength(input)>262144)fail('SERVER_IMPORT_TOO_LARGE');
 let value:unknown;const trimmed=input.trim();
 if(trimmed.startsWith('{')){const errors:ParseError[]=[];value=parse(trimmed,errors,{allowTrailingComma:true});if(errors.length)fail('SERVER_IMPORT_JSON_INVALID');const check=(node:Node)=>{if(node.type==='object'){const keys=new Set<string>();for(const child of node.children??[]){const key=String(child.children?.[0]?.value);if(keys.has(key))fail('SERVER_IMPORT_DUPLICATE_FIELD: '+key);keys.add(key);}}for(const child of node.children??[])check(child);};const tree=parseTree(trimmed);if(tree)check(tree);}
 else if(/^https?:\/\//.test(trimmed))value={id,url:trimmed,transport:'streamable-http'};
 else {const [command,...args]=commandWords(input);value={id,command,args};}
 if(!value||typeof value!=='object'||Array.isArray(value))fail('SERVER_IMPORT_INVALID');
 const root=value as Record<string,unknown>;
 let entries:[string,unknown][];
 if('mcpServers' in root){if(Object.keys(root).some(k=>k!=='mcpServers'))fail('SERVER_IMPORT_UNKNOWN_FIELDS');if(!root.mcpServers||typeof root.mcpServers!=='object'||Array.isArray(root.mcpServers))fail('SERVER_IMPORT_INVALID');entries=Object.entries(root.mcpServers);}
 else entries=[[typeof root.id==='string'?root.id:id,root]];
 if(!entries.length||entries.length>12)fail('SERVER_LIMIT');
 const result:ServerImport={servers:[],secrets:{},warnings:[],discoverGrants:[]};
 for(const [importName,raw] of entries){
  let name=importName.toLowerCase().replace(/[^a-z0-9_-]/g,'_').slice(0,40);if(!/^[a-z]/.test(name))name=('s_'+name).slice(0,40);if(['desktop','health_check'].includes(name))name=name+'_server';if(name!==importName)result.warnings.push('SERVER_ID_NORMALIZED: '+importName+' -> '+name);
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('SERVER_IMPORT_INVALID');const item={...raw} as Record<string,unknown>;
  if(item.id!==undefined&&item.id!==importName)fail('SERVER_ID_CONFLICT');if(item.disabled!==undefined&&typeof item.disabled!=='boolean')fail('SERVER_IMPORT_INVALID');
  if(!('allowTools' in item))result.discoverGrants.push(name);
  const unknown=Object.keys(item).filter(k=>!['id','command','args','env','envRefs','cwd','url','type','transport','headers','headerRefs','enabled','disabled','allowTools','startupTimeoutMs','auth'].includes(k));
  if(unknown.length)fail('SERVER_IMPORT_UNKNOWN_FIELDS: '+unknown.join(', '));
  let transport=item.transport??item.type??(item.url?'streamable-http':'stdio');if(transport==='http')transport='streamable-http';
  const common={id:name,enabled:item.enabled??(item.disabled===undefined?true:!item.disabled),allowTools:item.allowTools??[],...(item.startupTimeoutMs!==undefined?{startupTimeoutMs:item.startupTimeoutMs}:{})};
  const refs:Record<string,string>={};const values=(transport==='stdio'?item.env:item.headers)??{};
  if(!values||typeof values!=='object'||Array.isArray(values))fail('SERVER_IMPORT_SECRETS_INVALID');
  const publicHeaders:Record<string,string>={};
  for(const [key,value] of Object.entries(values)){
   if(typeof value!=='string')fail('SERVER_IMPORT_SECRETS_INVALID');
   if(transport!=='stdio'&&!/authorization|cookie|token|api[-_]?key|secret/i.test(key)){publicHeaders[key]=value;continue;}
   const ref=('srv_'+name+'_'+key.replace(/[^A-Za-z0-9_]/g,'_')).slice(0,80);if(ref in result.secrets)fail('SERVER_SECRET_REFERENCE_COLLISION');refs[key]=ref;result.secrets[ref]=value;
  }
  let candidate:unknown;
  if(transport==='stdio'){
   if(typeof item.command!=='string')fail('SERVER_COMMAND_INVALID');
   // Resolve explicit relative paths. Bare program names are resolved during test.
   const command=/[\\/]/.test(item.command)?path.resolve(base,item.command):item.command;
   const args=item.args??[];if(!Array.isArray(args)||args.some(a=>typeof a!=='string'))fail('SERVER_ARGUMENTS_INVALID');
   candidate={...common,transport,command,args:args.map(a=>/^\.\.?[\\/]/.test(a)?path.resolve(base,a):a),cwd:path.resolve(base,typeof item.cwd==='string'?item.cwd:'.'),envRefs:{...(item.envRefs as object??{}),...refs}};
  }else candidate={...common,transport,url:item.url,...(item.auth?{auth:item.auth}:{}),headers:publicHeaders,headerRefs:{...(item.headerRefs as object??{}),...refs}};
  const parsed=upstreamConfigSchema.safeParse(candidate);if(!parsed.success)fail('SERVER_IMPORT_INVALID: '+parsed.error.issues.map(e=>e.path.join('.')).join(', '));result.servers.push(parsed.data);
 }
 if(new Set(result.servers.map(s=>s.id)).size!==result.servers.length)fail('SERVER_ID_CONFLICT');return result;
}
