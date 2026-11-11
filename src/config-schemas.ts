import { z } from 'zod';
export const grantsSchema = z.object({version:z.literal(1),homeRead:z.boolean(),outsideRead:z.boolean(),custom:z.array(z.object({path:z.string(),mode:z.enum(['read-only','read-write'])}).strict())}).strict();
export const denySchema = z.object({version:z.literal(1),deniedTools:z.array(z.string()),deniedDirectories:z.array(z.string())}).strict();
const cleanString=z.string().max(4096).refine(v=>!v.includes('\0'));
const headers=z.record(z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/),z.string().max(4096).refine(v=>!/[\r\n\0]/.test(v)));
const common={id:z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/).refine(v=>!['desktop','health_check'].includes(v)),
  allowTools:z.array(z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/)).max(2000).refine(v=>new Set(v).size===v.length),
  enabled:z.boolean().optional(),startupTimeoutMs:z.number().int().min(100).max(300000).optional()};
const resolved={...common,configurationError:z.literal('UPSTREAM_SECRET_MISSING').optional()};
const stdio={transport:z.literal('stdio'),command:cleanString.refine(v=>v.length>0),args:z.array(cleanString).max(40),cwd:cleanString.optional()};
const remote={url:z.string().url().refine(v=>{const u=new URL(v);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.hash;})};
const oauthConfig=z.object({type:z.literal('oauth'),clientId:z.string().optional(),issuer:z.string().url().optional(),clientSecretRef:z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/).optional()}).strict().refine(v=>!v.clientId||!!v.issuer,'Pre-registered clients require issuer');
const oauthResolved=z.object({type:z.literal('oauth'),stateFile:z.string(),clientId:z.string().optional(),issuer:z.string().optional(),clientSecret:z.string().optional()}).strict();
const secretRefs=z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/));
const publicHeaders=headers.refine(v=>!Object.keys(v).some(k=>/authorization|cookie|token|api[-_]?key|secret/i.test(k)),'Use headerRefs for credentials');
export const upstreamConfigSchema=z.discriminatedUnion('transport',[
  z.object({...common,...stdio,envRefs:secretRefs.default({})}).strict(),
  z.object({...common,...remote,transport:z.literal('streamable-http'),auth:oauthConfig.optional(),headers:publicHeaders.optional(),headerRefs:secretRefs.default({})}).strict(),
  z.object({...common,...remote,transport:z.literal('sse'),auth:oauthConfig.optional(),headers:publicHeaders.optional(),headerRefs:secretRefs.default({})}).strict()
]);
export const upstreamDefinitionSchema=z.discriminatedUnion('transport',[
  z.object({...resolved,...stdio,env:z.record(z.string().regex(/^[A-Z][A-Z0-9_]*$/),cleanString).refine(v=>Object.keys(v).length<=20).optional()}).strict(),
  z.object({...resolved,...remote,transport:z.literal('streamable-http'),auth:oauthResolved.optional(),headers:headers.optional()}).strict(),
  z.object({...resolved,...remote,transport:z.literal('sse'),auth:oauthResolved.optional(),headers:headers.optional()}).strict()
]);
export type UpstreamDefinition = z.infer<typeof upstreamDefinitionSchema>;
export const ownerSchema = z.object({version:z.literal(1),port:z.number().int(),pid:z.number().int().min(2),token:z.string().regex(/^[a-f0-9]{48}$/),launcher:z.enum(['cli','app']),runId:z.string().regex(/^[a-f0-9]{32}$/)}).passthrough();
