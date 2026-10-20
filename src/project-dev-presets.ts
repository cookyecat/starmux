import type { CallToolResult,ToolArguments } from "./contracts.js";
import { isSafeInteger } from "./validation.js";
// Strict project development command presets executed by upstream Desktop Commander.
// The AI selects only a named preset; no arbitrary shell text reaches the engine.
export class DevPresetDenied extends Error{
  constructor(public readonly code: string){super(code);}
}
function deny(code: string): never{throw new DevPresetDenied(code);}
function quoted(root: unknown){
  if(typeof root!=="string"||/[\r\n\0]/.test(root))deny("ROOT_UNSAFE");
  return "'"+root.split("'").join("'\\''")+"'";
}
export function createDevPresets(projectRoot: string,mode: string,{now=()=>Date.now()}={}){
  const dir=quoted(projectRoot);
  const preset: Readonly<Record<string, {command:string;timeout_ms:number;readOnly:boolean}>>=Object.freeze({
    project_git_status:{
      command:"/usr/bin/git -C "+dir+" status --short --untracked-files=normal",
      timeout_ms:5000,readOnly:true
    },
    project_git_diff_stat:{
      command:"/usr/bin/git -C "+dir+" diff --stat --",
      timeout_ms:5000,readOnly:true
    },
    project_smoke_tests:{
      command:"cd "+dir+" && /opt/homebrew/bin/npm run test:p0",
      timeout_ms:15000,readOnly:false
    },
    project_full_tests:{
      command:"cd "+dir+" && /opt/homebrew/bin/npm test",
      timeout_ms:30000,readOnly:false
    }
  });
  const owned=new Map<number,number>();
  return Object.freeze({
    prepareStart(args: ToolArguments){
      if(!args||Object.keys(args).some(x=>!["command","timeout_ms"].includes(x))||
         typeof args.command!=="string")deny("PRESET_NOT_APPROVED");
      const p=preset[args.command];
      if(!p)deny("PRESET_NOT_APPROVED");
      if(!p.readOnly&&mode!=="read-write")deny("TEST_NEEDS_WRITE_MODE");
      if(args.timeout_ms!==p.timeout_ms)deny("PRESET_TIMEOUT_REQUIRED");
      return {name:"start_process",arguments:{command:p.command,timeout_ms:p.timeout_ms}};
    },
    observe(name: string,result: CallToolResult,args: ToolArguments){
      if(name==="read_process_output"){
        // Only a real, non-error upstream response can extend an owned PID lease.
        // Request validation alone must not keep a dead/reused PID authorized.
        if(result?.isError!==true&&isSafeInteger(args?.pid)&&owned.has(args.pid))
          owned.set(args.pid,now());
        return;
      }
      if(name!=="start_process"||result?.isError===true)return;
      const text=(result?.content||[]).filter(c=>c.type==="text").map(c=>c.text).join("\n");
      const pid=Number(text.match(/Process started with PID (\d+)/)?.[1]);
      if(isSafeInteger(pid)&&pid>0){
        owned.set(pid,now());
        for(const [id,time] of owned)if(now()-time>600000)owned.delete(id);
      }
    },
    prepareReadOutput(args: ToolArguments){
      if(!args||Object.keys(args).some(x=>!["pid","timeout_ms","offset","length"].includes(x)))
        deny("OUTPUT_ARGUMENTS_DENIED");
      const checkedAt=now();
      if(!isSafeInteger(args.pid)||!owned.has(args.pid)||
         checkedAt-owned.get(args.pid)!>600000)deny("PROCESS_NOT_OWNED");
      const offset=args.offset??0,length=args.length??100;
      const timeout_ms=args.timeout_ms??1500;
      // DC supports negative offsets for tail reads. Bound the tail window.
      if(!isSafeInteger(offset)||offset < -300||
         !isSafeInteger(length)||length<1||length>300||
         !isSafeInteger(timeout_ms)||timeout_ms<0||timeout_ms>3000)
        deny("OUTPUT_LIMIT");
      // Do not extend the lease yet: only observe() after an upstream response
      // establishes actual continued availability of this native DC session.
      return {name:"read_process_output",arguments:{
        pid:args.pid,offset,length,timeout_ms
      }};
    },
    names:Object.keys(preset)
  });
}
