import { chmodSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '@main/server/app';
import type { AppSettings } from '@shared/desktop';
import type { snapshotLocalData } from '@main/data-export';
import { createTestContext, type TestContext } from '@test/main/services/workspace/test-context';
import { accessibleDirectory, listDirectories } from '@main/local-capabilities';

vi.mock('@main/agents/detect', () => ({ detectProviders: vi.fn(async () => [{ id: 'claude', available: true }]) }));
vi.mock('@main/agents/models', () => ({ listModels: vi.fn(async () => [{ value: 'test-model', label: 'Test model' }]) }));
let test: TestContext;
const token = 'local-capabilities-test';
beforeEach(() => { test = createTestContext(); });
afterEach(() => { test.cleanup(); });

function request(path: string, init?: RequestInit) {
  const separator = path.includes('?') ? '&' : '?';
  return buildApp(test.ctx, token, null).request(`/api/local${path}${separator}fuse_token=${token}`, init);
}

describe('HTTP local capabilities', () => {
  it('requires authentication and exposes the workstation data location', async () => {
    const app = buildApp(test.ctx, token, null);
    expect((await app.request('/api/local/settings')).status).toBe(401);
    const info = await (await request('/info')).json() as { platform: string; dataPath: string };
    expect(info.platform).toBe(process.platform);
    expect(info.dataPath).toBe(test.ctx.paths.userData);
    expect(await (await request('/storage')).json()).toEqual({ path: test.ctx.paths.userData });
  });

  it('persists valid settings patches and rejects invalid settings without saving', async () => {
    const before = test.ctx.settings.get();
    const saved = await request('/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ claudePath: '/opt/claude', agentDefaults: { provider: 'codex' }, notifications: { sound: false } }) });
    expect(saved.status).toBe(200);
    const value = await saved.json() as AppSettings;
    expect(value.agentDefaults).toEqual({ ...before.agentDefaults, provider: 'codex' });
    expect(value.notifications).toEqual({ ...before.notifications, sound: false });
    expect(await (await request('/settings')).json()).toEqual(value);
    const bad = await request('/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"claudePath":123}' });
    expect(bad.status).toBe(422);
    expect(test.ctx.settings.get()).toEqual(value);
  });

  it('exposes provider discovery and model lists with provider validation', async () => {
    expect(await (await request('/providers')).json()).toEqual([{ id: 'claude', available: true }]);
    expect(await (await request('/providers/codex/models')).json()).toEqual([{ value: 'test-model', label: 'Test model' }]);
    expect((await request('/providers/unknown/models')).status).toBe(422);
  });

  it('downloads an allowlisted snapshot without exporting arbitrary userData files', async () => {
    mkdirSync(test.ctx.paths.userData, { recursive: true });
    writeFileSync(join(test.ctx.paths.userData, 'Cookies'), 'secret');
    const response = await request('/storage/export');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('attachment;');
    const snapshot = await response.json() as ReturnType<typeof snapshotLocalData>;
    expect(snapshot.format).toBe('fuse-local-data');
    expect(snapshot.files.some((file: { path: string }) => file.path === 'settings.json')).toBe(true);
    expect(snapshot.files.some((file: { path: string }) => file.path === 'Cookies')).toBe(false);
  });
});

describe('workstation directory browser', () => {
  it('lists at most 30 visible accessible directories and filters before limiting', async () => {
    const root = join(test.root, 'folders');
    mkdirSync(root);
    for (let i = 0; i < 35; i++) mkdirSync(join(root, `folder-${String(i).padStart(2, '0')}`));
    mkdirSync(join(root, '.hidden'));
    writeFileSync(join(root, 'regular-file'), 'x');
    symlinkSync(join(root, 'missing'), join(root, 'broken-link'));
    const listing = await listDirectories(root);
    expect(listing.directories).toHaveLength(30);
    expect(listing.truncated).toBe(true);
    expect(listing.directories[0].name).toBe('folder-00');
    expect(listing.directories.every(entry => entry.name.startsWith('folder-'))).toBe(true);
    const filtered = await listDirectories(root, 'FOLDER-34');
    expect(filtered.directories).toEqual([{ name: 'folder-34', path: realpathSync(join(root, 'folder-34')) }]);
    expect(filtered.truncated).toBe(false);
    const response = await request(`/directories?path=${encodeURIComponent(root)}&filter=34`);
    expect((await response.json() as Awaited<ReturnType<typeof listDirectories>>).directories).toEqual(filtered.directories);
  });

  it('validates absolute accessible paths, rejects files and relative or missing paths', async () => {
    writeFileSync(join(test.root, 'file'), 'x');
    await expect(accessibleDirectory('relative')).rejects.toMatchObject({ status: 422 });
    await expect(accessibleDirectory(join(test.root, 'missing'))).rejects.toMatchObject({ status: 422 });
    await expect(accessibleDirectory(join(test.root, 'file'))).rejects.toMatchObject({ status: 422 });
    const valid = await request('/directories/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: test.root }) });
    expect(valid.status).toBe(200);
    expect((await valid.json() as { path: string }).path).toBe(realpathSync(test.root));
  });

  it.skipIf(process.getuid?.() === 0 || process.platform === 'win32')('omits directories without read and traversal permissions', async () => {
    const root = join(test.root, 'permissions');
    const denied = join(root, 'denied');
    mkdirSync(denied, { recursive: true });
    chmodSync(denied, 0);
    try {
      expect((await listDirectories(root)).directories).toEqual([]);
      await expect(accessibleDirectory(denied)).rejects.toMatchObject({ status: 422 });
    } finally { chmodSync(denied, 0o700); }
  });
});
