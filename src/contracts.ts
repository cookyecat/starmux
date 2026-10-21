import type { CallToolRequest,CallToolResult,ReadResourceResult,Resource,ResourceTemplate,Tool } from '@modelcontextprotocol/sdk/types.js';
export type { CallToolResult,ReadResourceResult,Resource,ResourceTemplate,Tool };
export type ToolArguments = NonNullable<CallToolRequest['params']['arguments']>;
export type ToolInvocation = CallToolRequest['params'];
export type AuditEvent = {event: string; [key: string]: unknown};
export type AuditSink = (event: AuditEvent) => void;
export interface McpUpstream {
  readonly upstreamCatalog: readonly Tool[];
  forwardWorkspaceInvocation(invocation: ToolInvocation): Promise<CallToolResult>;
}
export interface NativeResources {
  listNativeResources(): Promise<Resource[]>;
  readNativeResource(uri: string): Promise<ReadResourceResult>;
  listNativeResourceTemplates?(): Promise<ResourceTemplate[]>;
}
export interface ResourceProvider {
  listResources(): Promise<Resource[]>;
  readResource(uri: string): Promise<ReadResourceResult>;
  listResourceTemplates?(): Promise<ResourceTemplate[]>;
}
export interface RouteDefinition {
  id: string;
  upstream: McpUpstream & Partial<NativeResources>;
  exposeNativeNames?: boolean;
  authorize?: ((name: string, args: ToolArguments) => ToolArguments | Promise<ToolArguments>) | null;
}
export interface RouteInfo {id: string; toolCount: number; nativeNames?: boolean}
export interface UpstreamStatus {id: string; status: 'DISCONNECTED'|'READY'|'UNAVAILABLE'|'CLOSED'; toolCount: number; lastError: string|null}
export interface UpstreamRouter extends McpUpstream, Partial<ResourceProvider> {
  readonly routes: readonly RouteInfo[];
  routeFor(publicName: string): string|null;
  authorizeExtension(publicName: string, args: ToolArguments): Promise<ToolInvocation>;
}
export interface WorkspacePolicy {
  readonly root: string;
  readonly mode: string;
  readonly developerCommands: string;
  validateGitPath(file: unknown): Promise<string>;
  prepare(name: string, args?: ToolArguments): Promise<ToolInvocation>;
  observe?(name: string, result: CallToolResult, args: ToolArguments): void;
  prepareDiskUsage?(path: unknown, depth?: unknown): Promise<ToolInvocation>;
  grantsSnapshot?(): Promise<GrantsConfig>;
}
export interface GrantsConfig {version: 1; homeRead: boolean; outsideRead: boolean; custom: {path: string; mode: 'read-only'|'read-write'}[]}
export interface DenyConfig {version: 1; deniedTools: string[]; deniedDirectories: string[]}
export type WorkspaceGrants = Awaited<ReturnType<typeof import('./workspace-grants.js').createWorkspaceGrants>>;
export type DenyRules = Awaited<ReturnType<typeof import('./explicit-deny-rules.js').createDenyRules>>;
export type GitWorkflow = ReturnType<typeof import('./project-git-workflow.js').createGitWorkflow>;
export interface VerifiedPrincipal {readonly kind: 'verified-remote'; readonly subjectHash: string; readonly scopes: readonly string[]}
export type RequestContext = {readonly requestId: string; readonly identity: VerifiedPrincipal | {readonly kind:'verified-api-key';readonly credentialId:string;readonly permission:'owner-default'} | {readonly kind: 'unverified-local'}};
export type AuthenticationResult = {status: 200; principal: VerifiedPrincipal} | {status: 401|403|503; revoked?: boolean};
export type GatewayStatus = {
  event: 'GATEWAY_STATUS'; profile: 'live'|'setup'; installed: boolean; registered: boolean;
  label: string; port: number|null; health: string|null; workspaceMode: string|null;
  accessMode?: 'ingress'|'api-key'|'unavailable'|null; writeScope?: string|null; executionMode: string; listenerPid: number|null;
  loginAutostart: string; tcc?: string; coreControl: string; coreLauncher: string; coreOwnerPid: number|null;
};
export interface PostResult {status: number; message?: string; location?: string}
