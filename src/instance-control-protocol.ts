import {z} from 'zod';
import {instanceConfigSchema} from './instance-store.js';

// Version the local control contract independently of npm releases. Unknown
// versions fail explicitly; additional descriptive fields are safe to ignore.
export const INSTANCE_CONTROL_VERSION=1;
const runId=z.string().regex(/^[a-f0-9]{32}$/);
export const instanceOwnerSchema=z.object({
  protocolVersion:z.literal(INSTANCE_CONTROL_VERSION),instanceId:z.string().uuid(),runId,
  pid:z.number().int().min(2),port:z.number().int().min(1024).max(65535),
  token:z.string().regex(/^[a-f0-9]{64}$/),launcher:z.enum(['cli','app']),appParentPid:z.number().int().nullable()
});
export const activeConfigSchema=z.object({config:instanceConfigSchema,revision:z.string(),effectiveRevision:z.string(),sourcePath:z.string()});
export const runtimeStateSchema=z.object({
  protocolVersion:z.literal(INSTANCE_CONTROL_VERSION),instanceId:z.string().uuid(),runId,pid:z.number().int().min(2),
  launcher:z.enum(['cli','app']),appParentPid:z.number().int().nullable(),executionMode:z.enum(['foreground','background']).optional(),
  permissionMode:z.enum(['global','workspace']).optional(),phase:z.enum(['starting','running','stopping','stopped','error']),
  port:z.number().int().min(1024).max(65535).nullable(),active:activeConfigSchema.nullable(),problem:z.string().nullable(),
  coreProgram:z.string(),buildVersion:z.string()
});
export const controlRequestSchema=z.object({protocolVersion:z.literal(INSTANCE_CONTROL_VERSION),method:z.enum(['status','stop','apply']),
  revision:z.string().nullable(),forceId:z.string().max(80).optional(),runId,nonce:z.string().regex(/^[a-f0-9]{48}$/)});
export const controlReplySchema=z.object({protocolVersion:z.literal(INSTANCE_CONTROL_VERSION),state:runtimeStateSchema,
  result:z.enum(['STATE','STOP_ACCEPTED']),error:z.string().optional()});
export function checkInstanceProtocol(value:unknown){
  if(!value||typeof value!=='object'||!('protocolVersion' in value)||value.protocolVersion!==INSTANCE_CONTROL_VERSION)
    throw Error('INSTANCE_CONTROL_PROTOCOL_UNSUPPORTED');
}
export type ActiveConfig=z.infer<typeof activeConfigSchema>;
export type RuntimeState=z.infer<typeof runtimeStateSchema>;
