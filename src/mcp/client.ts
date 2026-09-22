/**
 * HTTP client for the app's loopback backend. Every MCP tool is a thin call
 * through this class, so the agent, the UI and the build queue all go through
 * the same routes and see the same state.
 *
 * Errors come back in the web backend's envelope `{detail, code, request_id}`
 * and surface as `FuseApiError` with the status, code and `Retry-After`.
 */

import type { FuseEnv } from './env';

export class FuseApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly code: string | null = null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(detail);
    this.name = 'FuseApiError';
  }
}

export interface FuseApiClientOptions {
  baseUrl: string;
  token: string;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Default per-request timeout. Long-running calls pass their own. */
  timeoutMs?: number;
}

export interface RequestOptions {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

/** `/api/repositories/:owner/:repo/blueprints/:blueprint` — the web's blueprint base path. */
export function blueprintBasePath(env: Pick<FuseEnv, 'owner' | 'repo' | 'blueprint'>): string {
  return `/api/repositories/${encodeSegment(env.owner)}/${encodeSegment(env.repo)}/blueprints/${encodeSegment(env.blueprint)}`;
}

/** `/api/internal/:owner/:repo/:blueprint` — helper routes owned by the MCP module. */
export function internalBasePath(env: Pick<FuseEnv, 'owner' | 'repo' | 'blueprint'>): string {
  return `/api/internal/${encodeSegment(env.owner)}/${encodeSegment(env.repo)}/${encodeSegment(env.blueprint)}`;
}

async function parseErrorDetail(response: Response): Promise<{ detail: string; code: string | null }> {
  const text = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(text) as { detail?: unknown; code?: unknown };
    if (typeof parsed.detail === 'string') {
      return { detail: parsed.detail, code: typeof parsed.code === 'string' ? parsed.code : null };
    }
  } catch {
    /* not JSON: fall through to the raw body */
  }
  return { detail: text.trim() || `${response.status} ${response.statusText}`.trim(), code: null };
}

export class FuseApiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(options: FuseApiClientOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  post<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }

  get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('GET', path, undefined, options);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body: unknown, options: RequestOptions): Promise<T> {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new FuseApiError(504, `The app did not answer ${method} ${path} within ${Math.round(timeoutMs / 1000)}s.`, 'timeout');
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new FuseApiError(503, `Could not reach the Fuse app at ${this.baseUrl} (${message}). Is it still running?`, 'unreachable');
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const { detail, code } = await parseErrorDetail(response);
      const retryAfter = Number(response.headers.get('retry-after'));
      throw new FuseApiError(response.status, detail, code, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null);
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new FuseApiError(502, `The app returned a non-JSON response for ${method} ${path}.`, 'bad_response');
    }
  }
}
