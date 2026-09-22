/**
 * Shared core for the backend API client.
 *
 * Wraps fetch with JSON handling and error normalization so every domain
 * helper inherits the same behavior. Domain modules under this folder import
 * `request` (or `fetchApi` for multipart uploads) and `ApiError` from here.
 *
 * The hosted app's global redirects (a frozen account to `/account-frozen`,
 * an expired GitHub token to a forced sign-out) are gone: there is no account
 * and no sign-in on the desktop, and neither route exists in the router.
 */

import {
  runtimeAffinedApiPath,
  type WorkspaceRuntimeIdentity,
} from '@/lib/runtime-routing';

/**
 * API error with status, envelope code, and retry timing for caller inspection.
 */
export class ApiError extends Error {
  status: number;
  rawDetail: unknown;
  code: string | null;
  retryAfterSeconds: number | null;
  constructor(
    message: string,
    status: number,
    rawDetail: unknown = null,
    code: string | null = null,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.status = status;
    this.rawDetail = rawDetail;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function detailAsString(detail: unknown): string | null {
  return typeof detail === 'string' && detail.trim() ? detail : null;
}

function retryAfterSeconds(response: Response): number | null {
  const raw = response.headers?.get('Retry-After');
  if (raw == null || raw.trim() === '') return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function userMessageForStatus(
  status: number,
  detail: unknown,
  code: string | null,
): string {
  const detailText = detailAsString(detail);
  if (status === 0) {
    // Status 0 locally means the loopback backend did not answer, not a
    // network problem; restarting the app restarts the backend.
    return 'Could not reach the Fuse backend. Restart the app and try again.';
  }
  if (status === 400 || status === 409 || status === 429) {
    return detailText ?? 'The request could not be completed.';
  }
  if (status === 401) {
    return detailText ?? 'Please sign in again.';
  }
  if (status === 403) {
    if (detailText?.toLowerCase().includes('frozen')) {
      return 'Your account is frozen. Contact an administrator.';
    }
    return 'You do not have permission to access this resource.';
  }
  if (status === 404) {
    if (code === 'lean_file_not_found' && detailText) return detailText;
    return 'We could not find that resource.';
  }
  if (status === 413) {
    return 'The upload is too large. Choose a smaller file and try again.';
  }
  if (status === 422) {
    return detailText ?? 'Some information was invalid. Check the form and try again.';
  }
  if (status >= 500) {
    return 'Something went wrong on our side. Please try again.';
  }
  return detailText ?? `Request failed with status ${status}.`;
}

/**
 * Normalize an API error response into the ApiError thrown to the caller.
 */
async function throwApiError(response: Response): Promise<never> {
  const body = await response.json().catch(() => ({}));
  const detail: unknown = body.detail;
  const code = typeof body.code === 'string' ? body.code : null;
  throw new ApiError(
    userMessageForStatus(response.status, detail, code),
    response.status,
    detail,
    code,
    retryAfterSeconds(response),
  );
}

async function parseApiResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch (error) {
    throw new ApiError(
      'The server returned an unreadable response. Please try again.',
      response.status,
      error,
    );
  }
}

export type ApiRequestOptions = RequestInit & {
  timeoutMs?: number;
  timeoutMessage?: string;
  workspaceRuntimeIdentity?: WorkspaceRuntimeIdentity;
};

export async function fetchApi(path: string, options: ApiRequestOptions): Promise<unknown> {
  const {
    timeoutMs,
    timeoutMessage,
    workspaceRuntimeIdentity,
    ...fetchOptions
  } = options;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  if (timeoutMs != null) {
    const controller = new AbortController();
    fetchOptions.signal = controller.signal;
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }

  let response: Response;
  try {
    response = await fetch(
      `/api${runtimeAffinedApiPath(path, workspaceRuntimeIdentity)}`,
      fetchOptions,
    );
  } catch (error) {
    if (timedOut) {
      throw new ApiError(
        timeoutMessage ?? 'The request took too long. Please try again.',
        0,
        error,
      );
    }
    throw new ApiError(userMessageForStatus(0, null, null), 0, error);
  } finally {
    if (timeoutId != null) clearTimeout(timeoutId);
  }
  if (!response.ok) {
    await throwApiError(response);
  }
  return parseApiResponse(response);
}

/**
 * Makes an API request and returns the parsed JSON response.
 *
 * The generic ``T`` is the expected shape of the parsed response; callers
 * pass it (e.g. ``request<SessionStateResponse>(...)``) instead of casting
 * the returned promise. It defaults to ``unknown`` so untyped call sites
 * keep their previous behavior.
 *
 * @param {string} path URL path relative to /api (e.g. '/auth/me').
 * @param {Object} [options] Fetch options (method, body, headers, etc.).
 * @return {Promise<T>} Parsed JSON response.
 * @throws {ApiError} With the server's detail message and status code.
 */
export async function request<T = unknown>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { headers, ...rest } = options;
  const defaultHeaders: Record<string, string> = rest.body ? { 'Content-Type': 'application/json' } : {};
  const mergedHeaders: Record<string, string> = {
    ...defaultHeaders,
    ...(headers as Record<string, string> | undefined),
  };
  return fetchApi(path, {
    credentials: 'include',
    headers: mergedHeaders,
    ...rest,
  }) as Promise<T>;
}

/**
 * Build the API path prefix for a repository, encoding each segment.
 * @param {string} owner Repository owner.
 * @param {string} repo Repository name.
 * @return {string} e.g. ``/repositories/<owner>/<repo>``.
 */
export function repoPath(owner: string, repo: string): string {
  return `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

/**
 * Build the API path prefix for a single blueprint, encoding each segment.
 * @param {string} owner Repository owner.
 * @param {string} repo Repository name.
 * @param {string} name Blueprint identifier.
 * @return {string} e.g. ``/repositories/<owner>/<repo>/blueprints/<name>``.
 */
export function blueprintPath(owner: string, repo: string, name: string): string {
  return `${repoPath(owner, repo)}/blueprints/${encodeURIComponent(name)}`;
}
