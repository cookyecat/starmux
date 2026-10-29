import {ownedByUser,windows,within,inDirectory,commandOptions} from "./platform.js";
import type { ToolArguments,WorkspacePolicy } from "./contracts.js";
import { errorCode,isInteger,isSafeInteger } from "./validation.js";
// User-selected project workspace admission policy for real Desktop Commander tools.
// This validates path/arguments but is NOT an OS sandbox against same-UID races.
import { lstat,realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createDevPresets } from "./project-dev-presets.js";
import { prepareBatchRead } from "./batch-read-policy.js";

export class WorkspaceDenied extends Error {
  constructor(public readonly code: string){super(code);this.name="WorkspaceDenied";}
}
const deniedParts=new Set([".git",".env",".ssh",".aws",".config","node_modules",
  ".npm",".cache","private","secrets","credentials"]);
function fail(code: string): never{throw new WorkspaceDenied(code);}
function keysExact(args: ToolArguments,required: string[],optional: string[]=[]){
  if(!args||typeof args!=="object"||Array.isArray(args))fail("BAD_ARGUMENTS");
  if(required.some(k=>!Object.hasOwn(args,k))||
     Object.keys(args).some(k=>![...required,...optional].includes(k)))
    fail("ARGUMENTS_NOT_ALLOWED");
}
async function checked(target: string,kind: string,bytes?: number,allowMissing=false){
  const st=await lstat(target).catch(e=>{
    if(errorCode(e)==="ENOENT")return null;
    throw e;
  });
  if(!st){if(kind!=="new"&&!allowMissing)fail("NOT_FOUND");return;}
  if(st.isSymbolicLink()||!ownedByUser(target,st))fail("UNSAFE_OWNER_OR_LINK");
  if(kind==="directory"&&!st.isDirectory())fail("NOT_DIRECTORY");
  if(kind==="file"&&!st.isFile())fail("NOT_FILE");
  if(kind==="new"&&(!st.isFile()||st.nlink!==1))fail("UNSAFE_EXISTING_FILE");
  if(kind==="file"&&st.nlink!==1)fail("HARDLINK");
  if(bytes&&st.size>bytes)fail("FILE_TOO_LARGE");
}
export async function createProjectPolicy({root,mode="read-only",
  developerCommands="presets",allowOwnerSelectedRoot=false,allowTrustedHomeRoot=false,
  maxReadBytes=1024*1024,maxWriteBytes=128*1024}: {root: unknown; mode?: string; developerCommands?: string; allowOwnerSelectedRoot?: boolean; allowTrustedHomeRoot?: boolean; maxReadBytes?: number; maxWriteBytes?: number}): Promise<WorkspacePolicy>{
  if(!["read-only","read-write"].includes(mode))fail("INVALID_MODE");
  if(!["presets","trusted-project"].includes(developerCommands))fail("INVALID_DEVELOPMENT_PROFILE");
  if(developerCommands==="trusted-project"&&mode!=="read-write")fail("DEVELOPMENT_REQUIRES_WRITE");
  if(allowTrustedHomeRoot&&(developerCommands!=="trusted-project"||mode!=="read-write"))
    fail("TRUSTED_HOME_REQUIRES_NATIVE_DEVELOPER_ROLE");
  if(typeof root!=="string"||!path.isAbsolute(root))fail("ROOT_REQUIRED");
  const base=await realpath(root);
  const segments=base.split(path.sep).filter(Boolean);
  if((base===homedir()&&!allowTrustedHomeRoot)||base===path.parse(base).root||base==="/Users"||base==="/Volumes"||
    ((allowOwnerSelectedRoot||allowTrustedHomeRoot)?segments.length<2:segments.length<(process.platform==="darwin"?4:2)))
    fail("ROOT_TOO_BROAD");
  if(path.resolve(root)!==base)fail("ROOT_MUST_BE_CANONICAL");
  await checked(base,"directory");
  const devPresets=createDevPresets(base,mode);
  async function scoped(raw: unknown,kind: string,bytes?: number,allowMissing=false){
    if(typeof raw!=="string"||!raw||raw.length>1024||
       raw.includes("\0")||(!windows&&raw.includes("\\"))||
       raw.startsWith("~")||/^[a-z]+:\/\//i.test(raw))
      fail("INVALID_PATH");
    const relative=path.isAbsolute(raw)?path.relative(base,raw):raw;
    const parts=(relative==="."||relative==="")?[]:relative.split(windows?/[\\/]/:/\//);
    if(parts.some(x=>(windows&&(/[<>:"|?*]/.test(x)||/[. ]$/.test(x)))||!x||x==="."||x===".."||deniedParts.has(x.toLowerCase())||
       /^\.env(\.|$)/i.test(x)||/\.(pem|key|p12|pfx)$/i.test(x)))
      fail("PROTECTED_OR_TRAVERSAL");
    const final=path.resolve(base,...parts);
    if(!within(final,base))fail("OUTSIDE_PROJECT");
    let current=base;
    for(let i=0;i<parts.length;i++){
      current=path.join(current,parts[i]!);
      await checked(current,i===parts.length-1?kind:"directory",
                    i===parts.length-1?bytes:undefined,allowMissing);
    }
    if(parts.length===0&&kind!=="directory")fail("ROOT_IS_DIRECTORY");
    return final;
  }
  return Object.freeze<WorkspacePolicy>({
    root:base,mode,developerCommands,
    async validateGitPath(file){
      const absolute=await scoped(file,"file",maxReadBytes);
      return path.relative(base,absolute);
    },
    observe(name,result,args){devPresets.observe(name,result,args);},
    async prepare(name,args={}){
      if(name==="read_multiple_files")return prepareBatchRead(args,(tool,values)=>this.prepare(tool,values));
      if(name==="start_process"&&developerCommands==="trusted-project"){
        keysExact(args,["command","timeout_ms"]);
        if(typeof args.command!=="string"||!args.command.trim()||
           Buffer.byteLength(args.command,"utf8")>32768||args.command.includes("\0")||
           !isSafeInteger(args.timeout_ms)||args.timeout_ms<100||
           args.timeout_ms>30000)fail("DEVELOPER_COMMAND_INVALID");
        // cwd is NOT a file-system sandbox. All effective user privileges remain.
        return {name,arguments:{...commandOptions(inDirectory(base,args.command)),
          timeout_ms:args.timeout_ms}};
      }
      if(name==="start_process")return devPresets.prepareStart(args);
      if(name==="read_process_output")return devPresets.prepareReadOutput(args);
      if(name==="list_directory"){
        keysExact(args,["path"],["depth"]);
        if(args.depth!==undefined&&(!isInteger(args.depth)||args.depth<0||args.depth>2))
          fail("DEPTH_LIMIT");
        return {name,arguments:{path:await scoped(args.path,"directory"),depth:args.depth??1}};
      }
      if(name==="get_file_info"){
        keysExact(args,["path"]);
        return {name,arguments:{path:await scoped(args.path,"any")}};
      }
      if(name==="read_file"){
        keysExact(args,["path"],["offset","length"]);
        if(args.offset!==undefined&&(!isInteger(args.offset)||args.offset<0))
          fail("OFFSET_LIMIT");
        if(args.length!==undefined&&(!isInteger(args.length)||args.length<1||args.length>1000))
          fail("LENGTH_LIMIT");
        // Missing files are an upstream read result, not a permission denial.
        // Existing ancestors still undergo the same owner/link/scope checks.
        return {name,arguments:{path:await scoped(args.path,"file",maxReadBytes,true),
          offset:args.offset??0,length:args.length??1000}};
      }
      if(mode!=="read-write")fail("WRITE_NOT_APPROVED");
      if(name==="write_file"){
        keysExact(args,["path","content"],["mode"]);
        if(typeof args.content!=="string"||Buffer.byteLength(args.content)>maxWriteBytes)
          fail("CONTENT_TOO_LARGE");
        if(args.mode!==undefined&&args.mode!=="rewrite")fail("MODE_NOT_APPROVED");
        return {name,arguments:{path:await scoped(args.path,"new"),
          content:args.content,mode:"rewrite"}};
      }
      if(name==="edit_block"){
        keysExact(args,["file_path","old_string","new_string"],["expected_replacements"]);
        if(typeof args.old_string!=="string"||!args.old_string||
           typeof args.new_string!=="string"||
           Buffer.byteLength(args.old_string)>maxWriteBytes||
           Buffer.byteLength(args.new_string)>maxWriteBytes||
           (args.expected_replacements!==undefined&&args.expected_replacements!==1))
          fail("EDIT_NOT_APPROVED");
        return {name,arguments:{file_path:await scoped(args.file_path,"file",maxReadBytes),
          old_string:args.old_string,new_string:args.new_string,expected_replacements:1}};
      }
      fail("TOOL_NOT_APPROVED");
    }
  });
}
