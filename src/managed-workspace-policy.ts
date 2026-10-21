import {windows,commandOptions,diskUsageCommand} from "./platform.js";
import type { GrantsConfig,ToolArguments,WorkspaceGrants,WorkspacePolicy } from "./contracts.js";
import { GatewayError,isInteger,isSafeInteger } from "./validation.js";
// Release 1 broad read-only inventory, narrow independent write grants.
// No OS sandbox claim: trusted-project Shell remains same-UID privileged.
import { lstat,realpath } from "node:fs/promises";
import path from "node:path";
import { createProjectPolicy } from "./project-workspace-policy.js";
import { isInside } from "./workspace-grants.js";

function fail(reason: string): never {const e=new GatewayError(reason);throw e;};
const fileTools=new Map([
  ["read_file","path"],["get_file_info","path"],["list_directory","path"],
  ["write_file","path"],["edit_block","file_path"]
]);
const inventory=new Set(["read_file","get_file_info","list_directory"]);
const blocked=new Set([".ssh",".aws",".gnupg",".config",".kube",".docker",
  ".npmrc",".netrc",".env","secrets","credentials","keychains",
  "cookies","login data","login.keychain-db"]);
const blockedExt=/\.(pem|key|p12|pfx|mobileprovision)$/i;
const safeSegments=(value: string)=>{
  const parts=value.split(path.sep).filter(Boolean);
  if(parts.some(x=>blocked.has(x.toLowerCase())||/^\.env(\.|$)/i.test(x)||
    blockedExt.test(x)))fail("SENSITIVE_PATH_DENIED");
};
async function broadPath(raw: unknown,kind: string){
  if(typeof raw!=="string"||!path.isAbsolute(raw)||raw.length>2048||
    raw.includes("\0")||(!windows&&raw.includes("\\"))||raw.split(path.sep).includes("..")||
    path.normalize(raw)!==raw)fail("INVENTORY_ABSOLUTE_PATH_REQUIRED");
  safeSegments(raw);
  const canonical=await realpath(raw);
  safeSegments(canonical);
  const st=await lstat(canonical);
  if(st.isSymbolicLink())fail("INVENTORY_SYMLINK_DENIED");
  if(kind==="file"&&(!st.isFile()||st.nlink!==1||st.size>1024*1024))
    fail("INVENTORY_FILE_NOT_APPROVED");
  if(kind==="dir"&&!st.isDirectory())fail("INVENTORY_DIRECTORY_REQUIRED");
  if(kind==="info"&&!st.isFile()&&!st.isDirectory())fail("INVENTORY_NONREGULAR_DENIED");
  return canonical;
}
function keys(args: ToolArguments,required: string[],optional: string[]=[]){
  if(!args||typeof args!=="object"||Array.isArray(args)||
    required.some(k=>!Object.hasOwn(args,k))||
    Object.keys(args).some(k=>![...required,...optional].includes(k)))
    fail("INVENTORY_ARGUMENTS_DENIED");
}
async function readOnly(name: string,args: ToolArguments){
  if(name==="list_directory"){
    keys(args,["path"],["depth"]);
    if(args.depth!==undefined&&(!isInteger(args.depth)||
      args.depth<0||args.depth>1))fail("INVENTORY_DEPTH_LIMIT");
    return {name,arguments:{path:await broadPath(args.path,"dir"),depth:args.depth??1}};
  }
  if(name==="get_file_info"){
    keys(args,["path"]);
    return {name,arguments:{path:await broadPath(args.path,"info")}};
  }
  if(name==="read_file"){
    keys(args,["path"],["offset","length"]);
    const offset=args.offset??0,length=args.length??100;
    if(!isSafeInteger(offset)||offset<0||
      !isSafeInteger(length)||length<1||length>300)
      fail("INVENTORY_READ_LIMIT");
    return {name,arguments:{path:await broadPath(args.path,"file"),offset,length}};
  }
  fail("INVENTORY_TOOL_NOT_READ_ONLY");
}
const quote=(s: string)=>"'"+s.replaceAll("'","'\\''")+"'";
export function createManagedWorkspacePolicy({basePolicy,grants}: {basePolicy: WorkspacePolicy; grants: WorkspaceGrants}): WorkspacePolicy{
  if(!basePolicy?.root||!grants?.snapshot||!grants.home)
    fail("GRANTS_POLICY_INVALID");
  const customCache=new Map<string, WorkspacePolicy>();
  async function locate(name: string,args: ToolArguments){
    const key=fileTools.get(name);
    if(!key||typeof args?.[key]!=="string"||!path.isAbsolute(args[key]))
      return null;
    return path.resolve(args[key]);
  }
  async function select(target: string,data: GrantsConfig): Promise<{kind:"base"|"inventory"|"denied"}|({kind:"custom"}&GrantsConfig["custom"][number])>{
    // Main project always wins, including its sensitive-path denials.
    if(isInside(target,basePolicy.root))return {kind:"base"};
    const custom=data.custom.filter(x=>isInside(target,x.path))
      .sort((a,b)=>b.path.length-a.path.length)[0];
    if(custom)return {kind:"custom",...custom};
    if(isInside(target,grants.home)&&data.homeRead)return {kind:"inventory"};
    if(!isInside(target,grants.home)&&data.outsideRead)return {kind:"inventory"};
    return {kind:"denied"};
  }
  async function prepare(name: string,args: ToolArguments={}){
    const target=await locate(name,args);
    if(!target)return basePolicy.prepare(name,args);
    const data=await grants.snapshot();
    const selected=await select(target,data);
    if(selected.kind==="base")return basePolicy.prepare(name,args);
    // Preserve linked Git worktree permissions where the base policy grants them.
    if(selected.kind==="denied"||selected.kind==="inventory"){
      try{return await basePolicy.prepare(name,args);}catch{/* check explicit inventory */}
    }
    if(selected.kind==="custom"){
      const key=selected.path+"|"+selected.mode;
      let policy=customCache.get(key);
      if(!policy){
        policy=await createProjectPolicy({root:selected.path,mode:selected.mode,
          developerCommands:"presets",allowOwnerSelectedRoot:true});
        customCache.set(key,policy);
      }
      return policy.prepare(name,args);
    }
    if(selected.kind==="inventory"){
      if(!inventory.has(name))fail("INVENTORY_READ_ONLY");
      const invocation=await readOnly(name,args);
      // A symlink inside an approved folder may resolve outside it. Check the
      // actual canonical target against the independently authorized scope.
      const canonical=invocation.arguments.path;
      const homeTarget=isInside(canonical,grants.home);
      if((homeTarget&&!data.homeRead)||(!homeTarget&&!data.outsideRead)){
        if(!isInside(canonical,basePolicy.root)&&
          !data.custom.some(c=>isInside(canonical,c.path)))
          fail("INVENTORY_SYMLINK_ESCAPES_SCOPE");
      }
      return invocation;
    }
    fail("SCOPE_NOT_GRANTED");
  }
  async function prepareDiskUsage(raw: unknown,depth: unknown=1){
    if(!isInteger(depth)||depth<0||depth>1)
      fail("INVENTORY_DISK_DEPTH_LIMIT");
    if(typeof raw!=="string"||!path.isAbsolute(raw))fail("INVENTORY_ABSOLUTE_PATH_REQUIRED");
    const target=await broadPath(raw,"dir");
    if(target===path.parse(target).root)fail("INVENTORY_SCAN_TOO_BROAD");
    const allowed=await select(target,await grants.snapshot());
    if(allowed.kind==="denied")fail("SCOPE_NOT_GRANTED");
    // Does not permit user-provided shell text; quoted path only, no delete.
    return {name:"start_process",arguments:{
      ...commandOptions(diskUsageCommand(target,depth)),timeout_ms:30000
    }};
  }
  return Object.freeze<WorkspacePolicy>({
    root:basePolicy.root,mode:basePolicy.mode,
    developerCommands:basePolicy.developerCommands,
    validateGitPath:f=>basePolicy.validateGitPath(f),
    observe:(name,result,args)=>basePolicy.observe?.(name,result,args),
    prepare,prepareDiskUsage,
    grantsSnapshot:()=>grants.snapshot()
  });
}
