import {z} from 'zod';
export const middlewareConfigSchema=z.object({
 id:z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),enabled:z.boolean().optional(),
 builtin:z.enum(['arguments','catalog','route','result','redact','cache']).optional(),module:z.string().min(1).max(4096).optional(),
 match:z.object({servers:z.array(z.string()).max(12).optional(),tools:z.array(z.string()).max(2000).optional()}).strict().optional(),
 options:z.record(z.unknown()).default({}),
 timeoutMs:z.number().int().min(10).max(300000).optional(),initializationTimeoutMs:z.number().int().min(10).max(300000).optional(),
 concurrency:z.number().int().min(1).max(32).optional(),queueLimit:z.number().int().min(0).max(256).optional()
}).strict().refine(v=>v.builtin!=='cache'||!!v.match?.tools?.length&&v.options.readOnly===true,'Cache requires explicit tool names and options.readOnly=true').refine(v=>Boolean(v.builtin)!==Boolean(v.module),'Choose a built-in type or a module');
export type MiddlewareConfig=z.infer<typeof middlewareConfigSchema>;
