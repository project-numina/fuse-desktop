import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blueprintBasePath, FuseApiClient, FuseApiError, internalBasePath } from '@mcp/client';
import { readFuseEnv } from '@mcp/env';

describe('readFuseEnv', () => {
  const base = {
    FUSE_API_URL: 'http://127.0.0.1:8765/',
    FUSE_API_TOKEN: 'tok',
    FUSE_OWNER: 'local',
    FUSE_REPO: 'repo',
    FUSE_BLUEPRINT: 'bp',
  };

  it('reads the launch variables and trims the trailing slash of the base URL', () => {
    const env = readFuseEnv({ ...base, FUSE_REPO_PATH: '/r', FUSE_PROJECT_ROOT: '/r/lean' }, '/cwd');
    expect(env).toEqual({
      apiUrl: 'http://127.0.0.1:8765',
      apiToken: 'tok',
      owner: 'local',
      repo: 'repo',
      blueprint: 'bp',
      repoPath: resolve('/r'),
      projectRoot: resolve('/r/lean'),
    });
  });

  it('defaults the roots to each other and then to the working directory', () => {
    expect(readFuseEnv({ ...base, FUSE_REPO_PATH: '/r' }, '/cwd').projectRoot).toBe(resolve('/r'));
    expect(readFuseEnv({ ...base, FUSE_PROJECT_ROOT: '/p' }, '/cwd').repoPath).toBe(resolve('/p'));
    const fallback = readFuseEnv(base, '/cwd');
    expect(fallback.repoPath).toBe(resolve('/cwd'));
    expect(fallback.projectRoot).toBe(resolve('/cwd'));
  });

  it('names every missing variable', () => {
    expect(() => readFuseEnv({ FUSE_API_URL: 'x' }, '/cwd')).toThrow('missing environment variable(s) FUSE_API_TOKEN, FUSE_OWNER, FUSE_REPO, FUSE_BLUEPRINT');
  });
});

describe('route paths', () => {
  it('encodes route segments', () => {
    const env = { owner: 'a b', repo: 'r/x', blueprint: 'bp' };
    expect(blueprintBasePath(env)).toBe('/api/repositories/a%20b/blueprints/bp'.replace('/blueprints', '/r%2Fx/blueprints'));
    expect(internalBasePath(env)).toBe('/api/internal/a%20b/r%2Fx/bp');
  });
});

describe('FuseApiClient', () => {
  function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch {
    return ((input: string | URL | Request, init?: RequestInit) => handler(String(input), init ?? {})) as typeof fetch;
  }

  it('posts JSON with the bearer token and parses the response', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const client = new FuseApiClient({
      baseUrl: 'http://127.0.0.1:1/',
      token: 't',
      fetch: fakeFetch((url, init) => {
        seen = { url, init };
        return new Response('{"ok":true}', { status: 200 });
      }),
    });
    await expect(client.post('/api/x', { a: 1 })).resolves.toEqual({ ok: true });
    expect(seen!.url).toBe('http://127.0.0.1:1/api/x');
    expect(seen!.init.method).toBe('POST');
    expect(seen!.init.body).toBe('{"a":1}');
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe('Bearer t');
  });

  it('maps the error envelope to FuseApiError with code and Retry-After', async () => {
    const client = new FuseApiClient({
      baseUrl: 'http://127.0.0.1:1',
      token: 't',
      fetch: fakeFetch(() => new Response(JSON.stringify({ detail: 'busy', code: 'lean_build_in_progress', request_id: 'r' }), { status: 409, headers: { 'retry-after': '2' } })),
    });
    const error = await client.post('/api/x', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FuseApiError);
    expect(error).toMatchObject({ status: 409, detail: 'busy', code: 'lean_build_in_progress', retryAfterSeconds: 2 });
  });

  it('falls back to the raw body for non-JSON errors and reports unreachable servers', async () => {
    const plain = new FuseApiClient({ baseUrl: 'http://127.0.0.1:1', token: 't', fetch: fakeFetch(() => new Response('gateway down', { status: 502 })) });
    await expect(plain.get('/api/x')).rejects.toMatchObject({ status: 502, detail: 'gateway down' });
    const down = new FuseApiClient({
      baseUrl: 'http://127.0.0.1:1',
      token: 't',
      fetch: fakeFetch(() => {
        throw new TypeError('fetch failed');
      }),
    });
    await expect(down.get('/api/x')).rejects.toMatchObject({ status: 503, code: 'unreachable' });
  });

  it('times out slow requests', async () => {
    const client = new FuseApiClient({
      baseUrl: 'http://127.0.0.1:1',
      token: 't',
      timeoutMs: 20,
      fetch: fakeFetch(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ),
    });
    await expect(client.get('/api/slow')).rejects.toMatchObject({ status: 504, code: 'timeout' });
  });
});
