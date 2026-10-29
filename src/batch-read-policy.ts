import {lstat} from 'node:fs/promises';
import type {ToolArguments,WorkspacePolicy} from './contracts.js';
import {GatewayError,errorCode} from './validation.js';

// Validate every file before forwarding any part of a batch upstream.
export async function prepareBatchRead(args:ToolArguments,prepare:WorkspacePolicy['prepare']){
  if(!args||Object.keys(args).some(key=>key!=='paths')||!Array.isArray(args.paths)||
    args.paths.length<1||args.paths.some(p=>typeof p!=='string'))
    throw new GatewayError('BATCH_READ_ARGUMENTS_DENIED');
  if(args.paths.length>20)throw new GatewayError('BATCH_READ_COUNT_LIMIT');
  const paths:string[]=[];
  let bytes=0;
  for(const raw of args.paths){
    const invocation=await prepare('read_file',{path:raw});
    const target=invocation.arguments?.path;
    if(typeof target!=='string')throw new GatewayError('BATCH_READ_PATH_INVALID');
    const st=await lstat(target).catch(error=>{
      // Authorization already succeeded. Keep missing paths in the upstream
      // batch so Desktop Commander can report ENOENT beside successful reads.
      if(errorCode(error)==='ENOENT')return null;
      throw error;
    });
    bytes+=st?.size??0;
    if(bytes>4*1024*1024)throw new GatewayError('BATCH_READ_SIZE_LIMIT');
    paths.push(target);
  }
  return {name:'read_multiple_files',arguments:{paths}};
}
