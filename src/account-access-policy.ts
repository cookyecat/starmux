import {realpath,stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import type {WorkspacePolicy} from './contracts.js';
import {GatewayError,errorCode} from './validation.js';
import {prepareBatchRead} from './batch-read-policy.js';

// Reviewed Desktop Commander operations. Tool annotations are hints, not an
// authorization boundary; unknown tools cannot opt themselves into read-only.
const readOnlyTools=new Set(['health_check','get_config','read_file','read_multiple_files',
  'list_directory','get_file_info','start_search','get_more_search_results','stop_search',
  'list_searches','read_process_output','list_sessions','list_processes','get_usage_stats','get_recent_tool_calls']);
export const isReadOnlyTool=(name:string)=>readOnlyTools.has(name);

export async function createAccountAccessPolicy(root:string,mode='read-only'):Promise<WorkspacePolicy>{
  if(!path.isAbsolute(root))throw new GatewayError('ROOT_REQUIRED');
  const base=await realpath(root);
  if(!(await stat(base)).isDirectory())throw new GatewayError('NOT_DIRECTORY');
  function absolute(raw:unknown){
    if(typeof raw!=='string'||!raw||raw.includes('\0'))throw new GatewayError('INVALID_PATH');
    const expanded=raw==='~'?homedir():raw.startsWith('~/')?path.join(homedir(),raw.slice(2)):raw;
    return path.resolve(base,expanded);
  }
  const policy:WorkspacePolicy={
    root:base,mode,developerCommands:'off',
    async validateGitPath(){throw new GatewayError('READ_ONLY_MODE');},
    async prepare(name,args={}){
      if(!isReadOnlyTool(name))throw new GatewayError('READ_ONLY_MODE');
      if(name==='read_multiple_files')return prepareBatchRead(args,policy.prepare);
      if(['read_file','list_directory','get_file_info','start_search'].includes(name)){
        let target=absolute(args.path);
        if(name==='read_file'){
          // Canonicalize existing links for accurate batch byte accounting, while
          // letting upstream retain its native missing-file errors.
          try{
            target=await realpath(target);
            const info=await stat(target);
            if(info.isFile()&&info.size>1024*1024)throw new GatewayError('FILE_TOO_LARGE');
          }catch(error){if(errorCode(error)!=='ENOENT')throw error;}
        }
        return {name,arguments:{...args,path:target}};
      }
      return {name,arguments:args};
    }
  };
  return Object.freeze(policy);
}
