import type {CallToolResult,ToolInvocation,Tool,Resource,ResourceTemplate,ReadResourceResult} from './contracts.js';
import type {Prompt,GetPromptResult,Progress} from '@modelcontextprotocol/sdk/types.js';
export interface UpstreamCallOptions {signal?:AbortSignal;onprogress?:(progress:Progress)=>void}
/** Transport-neutral surface used by the registry. Transport credentials stay inside adapters. */
export interface UpstreamAdapter {
 readonly id:string;readonly discoveredCatalog:readonly Tool[];readonly upstreamCatalog:readonly Tool[];
 connect():Promise<void>;
 forwardWorkspaceInvocation(invocation:ToolInvocation,options?:UpstreamCallOptions):Promise<CallToolResult>;
 listNativeResources():Promise<Resource[]>;
 listNativeResourceTemplates():Promise<ResourceTemplate[]>;
 readNativeResource(uri:string):Promise<ReadResourceResult>;
 listNativePrompts():Promise<Prompt[]>;
 getNativePrompt(name:string,args?:Record<string,string>):Promise<GetPromptResult>;
 close():Promise<void>;
}
export async function collectPages<T>(load:(cursor?:string)=>Promise<{items:T[];nextCursor?:string}>,limit=2000):Promise<T[]>{
 const result:T[]=[],seen=new Set<string>(),identities=new Set<string>();let cursor:string|undefined;
 do{const page=await load(cursor);for(const item of page.items){if(item&&typeof item==='object'){const v=item as Record<string,unknown>,id=v.uri??v.uriTemplate??v.name;if(typeof id==='string'){if(identities.has(id))throw Error('UPSTREAM_CATALOG_CONFLICT');identities.add(id);}}}result.push(...page.items);if(result.length>limit||seen.size>=100||Buffer.byteLength(JSON.stringify(result))>4194304)throw Error('UPSTREAM_CATALOG_LIMIT');cursor=page.nextCursor;if(cursor!==undefined){if(seen.has(cursor))throw Error('UPSTREAM_CURSOR_REPEATED');seen.add(cursor);}}while(cursor!==undefined);return result;
}
