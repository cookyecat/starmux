import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from './contracts.js';
/** Validate the SDK envelope without returning a parsed copy that can strip extensions. */
export function toolResult(value: unknown): CallToolResult {
  assertToolResult(value);
  return value;
}
function assertToolResult(value: unknown): asserts value is CallToolResult {
  const checked=CallToolResultSchema.safeParse(value);
  if(!checked.success)throw checked.error;
}
