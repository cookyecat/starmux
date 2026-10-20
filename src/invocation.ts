import { randomUUID } from 'node:crypto';
import type { AuditSink,CallToolResult,DenyRules,McpUpstream,RequestContext,ToolInvocation } from './contracts.js';
import { errorCode,GatewayError } from './validation.js';

type DeepReadonly<T> = T extends object ? {readonly [K in keyof T]: DeepReadonly<T[K]>} : T;
export interface ToolCallContext {
  readonly request: DeepReadonly<RequestContext>;
  readonly invocation: DeepReadonly<ToolInvocation>;
}
export interface InvocationMiddleware {
  beforeCall?(context: ToolCallContext): void | Promise<void>;
  afterCall?(context: ToolCallContext, result: DeepReadonly<CallToolResult>): void | Promise<void>;
}

// Internal capability; only policy/dispatch code issues these after authorization.
// It is deliberately not a package export or an authorization API for plugins.
const authorized = new WeakMap<AuthorizedInvocation, ToolInvocation>();
const brand: unique symbol = Symbol('authorized invocation');
export interface AuthorizedInvocation {readonly [brand]: true}
export type AuthorizationDecision = {allowed: true; invocation: AuthorizedInvocation} | {allowed: false; reason: string};
export function authorizeInvocation(invocation: ToolInvocation): AuthorizedInvocation {
  const capability: AuthorizedInvocation = Object.freeze({[brand]: true as const});
  authorized.set(capability, structuredClone(invocation));
  return capability;
}
export function createInvocationExecutor(upstream: McpUpstream) {
  return async (capability: AuthorizedInvocation): Promise<CallToolResult> => {
    const invocation = authorized.get(capability);
    if (!invocation) throw new GatewayError('INVOCATION_NOT_AUTHORIZED_OR_CONSUMED');
    authorized.delete(capability); // consume before awaiting; uncertain calls cannot replay
    return upstream.forwardWorkspaceInvocation(invocation);
  };
}
export function safeAuditSink(audit: AuditSink): AuditSink {
  return event => { try { audit(event); } catch { /* Observation must not change execution. */ } };
}
export function observeSafely(observer: () => void, audit: AuditSink, context: RequestContext): void {
  try { observer(); }
  catch { safeAuditSink(audit)({event: 'TOOL_OBSERVER_FAILED', requestId: context.requestId}); }
}
function frozenCopy<T>(value: T): DeepReadonly<T> {
  const copy = structuredClone(value);
  function freeze(item: unknown): void {
    if (item && typeof item === 'object') {
      for (const child of Object.values(item)) freeze(child);
      Object.freeze(item);
    }
  }
  freeze(copy);
  return copy as DeepReadonly<T>;
}
export function createInvocationPipeline(options: {
  dispatch: (invocation: ToolInvocation, context: RequestContext) => Promise<CallToolResult>;
  audit?: AuditSink;
  denyRules?: Pick<DenyRules, 'check'>;
  middleware?: readonly InvocationMiddleware[];
}) {
  const audit = safeAuditSink(options.audit || (() => {}));
  const hooks = [...(options.middleware || [])];
  return async (params: ToolInvocation): Promise<CallToolResult> => {
    const invocation = structuredClone(params);
    // Ingress is a separate process. Loopback and caller headers do not prove identity.
    const request: RequestContext = {requestId: randomUUID(), identity: {kind: 'unverified-local'}};
    const context = frozenCopy({request, invocation});
    try {
      await options.denyRules?.check(invocation.name, invocation.arguments || {});
      for (const hook of hooks) await hook.beforeCall?.(context);
    } catch (error) {
      const reason = errorCode(error) || 'DENY_RULE_CHECK_FAILED';
      audit({event:'TOOL_EXPLICITLY_DENIED',requestId:request.requestId,tool:invocation.name,reason});
      return {isError:true,content:[{type:'text',text:reason+': Review filters on the Mac owner Dashboard /filters'}]};
    }
    const result = await options.dispatch(invocation, request);
    for (const hook of hooks) {
      if (!hook.afterCall) continue;
      try { await hook.afterCall(context, frozenCopy(result)); }
      catch { audit({event:'TOOL_OBSERVER_FAILED',requestId:request.requestId}); }
    }
    return result; // original MCP result, including unknown extension fields
  };
}
