/** Boundary helpers: untrusted values stay unknown until narrowed. */
export class GatewayError extends Error {
  constructor(public readonly code: string) { super(code); }
}
export function fail(code: string): never { throw new GatewayError(code); }
export function currentUid(): number {
  if (!process.getuid) throw new GatewayError('MACOS_UID_REQUIRED');
  return process.getuid();
}
export function isInteger(value: unknown): value is number { return Number.isInteger(value); }
export function isSafeInteger(value: unknown): value is number { return Number.isSafeInteger(value); }
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function record(value: unknown, code = 'INVALID_OBJECT'): Record<string, unknown> {
  if (!isRecord(value)) fail(code);
  return value;
}
export function parseJSON(text: string): unknown { return JSON.parse(text); }
export function errorCode(error: unknown): string | undefined {
  return (error instanceof Error || isRecord(error)) && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'UNKNOWN';
}
export function errorStderr(error: unknown): string {
  return (error instanceof Error || isRecord(error)) && 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '';
}
