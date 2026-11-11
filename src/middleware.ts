import type {Tool,CallToolResult,CallToolRequest} from '@modelcontextprotocol/sdk/types.js';
type ToolArguments=NonNullable<CallToolRequest['params']['arguments']>;
/** Public v1 API. Plugins receive data only, never a Client or execution capability. */
export type MiddlewareStage='catalog'|'route'|'request'|'response'|'observe';
export interface ToolTarget {serverId:string;toolName:string}
export interface CatalogEntry {readonly target:ToolTarget;tool:Tool}
export interface MiddlewareContext {
 readonly callId:string;
 readonly source:ToolTarget;
 readonly target:ToolTarget;
 readonly publicName:string;
 readonly arguments:ToolArguments;
 readonly options:Readonly<Record<string,unknown>>;
}
export type RequestDecision={action:'continue';arguments?:ToolArguments}|{action:'reject';reason:string}|{action:'respond';result:CallToolResult};
export interface MiddlewareDefinition {
 apiVersion:1;
 catalog?(entries:CatalogEntry[],options:Readonly<Record<string,unknown>>):CatalogEntry[]|Promise<CatalogEntry[]>;
 route?(context:MiddlewareContext):ToolTarget|null|Promise<ToolTarget|null>;
 request?(context:MiddlewareContext):RequestDecision|Promise<RequestDecision>;
 response?(context:MiddlewareContext,result:CallToolResult):CallToolResult|Promise<CallToolResult>;
 observe?(event:Readonly<{context:MiddlewareContext;stage:MiddlewareStage;durationMs:number;outcome:string}>):void|Promise<void>;
}
export function defineMiddleware<T extends MiddlewareDefinition>(definition:T):T {
 if(definition.apiVersion!==1)throw Error('MIDDLEWARE_API_VERSION_UNSUPPORTED');return Object.freeze(definition);
}
