import { readFileSync } from 'node:fs';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { blueprintBasePath, FuseApiError, internalBasePath, type FuseApiClient } from './client';
import type { FuseEnv } from './env';

export interface FuseToolDeps {
  client: FuseApiClient;
  env: FuseEnv;
  /** Reads source for declaration-scoped diagnostics; injected by tests. */
  readFile?: (absolutePath: string) => string | null;
}

type ToolHandler<T> = (args: T) => Promise<CallToolResult>;
type GuardedHandler = <T>(name: string, handler: ToolHandler<T>) => ToolHandler<T>;

export interface FuseToolContext {
  client: FuseApiClient;
  env: FuseEnv;
  leanBase: string;
  internal: string;
  readFile: (absolutePath: string) => string | null;
  guarded: GuardedHandler;
}

export const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;
export const MUTATING = {
  readOnlyHint: false,
  // MCP defaults destructiveHint to true, which approval_policy=never rejects.
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function createToolContext(deps: FuseToolDeps): FuseToolContext {
  const guarded: GuardedHandler = (name, handler) => async (args) => {
    try {
      return await handler(args);
    } catch (error) {
      return toolErrorResult(name, new Error(describeApiError(error)));
    }
  };
  return {
    client: deps.client,
    env: deps.env,
    leanBase: blueprintBasePath(deps.env),
    internal: internalBasePath(deps.env),
    readFile: deps.readFile ?? readSourceFile,
    guarded,
  };
}

function readSourceFile(absolutePath: string): string | null {
  try {
    return readFileSync(absolutePath, 'utf8');
  } catch {
    return null;
  }
}

export function textResult(value: string): CallToolResult {
  return { content: [{ type: 'text', text: value }] };
}

export function jsonResult(value: unknown, indent = 0): CallToolResult {
  return textResult(JSON.stringify(value, null, indent));
}

/** FastMCP-compatible error wording used by the role prompts. */
export function toolErrorResult(name: string, error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: 'text', text: `Error executing tool ${name}: ${message}` }] };
}

function describeApiError(error: unknown): string {
  if (error instanceof FuseApiError) {
    const retry = error.retryAfterSeconds !== null ? ` Retry in ${error.retryAfterSeconds}s.` : '';
    return `${error.detail}${retry}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export function coerceLabels(labels: string | string[]): string[] {
  const list = typeof labels === 'string' ? [labels] : labels;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const label of list) {
    const trimmed = label.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  if (result.length === 0) throw new Error("'labels' must contain at least one declaration label.");
  return result;
}
