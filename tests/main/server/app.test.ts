import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '@test/main/services/workspace/test-context';
import { DEFAULT_AGENT_CONFIG, type BlueprintRow } from '@main/store/rows';
import { buildApp, CONTENT_SECURITY_POLICY, SESSION_COOKIE, startLocalServer, type LocalServer } from '@main/server/app';

const FIXTURE = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../fixtures/sample-blueprint');
const TOKEN = 'test-token-0123456789abcdef';

let test: TestContext;
let rendererDir: string;
const servers: LocalServer[] = [];

function bearer(): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}` };
}

async function stop(server: LocalServer): Promise<void> {
  await server.close();
  servers.splice(servers.indexOf(server), 1);
}

beforeEach(() => {
  test = createTestContext();
  // A stand-in for the built renderer: index.html plus one hashed asset.
  rendererDir = join(test.root, 'renderer');
  mkdirSync(join(rendererDir, 'assets'), { recursive: true });
  writeFileSync(join(rendererDir, 'index.html'), '<!doctype html><script type="module" src="./assets/index-abc.js"></script>');
  writeFileSync(join(rendererDir, 'assets', 'index-abc.js'), 'console.log("app")');
});

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  test.cleanup();
});

describe('buildApp', () => {
  it('answers unknown /api paths with the JSON 404 envelope, not the SPA', async () => {
    const app = buildApp(test.ctx, TOKEN, rendererDir);
    for (const method of ['GET', 'POST', 'DELETE']) {
      const response = await app.request('/api/does-not-exist', { method, headers: bearer() });
      expect(response.status, method).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.json()).toEqual({ detail: 'Not found', code: 'http_404', request_id: 'local' });
    }
    // Known routes still work through the same mount.
    expect((await app.request('/api/health', { headers: bearer() })).status).toBe(200);
  });

  it('still requires authentication before the 404 fallback', async () => {
    const app = buildApp(test.ctx, TOKEN, rendererDir);
    const response = await app.request('/api/does-not-exist');
    expect(response.status).toBe(401);
  });

  it('serves the SPA for page paths with malformed percent-encoding', async () => {
    const app = buildApp(test.ctx, TOKEN, rendererDir);
    for (const path of ['/repo/%E0%A4%A', '/repo/%zz', '/repo/o/r']) {
      const response = await app.request(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).toContain('<!doctype html>');
    }
  });

  it('treats a malformed session cookie as absent instead of failing the request', async () => {
    const app = buildApp(test.ctx, TOKEN, rendererDir);
    const broken = await app.request('/api/health', { headers: { cookie: `${SESSION_COOKIE}=%E0%A4%A` } });
    expect(broken.status).toBe(401);
    const valid = await app.request('/api/health', { headers: { cookie: `other=%E0%A4%A; ${SESSION_COOKIE}=${TOKEN}` } });
    expect(valid.status).toBe(200);
  });

  it('sends the hardening headers with every static response', async () => {
    const app = buildApp(test.ctx, TOKEN, rendererDir);
    for (const path of ['/', '/repo/o/r/blueprint/x', '/assets/index-abc.js']) {
      const response = await app.request(path);
      expect(response.headers.get('content-security-policy'), path).toBe(CONTENT_SECURITY_POLICY);
      expect(response.headers.get('x-content-type-options'), path).toBe('nosniff');
      await response.text();
    }
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval ');
  });

  it('resolves relative asset URLs from deep routes, including slugs named "assets"', async () => {
    const app = buildApp(test.ctx, TOKEN, rendererDir);
    for (const path of [
      '/assets/index-abc.js',
      '/repo/o/r/blueprint/x/assets/index-abc.js',
      '/repo/owner/assets/blueprint/x/assets/index-abc.js',
      '/repo/assets/repo/assets/index-abc.js',
    ]) {
      const response = await app.request(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('content-type'), path).toContain('text/javascript');
      expect(await response.text()).toBe('console.log("app")');
    }
    // A miss inside /assets/ is a page, never a directory listing or a leak.
    const miss = await app.request('/assets/../../etc/passwd');
    expect(miss.headers.get('content-type')).toContain('text/html');
    await miss.text();
  });

  it('exchanges the token query for the session cookie and redirects to the clean route', async () => {
    const app = buildApp(test.ctx, TOKEN, rendererDir);
    const response = await app.request(`/repo/o/r?chat=abc&fuse_token=${TOKEN}`);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/repo/o/r?chat=abc');
    expect(response.headers.get('set-cookie')).toContain(`${SESSION_COOKIE}=${TOKEN}`);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    const wrong = await app.request('/repo/o/r?fuse_token=nope');
    expect(wrong.status).toBe(200);
    expect(wrong.headers.get('set-cookie')).toBeNull();
    await wrong.text();
  });
});

describe('startLocalServer', () => {
  it('builds an entry URL whose token survives a fragment in the restored route', async () => {
    const server = await startLocalServer(test.ctx, { rendererDir, token: TOKEN });
    servers.push(server);
    const withHash = new URL(server.entryUrl('/repo/o/r/blueprint/x#3.2'));
    expect(withHash.searchParams.get('fuse_token')).toBe(TOKEN);
    expect(withHash.hash).toBe('#3.2');
    expect(withHash.pathname).toBe('/repo/o/r/blueprint/x');
    const withQuery = new URL(server.entryUrl('/repo/o/r/blueprint/x?chat=abc'));
    expect(withQuery.searchParams.get('chat')).toBe('abc');
    expect(withQuery.searchParams.get('fuse_token')).toBe(TOKEN);
    expect(new URL(server.entryUrl()).pathname).toBe('/');
    // Round trip: the exchange middleware sees the token and redirects.
    const response = await fetch(server.entryUrl('/repo/o/r#3.2'), { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/repo/o/r');
    await response.text();
    await stop(server);
  });

  it('rejects instead of crashing when the fixed port is taken', async () => {
    const first = await startLocalServer(test.ctx, { rendererDir: null });
    servers.push(first);
    await expect(startLocalServer(test.ctx, { rendererDir: null, port: first.port })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    await stop(first);
  });

  it('closes promptly while an event-stream subscriber is connected', async () => {
    const repoDir = join(test.root, 'sample-blueprint');
    cpSync(FIXTURE, repoDir, { recursive: true, filter: (source) => !source.includes(join('sample-blueprint', '.lake')) });
    const repository = test.ctx.registry.addRepository(repoDir);
    const now = new Date().toISOString();
    const row: BlueprintRow = {
      id: 'sample',
      repository_id: repository.id,
      title: 'Sample',
      description: '',
      area: '',
      blueprint_file: 'blueprint/src/content.tex',
      project_subdir: '',
      source_type: 'none',
      source_id: null,
      pr_mode: 'off',
      auto_commit: false,
      orchestrator_child_concurrency: 1,
      agent: { ...DEFAULT_AGENT_CONFIG },
      created_at: now,
      updated_at: now,
    };
    test.ctx.registry.insertBlueprint(row);
    const server = await startLocalServer(test.ctx, { rendererDir: null, token: TOKEN });
    servers.push(server);
    const controller = new AbortController();
    const response = await fetch(`${server.baseUrl}/api/repositories/${repository.owner}/${repository.name}/blueprints/sample/events`, {
      headers: bearer(),
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    await reader.read(); // the first snapshot frame: the stream is live
    const started = Date.now();
    await Promise.race([
      stop(server),
      new Promise((_, reject) => setTimeout(() => reject(new Error('close() hung behind the SSE subscriber')), 5000)),
    ]);
    expect(Date.now() - started).toBeLessThan(2000);
    await reader.cancel().catch(() => undefined);
    controller.abort();
  });
});
