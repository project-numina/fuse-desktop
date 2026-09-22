import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '@main/server/context';
import { errorResponse } from '@main/server/errors';
import { SseRooms } from '@main/server/sse';
import { appPaths } from '@main/paths';
import { Registry } from '@main/store/registry';
import { DEFAULT_AGENT_CONFIG, type BlueprintRow } from '@main/store/rows';
import { replaceAll } from '@main/services/lean/build/snapshot';
import { writeBuildStamp } from '@main/services/lean/build/stamp';
import { resetLeanVersionCache } from '@main/services/lean/versions';
import { getLeanService, leanRoutes, leanSystemRoutes, resolveProject } from '@main/server/routes/lean';

describe('lean routes', () => {
  let dataDir: string;
  let repoDir: string;
  let ctx: AppContext;
  let app: Hono;
  let base: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'fuse-route-data-'));
    repoDir = realpathSync(mkdtempSync(join(tmpdir(), 'fuse-route-repo-')));
    mkdirSync(join(repoDir, 'Foo'));
    writeFileSync(join(repoDir, 'lakefile.toml'), 'name = "foo"\n');
    writeFileSync(join(repoDir, 'Foo', 'Bar.lean'), 'theorem x : True := by trivial\n');
    const registry = new Registry(appPaths(dataDir));
    const repository = registry.addRepository(repoDir);
    const now = new Date().toISOString();
    const blueprint: BlueprintRow = {
      id: 'bp',
      repository_id: repository.id,
      title: 'bp',
      description: '',
      area: '',
      blueprint_file: null,
      project_subdir: '',
      source_type: 'none',
      source_id: null,
      pr_mode: 'off',
      auto_commit: false,
      orchestrator_child_concurrency: 1,
      agent: DEFAULT_AGENT_CONFIG,
      created_at: now,
      updated_at: now,
    };
    registry.insertBlueprint(blueprint);
    ctx = {
      paths: appPaths(dataDir),
      registry,
      settings: {} as AppContext['settings'],
      blueprintRooms: new SseRooms(() => ({})),
      sessionRooms: new SseRooms(() => ({})),
      resourcesDir: dataDir,
      server: null,
      services: {},
    };
    app = new Hono();
    app.onError((error, c) => errorResponse(c, error));
    app.route('/api/repositories', leanRoutes(ctx));
    app.route('/api', leanSystemRoutes(ctx));
    base = `/api/repositories/${repository.owner}/${repository.name}/blueprints/bp`;
    resetLeanVersionCache();
  });

  afterEach(async () => {
    const shutdown = ctx.services.shutdown as (() => Promise<void>) | undefined;
    await shutdown?.();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  const post = (path: string, body: unknown): Promise<Response> =>
    Promise.resolve(app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

  it('registers the service singleton and chains the shutdown hook', async () => {
    const previous = vi.fn(async () => {});
    const fresh: AppContext = { ...ctx, services: { shutdown: previous } };
    const service = getLeanService(fresh);
    expect(getLeanService(fresh)).toBe(service);
    expect(fresh.services.lean).toBe(service);
    await (fresh.services.shutdown as () => Promise<void>)();
    expect(previous).toHaveBeenCalledTimes(1);
  });

  it('resolves the project from the registry when no blueprint service exists, else through it', () => {
    const project = resolveProject(ctx, ctx.registry.listRepositories()[0].owner, ctx.registry.listRepositories()[0].name, 'bp');
    expect(project.projectRoot).toBe(project.clonePath);
    expect(project.roomKey).toBe(`${project.repository.owner}/${project.repository.name}/bp`);
    expect(() => resolveProject(ctx, 'nope', 'nope', 'bp')).toThrow(/Repository not found/);
    const openProject = vi.fn(() => project);
    expect(resolveProject({ ...ctx, services: { blueprints: { openProject } } }, 'a', 'b', 'c')).toBe(project);
    expect(openProject).toHaveBeenCalledWith('a', 'b', 'c');
  });

  it('serves repository setup status and persists opt-out without starting a build', async () => {
    const setupPath = `${base}/lean/setup`;
    const lean = getLeanService(ctx);
    const start = vi.spyOn(lean, 'startBuild');
    const response = await app.request(setupPath);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ dismissed: false, projects: [{ directory: '', ready: false }] });
    expect((await post(`${setupPath}/preference`, { dismissed: true })).status).toBe(200);
    expect(await (await app.request(setupPath)).json()).toMatchObject({ dismissed: true });
    expect((await post(`${setupPath}/preference`, { dismissed: 'yes' })).status).toBe(422);
    expect(start).not.toHaveBeenCalled();
    expect((await app.request(base.replace('/blueprints/bp', '/lean-setup'))).status).toBe(404);
    start.mockResolvedValue({ status: 'ok', error: null, output: null });
    expect((await post(setupPath, { directory: '../outside' })).status).toBe(202);
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(start.mock.calls[0][0]).toMatchObject({ projectRoot: repoDir, projectSubdir: '', blueprint: { id: 'bp' } });
    start.mockRestore();
  });

  it('uses the workspace lakefile even when other projects exist in the repository', async () => {
    const repository = ctx.registry.listRepositories()[0];
    mkdirSync(join(repoDir, 'chosen'));
    writeFileSync(join(repoDir, 'chosen', 'lakefile.toml'), 'name = "chosen"');
    ctx.registry.updateBlueprint(repository.id, 'bp', { project_subdir: 'chosen' });
    const response = await app.request(`${base}/lean/setup`);
    const status = await response.json() as { projects: Array<{ directory: string }> };
    expect(status.projects).toHaveLength(1);
    expect(status.projects[0].directory).toBe('chosen');
    ctx.registry.updateBlueprint(repository.id, 'bp', { project_subdir: 'no-lakefile' });
    expect(await (await app.request(`${base}/lean/setup`)).json()).toMatchObject({ projects: [] });
  });

  it('serves build-status and cached diagnostics', async () => {
    let response = await app.request(`${base}/build-status`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'not_built', head: null, toolchain_hash: null, manifest_hash: null });
    writeBuildStamp(repoDir, { head: 'h', worktree_hash: 'w', toolchain_hash: 't', manifest_hash: 'm' });
    response = await app.request(`${base}/build-status`);
    expect(await response.json()).toMatchObject({ status: 'done', head: 'h' });

    replaceAll(repoDir, [{ file: 'Foo/Bar.lean', line: 3, column: 1, severity: 'warning', message: 'w' }]);
    response = await post(`${base}/lean/diagnostics/cached`, { file_path: 'Foo/Bar.lean' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [{ severity: 'warning', message: 'w', line: 3, column: 1, end_line: null, end_column: null }], complete: true, failed_dependencies: [] });
  });

  it('validates bodies with 422s', async () => {
    expect((await post(`${base}/lean/goals`, { file_path: 'Foo/Bar.lean', line: 0 })).status).toBe(422);
    expect((await post(`${base}/lean/goals`, { file_path: 1, line: 1 })).status).toBe(422);
    expect((await post(`${base}/lean/hover`, { file_path: 'Foo/Bar.lean', line: 1 })).status).toBe(422);
    expect((await post(`${base}/lean/save`, { file_path: 'Foo/Bar.lean' })).status).toBe(422);
    const bad = await app.request(`${base}/lean/diagnostics`, { method: 'POST', body: 'nope' });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ code: 'validation_error' });
  });

  it('404s an unknown blueprint and a missing file', async () => {
    expect((await post(`${base.replace('/bp', '/missing')}/lean/goals`, { file_path: 'Foo/Bar.lean', line: 1 })).status).toBe(404);
    const response = await post(`${base}/lean/goals`, { file_path: 'Foo/Nope.lean', line: 1, column: 1 });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'lean_file_not_found' });
  });

  it('saves files atomically and rejects escapes', async () => {
    const response = await post(`${base}/lean/save`, { file_path: 'Foo/Bar.lean', content: 'def y := 2\n' });
    expect(await response.json()).toEqual({ ok: true });
    expect(readFileSync(join(repoDir, 'Foo', 'Bar.lean'), 'utf8')).toBe('def y := 2\n');
    expect((await post(`${base}/lean/save`, { file_path: '../x.lean', content: '' })).status).toBe(400);
  });

  it('answers 409 with explicit build instructions when the project has never been built', async () => {
    const response = await post(`${base}/lean/reload`, { file_path: 'Foo/Bar.lean' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ detail: expect.stringContaining('Set up Lean to enable proof goals') });
  });

  it('starts builds and validates the target', async () => {
    const service = getLeanService(ctx);
    const startBuild = vi.spyOn(service, 'startBuild').mockResolvedValue({ status: 'ok', output: null, error: null });
    let response = await post(`${base}/build`, { target: 'not a module' });
    expect(response.status).toBe(422);
    response = await app.request(`${base}/build`, { method: 'POST' });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: 'started' });
    expect(startBuild).toHaveBeenLastCalledWith(expect.anything(), { reason: 'manual', target: undefined });
    response = await post(`${base}/build`, { target: 'Foo.Bar', wait: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', error: null, message: '' });
    expect(startBuild).toHaveBeenLastCalledWith(expect.anything(), { reason: 'manual', target: 'Foo.Bar' });
  });

  it('lists Lean versions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ tag_name: 'v4.25.0' }]))));
    const response = await app.request('/api/lean-versions');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ name: 'v4.25.0' }]);
  });
});
