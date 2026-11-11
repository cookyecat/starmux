import {AsyncLocalStorage} from 'node:async_hooks';
import type {ClientCapabilities,Progress} from '@modelcontextprotocol/sdk/types.js';
export interface McpCallContext {
 trace?:(stage:'upstreamRequest'|'upstreamResponse',value:unknown)=>void;
 sessionId:string;
 capabilities:ClientCapabilities;
 signal:AbortSignal;
 progress:(progress:Progress)=>Promise<void>;
 interact:(method:'sampling/createMessage'|'elicitation/create'|'roots/list',params:unknown,signal:AbortSignal)=>Promise<unknown>;
}
export const mcpCallContext=new AsyncLocalStorage<McpCallContext>();
