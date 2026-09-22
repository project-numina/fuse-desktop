import { ApiError, request } from '@/lib/api';
import type {
  DiagnosticResponse,
  GoalResponse,
  HoverResponse,
} from './types';

export interface InfoviewRequestClient {
  goals: (
    filePath: string,
    line: number,
    column: number,
    signal: AbortSignal,
  ) => Promise<GoalResponse>;
  diagnostics: (filePath: string, signal: AbortSignal) => Promise<DiagnosticResponse>;
  cachedDiagnostics: (filePath: string) => Promise<DiagnosticResponse>;
  save: (filePath: string, content: string) => Promise<void>;
  reload: (filePath: string) => Promise<void>;
  hover: (
    filePath: string,
    line: number,
    column: number,
    signal: AbortSignal,
  ) => Promise<HoverResponse>;
}

function waitForLeanRetry(delayMs: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The Lean request was superseded.', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('The Lean request was superseded.', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Retry one explicitly retryable Lean conflict at the server cadence. */
export async function requestLean<T>(path: string, options: RequestInit): Promise<T> {
  try {
    return await request<T>(path, options);
  } catch (error: unknown) {
    if (!(error instanceof ApiError) || error.code !== 'lean_query_retry') throw error;
    await waitForLeanRetry((error.retryAfterSeconds ?? 2) * 1_000, options.signal);
    return request<T>(path, options);
  }
}

export function leanRequestErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function postBody(filePath: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ file_path: filePath, ...extra });
}

export function createInfoviewRequestClient(basePath: string): InfoviewRequestClient {
  return {
    goals: (filePath, line, column, signal) => requestLean(`${basePath}/lean/goals`, {
      method: 'POST', body: postBody(filePath, { line, column }), signal,
    }),
    diagnostics: (filePath, signal) => requestLean(`${basePath}/lean/diagnostics`, {
      method: 'POST', body: postBody(filePath), signal,
    }),
    cachedDiagnostics: (filePath) => request(`${basePath}/lean/diagnostics/cached`, {
      method: 'POST', body: postBody(filePath),
    }),
    save: (filePath, content) => request<void>(`${basePath}/lean/save`, {
      method: 'POST', body: postBody(filePath, { content }),
    }),
    reload: (filePath) => requestLean<void>(`${basePath}/lean/reload`, {
      method: 'POST', body: postBody(filePath),
    }),
    hover: (filePath, line, column, signal) => requestLean(`${basePath}/lean/hover`, {
      method: 'POST', body: postBody(filePath, { line, column }), signal,
    }),
  };
}
