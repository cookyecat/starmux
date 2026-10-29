import { z } from 'zod';
export const grantsSchema = z.object({version:z.literal(1),homeRead:z.boolean(),outsideRead:z.boolean(),custom:z.array(z.object({path:z.string(),mode:z.enum(['read-only','read-write'])}).strict())}).strict();
export const denySchema = z.object({version:z.literal(1),deniedTools:z.array(z.string()),deniedDirectories:z.array(z.string())}).strict();
export const upstreamDefinitionSchema = z.object({id:z.string(),transport:z.literal('stdio'),command:z.string(),args:z.array(z.string()),env:z.record(z.string()).optional(),allowTools:z.array(z.string())}).strict();
export type UpstreamDefinition = z.infer<typeof upstreamDefinitionSchema>;
export const ownerSchema = z.object({port:z.number().int(),pid:z.number().int().min(2),token:z.string().regex(/^[a-f0-9]{48}$/),launcher:z.enum(['cli','app']),runId:z.string().regex(/^[a-f0-9]{32}$/)}).passthrough();
