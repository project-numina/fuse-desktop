import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '@main/server/context';
import { errorResponse } from '@main/server/errors';

const ONE_HOUR_MS = 3_600_000;

function context(listRepositories: () => unknown[] = () => []): AppContext {
  return {
    registry: { listRepositories },
  } as unknown as AppContext;
}

async function freshSystemModule() {
  vi.resetModules();
  return import('@main/server/routes/system');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('system routes', () => {
  it('serves health, deployment, push, and normalized Lean-version responses', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { name: 'v4.22.0', zipball_url: 'ignored' },
      { name: 42 },
      null,
      { name: 'v4.21.0' },
    ])));
    vi.stubGlobal('fetch', fetchMock);
    const { IDLE_DEPLOYMENT, systemRoutes } = await freshSystemModule();
    const listRepositories = vi.fn(() => [{}, {}, {}]);
    const app = new Hono().route('/api', systemRoutes(context(listRepositories)));

    const health = await app.request('/api/health');
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', repositories: 3 });
    expect(listRepositories).toHaveBeenCalledOnce();

    expect(await (await app.request('/api/deployment/status')).json()).toEqual(IDLE_DEPLOYMENT);
    expect(await (await app.request('/api/push/config')).json()).toEqual({
      enabled: false,
      vapid_public_key: null,
    });

    const versions = await app.request('/api/lean-versions');
    expect(versions.status).toBe(200);
    expect(await versions.json()).toEqual([{ name: 'v4.22.0' }, { name: 'v4.21.0' }]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/leanprover/lean4/tags?per_page=100',
      {
        headers: { Accept: 'application/vnd.github+json' },
        signal: expect.any(AbortSignal),
      },
    );
  });

  it('reuses a fresh Lean tag cache without calling the service again', async () => {
    const { fetchLean4Tags } = await freshSystemModule();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ name: 'v4.20.0' }])));

    expect(await fetchLean4Tags(fetchMock as unknown as typeof fetch)).toEqual([{ name: 'v4.20.0' }]);
    expect(await fetchLean4Tags(fetchMock as unknown as typeof fetch)).toEqual([{ name: 'v4.20.0' }]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('normalizes a non-list service payload to an empty release list', async () => {
    const { fetchLean4Tags } = await freshSystemModule();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ name: 'v4.20.0' })));

    expect(await fetchLean4Tags(fetchMock as unknown as typeof fetch)).toEqual([]);
  });

  it('falls back to an empty list when the release service is unavailable', async () => {
    let system = await freshSystemModule();
    const unavailable = vi.fn(async () => new Response('unavailable', { status: 503 }));
    expect(await system.fetchLean4Tags(unavailable as unknown as typeof fetch)).toEqual([]);

    system = await freshSystemModule();
    const offline = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await system.fetchLean4Tags(offline as unknown as typeof fetch)).toEqual([]);
  });

  it('serves stale releases when a refresh fails', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const { fetchLean4Tags } = await freshSystemModule();
    const available = vi.fn(async () => new Response(JSON.stringify([{ name: 'v4.19.0' }])));
    expect(await fetchLean4Tags(available as unknown as typeof fetch)).toEqual([{ name: 'v4.19.0' }]);

    now += ONE_HOUR_MS + 1;
    const unavailable = vi.fn(async () => new Response('unavailable', { status: 502 }));
    expect(await fetchLean4Tags(unavailable as unknown as typeof fetch)).toEqual([{ name: 'v4.19.0' }]);

    now += ONE_HOUR_MS + 1;
    const offline = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await fetchLean4Tags(offline as unknown as typeof fetch)).toEqual([{ name: 'v4.19.0' }]);
  });

  it('propagates a registry failure to the server error handler', async () => {
    const failure = new Error('registry unavailable');
    const listRepositories = vi.fn(() => {
      throw failure;
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { systemRoutes } = await freshSystemModule();
    const app = new Hono();
    app.onError((error, c) => errorResponse(c, error));
    app.route('/api', systemRoutes(context(listRepositories)));

    const response = await app.request('/api/health');
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      detail: 'Something went wrong on our side. Please try again.',
      code: 'http_500',
      request_id: expect.any(String),
    });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringMatching(/^\[api\] GET \/api\/health failed \(.+\):$/),
      failure,
    );
  });
});
