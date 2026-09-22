import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setWorkspaceRuntimeTag } from '@/lib/runtime-routing';
import { ApiError, blueprintPath, fetchApi, repoPath, request } from '@/lib/api/core';

const response = (body: unknown, init: Partial<Response> = {}) => ({
  ok: true,
  status: 200,
  json: vi.fn().mockResolvedValue(body),
  ...init,
}) as unknown as Response;

describe('API core', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('adds the API prefix, credentials, and JSON content type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(request('/thing', { method: 'POST', body: '{}' })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/thing', expect.objectContaining({
      method: 'POST', body: '{}', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    }));
  });

  it('does not add content type to bodyless requests and preserves custom headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({}));
    vi.stubGlobal('fetch', fetchMock);
    await request('/thing', { headers: { 'X-Test': 'yes' } });
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'X-Test': 'yes' });
  });

  // The single local backend has no release routes: the workspace hint is
  // consumed (never forwarded to fetch) and no `runtime=` query is added.
  it('strips the workspace hint from fetch options without adding a route query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({}));
    vi.stubGlobal('fetch', fetchMock);
    setWorkspaceRuntimeTag('owner', 'repo', 'blueprint', 'a1b2c3d4');

    await fetchApi('/repositories/owner/repo/sources/import', {
      method: 'POST',
      workspaceRuntimeIdentity: {
        owner: 'owner',
        repository: 'repo',
        blueprint: 'blueprint',
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/repositories/owner/repo/sources/import',
      { method: 'POST' },
    );
    setWorkspaceRuntimeTag('owner', 'repo', 'blueprint', null);
  });

  it('returns null for 204 and normalizes invalid success JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(null, { status: 204 })));
    await expect(request('/empty')).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(null, {
      json: vi.fn().mockRejectedValue(new SyntaxError('html')),
    })));
    await expect(request('/html')).rejects.toMatchObject({
      status: 200,
      message: 'The server returned an unreadable response. Please try again.',
    });
  });

  it.each([
    [400, 'bad input', 'bad input'],
    [403, 'nope', 'You do not have permission to access this resource.'],
    [404, 'missing', 'We could not find that resource.'],
    [413, null, 'The upload is too large. Choose a smaller file and try again.'],
    [422, [{ loc: ['body'] }], 'Some information was invalid. Check the form and try again.'],
    [500, 'database secret', 'Something went wrong on our side. Please try again.'],
  ])('normalizes HTTP %i without leaking unsafe detail', async (status, detail, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, {
      ok: false, status, json: vi.fn().mockResolvedValue({ detail }),
    })));
    await expect(request('/fail')).rejects.toMatchObject({ status, rawDetail: detail, message });
  });

  // The hosted client redirected a frozen 403 to /account-frozen and turned a
  // re-auth 401 into a forced sign-out; neither exists on the desktop.
  it('never redirects or signs out on account-style errors', async () => {
    const assign = vi.fn();
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, pathname: '/repo/o/r', assign, reload });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({}, { ok: false, status: 403, json: vi.fn().mockResolvedValue({ detail: 'Account frozen' }) }))
      .mockResolvedValueOnce(response({}, { ok: false, status: 401, json: vi.fn().mockResolvedValue({ detail: 'Please sign in again.' }) }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(request('/frozen')).rejects.toMatchObject({ status: 403, message: 'Your account is frozen. Contact an administrator.' });
    await expect(request('/expired')).rejects.toMatchObject({ status: 401, message: 'Please sign in again.' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => call[0])).not.toContain('/api/auth/logout');
    expect(assign).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('preserves the safe detail for a removed Lean file', async () => {
    const detail = 'The requested Lean file no longer exists. Refresh the file list and try again.';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, {
      ok: false,
      status: 404,
      headers: new Headers({ 'Retry-After': '2' }),
      json: vi.fn().mockResolvedValue({ detail, code: 'lean_file_not_found' }),
    })));

    await expect(request('/lean/reload')).rejects.toMatchObject({
      status: 404,
      code: 'lean_file_not_found',
      message: detail,
      retryAfterSeconds: 2,
    });
  });

  it('normalizes network failures as ApiError', async () => {
    const original = new TypeError('Failed to fetch');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(original));
    await expect(request('/offline')).rejects.toEqual(expect.objectContaining({
      status: 0,
      rawDetail: original,
      message: 'Could not reach the Fuse backend. Restart the app and try again.',
    }));
  });

  it('aborts timed-out requests with the caller message', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const pending = expect(fetchApi('/slow', { timeoutMs: 25, timeoutMessage: 'Too slow.' }))
      .rejects.toMatchObject({ status: 0, message: 'Too slow.' });
    await vi.advanceTimersByTimeAsync(25);
    await pending;
    vi.useRealTimers();
  });

  it('exposes a typed ApiError and encodes path segments', () => {
    expect(new ApiError('x', 409, 'raw', 'lean_query_retry', 2)).toMatchObject({
      message: 'x', status: 409, rawDetail: 'raw', code: 'lean_query_retry',
      retryAfterSeconds: 2,
    });
    expect(repoPath('a b', 'c/d')).toBe('/repositories/a%20b/c%2Fd');
    expect(blueprintPath('a b', 'c/d', 'e f')).toBe('/repositories/a%20b/c%2Fd/blueprints/e%20f');
  });
});
