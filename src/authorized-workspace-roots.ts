import type { WorkspacePolicy } from "./contracts.js";
import { currentUid } from "./validation.js";
// Generic Gateway workspace authorization selector.
// Routing to an allowed directory is a Gateway policy decision, NOT a new
// Desktop Commander tool. Actual file operations stay upstream MCP calls.
import { execFile } from "node:child_process";
import { lstat,realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createProjectPolicy } from "./project-workspace-policy.js";

const exec=promisify(execFile);
const filePathKey=new Map([
  ["read_file","path"],["write_file","path"],["edit_block","file_path"],
  ["get_file_info","path"],["list_directory","path"]
]);
const inside=(candidate: string,root: string)=>candidate===root||candidate.startsWith(root+path.sep);

export function createAuthorizedWorkspacePolicy({basePolicy,linkedGitWorktrees="off"}: {basePolicy: WorkspacePolicy; linkedGitWorktrees?: string}): WorkspacePolicy{
  if(!basePolicy?.root||!["off","linked"].includes(linkedGitWorktrees))
    throw new Error("INVALID_AUTHORIZED_WORKSPACES");
  if(linkedGitWorktrees==="off")return basePolicy;
  const base=basePolicy.root;
  const policies=new Map([[base,basePolicy]]);
  async function linkedRoots(){
    const {stdout}=await exec("/usr/bin/git",
      ["-C",base,"worktree","list","--porcelain"],{
        timeout:3000,maxBuffer:65536,
        env:{PATH:"/usr/bin:/bin",HOME:process.env.HOME||"/"}
      });
    const candidates=stdout.split(/\n\s*\n/)
      .map(part=>part.split("\n").find(line=>line.startsWith("worktree "))?.slice(9))
      .filter((value): value is string=>typeof value==="string" && value.length>0);
    if(candidates.length>64)throw Error("WORKSPACE_TOO_MANY_LINKED_ROOTS");
    const roots=[];
    for(const given of candidates){
      if(!path.isAbsolute(given)||path.normalize(given)!==given)continue;
      const canonical=await realpath(given).catch(()=>null);
      if(canonical!==given)continue;
      const st=await lstat(canonical).catch(()=>null);
      if(!st?.isDirectory()||st.isSymbolicLink()||st.uid!==currentUid())continue;
      roots.push(canonical);
    }
    if(!roots.includes(base))throw Error("WORKSPACE_ROOT_NOT_IN_GIT");
    return roots;
  }
  return Object.freeze<WorkspacePolicy>({
    root:base,mode:basePolicy.mode,
    developerCommands:basePolicy.developerCommands,
    observe(name,result,args){basePolicy.observe?.(name,result,args);},
    validateGitPath(file){return basePolicy.validateGitPath(file);},
    async prepare(name,args={}){
      const key=filePathKey.get(name);
      if(!key||typeof args?.[key]!=="string"||
        !path.isAbsolute(args[key]))return basePolicy.prepare(name,args);
      const roots=await linkedRoots();
      const target=args[key];
      const root=roots.filter(entry=>inside(target,entry))
        .sort((a,b)=>b.length-a.length)[0];
      if(!root)return basePolicy.prepare(name,args);
      let policy=policies.get(root);
      if(!policy){
        policy=await createProjectPolicy({
          root,mode:basePolicy.mode,
          developerCommands:basePolicy.developerCommands
        });
        policies.set(root,policy);
      }
      return policy.prepare(name,args);
    }
  });
}
