import type { CallToolResult,McpUpstream,Tool,ToolArguments,WorkspacePolicy } from "./contracts.js";
interface Ticket {path: string; created: number; hash?: string; head?: string}
// Git review/stage/commit/push adapter. Actual Git work is delegated to
// the already connected upstream Desktop Commander start_process MCP tool.
// Explicit project scope and opt-in write policy; NOT a separate Git engine.
import { randomUUID } from "node:crypto";
export const gitTools: readonly Tool[]=Object.freeze([
  {name:"gateway_git_review",description:"Review Git status and full single-file patch inside the selected project. Returns a short-lived review token for that exact file content.",inputSchema:{type:"object",properties:{path:{type:"string"}},required:["path"],additionalProperties:false}},
  {name:"gateway_git_stage",description:"Stage exactly one previously reviewed project file via Desktop Commander Git. Requires matching review token; no git add -A.",inputSchema:{type:"object",properties:{path:{type:"string"},reviewToken:{type:"string"}},required:["path","reviewToken"],additionalProperties:false}},
  {name:"gateway_git_commit",description:"Commit only the single staged reviewed project file via Desktop Commander Git; requires a stage token and explicit commit message. Never commits unrelated staged files.",inputSchema:{type:"object",properties:{path:{type:"string"},stageToken:{type:"string"},message:{type:"string"}},required:["path","stageToken","message"],additionalProperties:false}},
  {name:"gateway_git_push",description:"Push only the just-created reviewed commit to origin via Desktop Commander Git; separately disabled unless owner opts in.",inputSchema:{type:"object",properties:{commitToken:{type:"string"}},required:["commitToken"],additionalProperties:false}}
]);
export class GitWorkflowDenied extends Error{
  constructor(public readonly code: string){super(code);}
}
function fail(code: string): never{throw new GitWorkflowDenied(code);}
const quote=(value: string)=>"'"+value.replace(/'/g,"'\\''")+"'";
function strict(o: ToolArguments,keys: string[]){
  if(!o||typeof o!=="object"||Array.isArray(o)||Object.keys(o).length!==keys.length||
     Object.keys(o).some(k=>!keys.includes(k)))fail("INVALID_ARGUMENTS");
}
function output(result: CallToolResult){
  if(result?.isError===true||!Array.isArray(result?.content))fail("UPSTREAM_REJECTED");
  const data=result.content.filter(x=>x.type==="text").map(x=>x.text).join("\n");
  if(!/finished execution/.test(data))fail("PROCESS_NOT_CONFIRMED_COMPLETE");
  if(data.length>24000)fail("OUTPUT_LIMIT");
  return data;
}
function sha(data: string){
  const hits=[...data.matchAll(/\b([a-f0-9]{40})\b/g)];
  if(hits.length!==1)fail("GIT_HASH_UNAVAILABLE");
  return hits[0]![1]!;
}
export function createGitWorkflow({policy,upstream,writesEnabled=false,pushEnabled=false}: {policy: WorkspacePolicy; upstream: McpUpstream; writesEnabled?: boolean; pushEnabled?: boolean}){
  if(!policy||!upstream)throw new TypeError("Git workflow needs project policy and real Desktop Commander MCP client");
  const reviews=new Map<string, Ticket>(),staged=new Map<string, Ticket>(),committed=new Map<string, Ticket>();
  const dir=quote(policy.root);
  const cmdHead="/usr/bin/git -C "+dir+" ";
  async function run(command: string,timeout_ms=15000){
    return output(await upstream.forwardWorkspaceInvocation({
      name:"start_process",arguments:{command,timeout_ms}
    }));
  }
  async function hashWorking(p: string){
    return sha(await run(cmdHead+"hash-object -- "+quote(p),5000));
  }
  async function hashStaged(p: string){
    return sha(await run(cmdHead+"rev-parse "+quote(":"+p),5000));
  }
  function ticket(map: Map<string,Ticket>,token: unknown,path: string|undefined){
    if(typeof token!=="string"||!map.has(token))fail("REVIEW_OR_APPROVAL_REQUIRED");
    const item=map.get(token)!;
    if(item.path!==path||Date.now()-item.created>600000)fail("TOKEN_EXPIRED_OR_PATH_CHANGED");
    return item;
  }
  function textResponse(message: string,tokenType: string|null,token: string|null,raw: string): CallToolResult{
    return {content:[{type:"text",text:JSON.stringify({
      result:message,...(token?{[tokenType!]:token}:{}),
      ...(raw?{desktopCommanderOutput:raw}:{})
    })}]};
  }
  return {
    names:gitTools.map(x=>x.name),
    async handle(name: string,args: ToolArguments): Promise<CallToolResult>{
      if(name==="gateway_git_review"){
        strict(args,["path"]);
        const p=await policy.validateGitPath(args.path);
        const contentHash=await hashWorking(p);
        // One file only, no arbitrary shell fragments or outside-directory paths.
        const show=await run(cmdHead+"status --short -- "+quote(p)+
          " && "+cmdHead+"diff -- "+quote(p)+
          " && "+cmdHead+"diff --cached -- "+quote(p),10000);
        if(show.length>16000)fail("PATCH_TOO_LARGE");
        const token=randomUUID();
        reviews.set(token,{path:p,hash:contentHash,created:Date.now()});
        return textResponse("REVIEW_READY","reviewToken",token,show);
      }
      if(name==="gateway_git_stage"){
        strict(args,["path","reviewToken"]);
        if(!writesEnabled||policy.mode!=="read-write")fail("GIT_WRITE_DISABLED");
        const p=await policy.validateGitPath(args.path);
        const record=ticket(reviews,args.reviewToken,p);
        if(await hashWorking(p)!==record.hash)fail("CONTENT_CHANGED_SINCE_REVIEW");
        const done=await run(cmdHead+"add -- "+quote(p));
        if(await hashStaged(p)!==record.hash)fail("STAGE_CONTENT_MISMATCH");
        reviews.delete(String(args.reviewToken));
        const token=randomUUID();
        staged.set(token,{...record,created:Date.now()});
        return textResponse("ONE_FILE_STAGED","stageToken",token,done);
      }
      if(name==="gateway_git_commit"){
        strict(args,["path","stageToken","message"]);
        if(!writesEnabled||policy.mode!=="read-write")fail("GIT_WRITE_DISABLED");
        const p=await policy.validateGitPath(args.path);
        const record=ticket(staged,args.stageToken,p);
        if(typeof args.message!=="string"||args.message.length<5||args.message.length>120||
           /[\r\n\0]/.test(args.message))fail("INVALID_COMMIT_MESSAGE");
        if(await hashStaged(p)!==record.hash)fail("INDEX_CHANGED_SINCE_STAGE");
        // --only makes the pathspec explicit, preserving unrelated staged files.
        const done=await run(cmdHead+"commit --only -m "+quote(args.message)+" -- "+quote(p),15000);
        const head=sha(await run(cmdHead+"rev-parse HEAD",5000));
        staged.delete(String(args.stageToken));
        const token=randomUUID();
        committed.set(token,{path:p,head,created:Date.now()});
        return textResponse("ONE_FILE_COMMITTED","commitToken",token,done);
      }
      if(name==="gateway_git_push"){
        strict(args,["commitToken"]);
        if(!writesEnabled||!pushEnabled)fail("GIT_PUSH_DISABLED");
        const record=ticket(committed,args.commitToken,committed.get(String(args.commitToken))?.path);
        const head=sha(await run(cmdHead+"rev-parse HEAD",5000));
        if(head!==record.head)fail("HEAD_MOVED_SINCE_COMMIT");
        const done=await run(cmdHead+"push origin HEAD",30000);
        committed.delete(String(args.commitToken));
        return textResponse("REVIEWED_HEAD_PUSHED",null,null,done);
      }
      fail("UNKNOWN_GIT_TOOL");
    }
  };
}
