import { z } from 'zod';
const common = {projectRoot:z.string(), mode:z.enum(['read-only','read-write']), connection:z.enum(['tunnel','https']), port:z.number().int()};
export const setupSchema = z.discriminatedUnion('version',[
  z.object({...common,version:z.literal(1)}).strict(),
  z.object({...common,version:z.literal(2),accessRole:z.enum(['restricted','trusted'])}).strict(),
  z.object({...common,version:z.literal(3),accessRole:z.literal('trusted'),writeScope:z.literal('home-only')}).strict()
]);
export type GatewayConfig = z.infer<typeof setupSchema>;
export const grantsSchema = z.object({version:z.literal(1),homeRead:z.boolean(),outsideRead:z.boolean(),custom:z.array(z.object({path:z.string(),mode:z.enum(['read-only','read-write'])}).strict())}).strict();
export const denySchema = z.object({version:z.literal(1),deniedTools:z.array(z.string()),deniedDirectories:z.array(z.string())}).strict();
export const revocationsSchema = z.object({version:z.literal(1),revokedSubjects:z.array(z.string()),revokedJtis:z.array(z.string())}).strict();
export const upstreamDefinitionSchema = z.object({id:z.string(),transport:z.literal('stdio'),command:z.string(),args:z.array(z.string()),env:z.record(z.string()).optional(),allowTools:z.array(z.string())}).strict();
export type UpstreamDefinition = z.infer<typeof upstreamDefinitionSchema>;
export const ownerSchema = z.object({port:z.number().int(),pid:z.number().int().min(2),token:z.string().regex(/^[a-f0-9]{48}$/),launcher:z.enum(['cli','app']),runId:z.string().regex(/^[a-f0-9]{32}$/)}).passthrough();
export const privateAgentSchema = z.object({Label:z.string(),ProgramArguments:z.tuple([z.string(),z.string()]),EnvironmentVariables:z.record(z.string()),WorkingDirectory:z.string(),StandardOutPath:z.string().optional(),StandardErrorPath:z.string().optional(),RunAtLoad:z.boolean().optional()}).passthrough();
export type PrivateAgent = z.infer<typeof privateAgentSchema>;
