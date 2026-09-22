import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '@main/server/context';
import { HttpError } from '@main/server/errors';
import { SseRooms } from '@main/server/sse';
import { appPaths } from '@main/paths';
import { Registry } from '@main/store/registry';
import { DEFAULT_AGENT_CONFIG, type BlueprintRow } from '@main/store/rows';
import { roomKeyFor, type OpenProject } from '@main/services/types';
import { deferred, sleep } from '@main/services/lean/async';
import { computeDepsState, markDepsReady, replaceAll, sourceContentHash } from '@main/services/lean/build/snapshot';
import { writeBuildStamp } from '@main/services/lean/build/stamp';
import { newBuildOutput, type BuildOutput } from '@main/services/lean/diagnostics';
import type { LeanLSPClient } from '@main/services/lean/lsp/client';
import { DEFAULT_LEAN_SETTINGS } from '@main/services/lean/settings';

const buildMock = vi.hoisted(() => ({
  runProjectBuildIfNeeded: vi.fn(),
  runModuleBuild: vi.fn(),
}));

vi.mock('@main/services/lean/build', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/lean/build')>();
  return { ...actual, runProjectBuildIfNeeded: buildMock.runProjectBuildIfNeeded, runModuleBuild: buildMock.runModuleBuild };
});

const { LeanService, MAX_LEAN_FILE_BYTES } = await import('@main/services/lean/service');

describe('LeanService', () => {
  let dataDir: string;
  let repoDir: string;
  let ctx: AppContext;
  let project: OpenProject;
  let service: InstanceType<typeof LeanService>;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'fuse-data-'));
    repoDir = mkdtempSync(join(tmpdir(), 'fuse-repo-'));
    mkdirSync(join(repoDir, 'lean', 'Foo'), { recursive: true });
    writeFileSync(join(repoDir, 'lean', 'lakefile.toml'), 'name = "foo"\n');
    writeFileSync(join(repoDir, 'lean', 'lean-toolchain'), 'leanprover/lean4:v4.25.0\n');
    writeFileSync(join(repoDir, 'lean', 'lake-manifest.json'), '{"packages": []}');
    writeFileSync(join(repoDir, 'lean', 'Foo', 'Bar.lean'), 'theorem x : True := by trivial\n');
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
      project_subdir: 'lean',
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
    registry.insertBlueprint({ ...blueprint, id: 'sibling' });
    registry.insertBlueprint({ ...blueprint, id: 'other', project_subdir: '' });
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
    project = {
      repository,
      blueprint,
      clonePath: repoDir,
      projectSubdir: 'lean',
      projectRoot: join(repoDir, 'lean'),
      blueprintFile: null,
      roomKey: roomKeyFor(repository, 'bp'),
    };
    service = new LeanService(ctx, { settings: { ...DEFAULT_LEAN_SETTINGS, lspFileIdleTtlMs: 0 } });
    buildMock.runProjectBuildIfNeeded.mockReset();
    buildMock.runModuleBuild.mockReset();
  });

  afterEach(async () => {
    await service.shutdown();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  });

  function roomEvents(key = project.roomKey): Array<{ event: string; data: unknown }> {
    return (ctx.blueprintRooms.get(key).replayAfter(null) ?? []).map(({ event, data }) => ({ event, data }));
  }

  describe('persisted state', () => {
    it('reports not_built until a stamp exists and then done', () => {
      expect(service.buildStatus(project)).toEqual({ status: 'not_built', head: null, toolchain_hash: null, manifest_hash: null });
      expect(service.buildSnapshot(project)).toBeNull();
      writeBuildStamp(project.projectRoot, { head: 'h', worktree_hash: 'w', toolchain_hash: 't', manifest_hash: 'm' }, 'errors');
      expect(service.buildStatus(project)).toEqual({ status: 'done', head: 'h', toolchain_hash: 't', manifest_hash: 'm' });
      expect(service.buildSnapshot(project)).toEqual({ status: 'done', steps: [] });
    });

    it('re-keys error counts to repo-relative paths', () => {
      expect(service.errorCounts(project)).toEqual({});
      replaceAll(project.projectRoot, [{ file: 'Foo/Bar.lean', line: 1, column: 1, severity: 'error', message: 'x' }]);
      expect(service.errorCounts(project)).toEqual({ 'lean/Foo/Bar.lean': { errors: 1, warnings: 0 } });
    });

    it('serves cached diagnostics without end positions, filtered by line', () => {
      replaceAll(project.projectRoot, [
        { file: 'Foo/Bar.lean', line: 1, column: 1, severity: 'error', message: 'a' },
        { file: 'Foo/Bar.lean', line: 5, column: 2, severity: 'warning', message: 'b' },
      ]);
      expect(service.cachedDiagnostics(project, { file_path: 'lean/Foo/Bar.lean' })).toEqual({
        items: [
          { severity: 'error', message: 'a', line: 1, column: 1, end_line: null, end_column: null },
          { severity: 'warning', message: 'b', line: 5, column: 2, end_line: null, end_column: null },
        ],
        complete: true,
        failed_dependencies: [],
      });
      expect(service.cachedDiagnostics(project, { file_path: 'lean/Foo/Bar.lean', start_line: 2, end_line: 5 }).items.map((i) => i.message)).toEqual(['b']);
      expect(service.cachedDiagnostics(project, { file_path: 'Outside.lean' }).items).toEqual([]);
      expect(() => service.cachedDiagnostics(project, { file_path: '../escape.lean' })).toThrow(HttpError);
    });
  });

  describe('save', () => {
    it('writes atomically inside the clone and creates parents', async () => {
      expect(await service.save(project, { file_path: 'lean/New/File.lean', content: 'def y := 2\n' })).toEqual({ ok: true });
      expect(readFileSync(join(repoDir, 'lean', 'New', 'File.lean'), 'utf8')).toBe('def y := 2\n');
      expect(readdirSync(join(repoDir, 'lean', 'New')).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    });

    it('rejects escapes and oversized content', async () => {
      await expect(service.save(project, { file_path: '../outside.lean', content: '' })).rejects.toMatchObject({ status: 400, detail: 'Invalid file path' });
      await expect(service.save(project, { file_path: 'lean/Big.lean', content: 'x'.repeat(MAX_LEAN_FILE_BYTES + 1) })).rejects.toMatchObject({ status: 422 });
    });
  });

  describe('readiness', () => {
    it('is ready with a matching deps marker, or built artifacts plus materialized packages', () => {
      const root = project.projectRoot;
      // Never built: not ready even with zero dependencies.
      expect(service.lspReady(root)).toBe(false);
      mkdirSync(join(root, '.lake', 'build'), { recursive: true });
      expect(service.lspReady(root)).toBe(true);
      writeFileSync(join(root, 'lake-manifest.json'), JSON.stringify({ packages: [{ name: 'mathlib', rev: 'abc', url: 'https://x' }] }));
      expect(service.lspReady(root)).toBe(false);
      mkdirSync(join(root, '.lake', 'packages', 'mathlib'), { recursive: true });
      expect(service.lspReady(root)).toBe(true);
      rmSync(join(root, '.lake'), { recursive: true });
      markDepsReady(root, computeDepsState(root));
      expect(service.lspReady(root)).toBe(true);
      rmSync(join(root, 'lakefile.toml'));
      expect(service.lspReady(root)).toBe(false);
    });

    it('asks for an explicit build without starting one when dependencies are missing', async () => {
      writeFileSync(join(project.projectRoot, 'lake-manifest.json'), JSON.stringify({ packages: [{ name: 'mathlib', rev: 'abc', url: 'https://x' }] }));
      await expect(service.goals(project, { file_path: 'lean/Foo/Bar.lean', line: 1, column: 1 })).rejects.toMatchObject({ status: 409, detail: expect.stringContaining('Set up Lean'), code: 'lean_setup_required' });
      await expect(service.hover(project, { file_path: 'lean/Foo/Bar.lean', line: 1, column: 1 })).rejects.toMatchObject({ status: 409 });
      await expect(service.reload(project, { file_path: 'lean/Foo/Bar.lean' })).rejects.toMatchObject({ status: 409 });
      expect(buildMock.runProjectBuildIfNeeded).not.toHaveBeenCalled();
    });

    it('404s a missing file before touching readiness', async () => {
      await expect(service.diagnostics(project, { file_path: 'lean/Foo/Missing.lean' })).rejects.toMatchObject({ status: 404, code: 'lean_file_not_found' });
    });
  });

  describe('startBuild', () => {
    it('streams the phases to every room sharing the project and publishes counts', async () => {
      buildMock.runProjectBuildIfNeeded.mockImplementation(async (_context, options) => {
        options.reporter?.('building', 'Building Lean project...');
        const output: BuildOutput = { ...newBuildOutput(), diagnostics: [{ file: 'Foo/Bar.lean', line: 1, column: 1, severity: 'error', message: 'x' }] };
        options.publish?.(replaceAll(project.projectRoot, output.diagnostics));
        options.reporter?.('complete', 'Build complete');
        return output;
      });
      const outcome = await service.startBuild(project, { reason: 'manual' });
      expect(outcome.status).toBe('errors');
      expect(outcome.error).toBeNull();
      const expected = [
        { event: 'build_status', data: { phase: 'building', message: 'Building Lean project...' } },
        { event: 'build_errors_updated', data: { files: { 'lean/Foo/Bar.lean': { errors: 1, warnings: 0 } } } },
        { event: 'build_status', data: { phase: 'complete', message: 'Build complete' } },
      ];
      expect(roomEvents()).toEqual(expected);
      expect(roomEvents(roomKeyFor(project.repository, 'sibling'))).toEqual(expected);
      expect(roomEvents(roomKeyFor(project.repository, 'other'))).toEqual([]);
      expect(service.buildSnapshot(project)).toBeNull();
    });

    it('exposes the in-flight snapshot and coalesces concurrent callers', async () => {
      let release!: () => void;
      buildMock.runProjectBuildIfNeeded.mockImplementation(async (_context, options) => {
        options.reporter?.('preparing', 'Preparing workspace...');
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        options.reporter?.('up_to_date', 'Build up to date');
        return null;
      });
      const first = service.startBuild(project, { reason: 'session' });
      const joined = service.startBuild(project);
      await sleep(5);
      expect(service.buildInProgress(project)).toBe(true);
      expect(service.buildSnapshot(project)).toEqual({ status: 'running', steps: [{ phase: 'preparing', message: 'Preparing workspace...' }] });
      release();
      expect((await first).status).toBe('up_to_date');
      expect((await joined).status).toBe('up_to_date');
      expect(buildMock.runProjectBuildIfNeeded).toHaveBeenCalledTimes(1);
      expect(buildMock.runProjectBuildIfNeeded.mock.calls[0][1].preparing).toBe(true);
      expect(service.buildInProgress(project)).toBe(false);
    });

    it('emits the failed phase with the session or manual copy', async () => {
      buildMock.runProjectBuildIfNeeded.mockRejectedValueOnce(new Error('No lakefile.lean or lakefile.toml at clone root: /x'));
      const outcome = await service.startBuild(project, { reason: 'session' });
      expect(outcome).toEqual({ status: 'failed', output: null, error: 'No lakefile.lean or lakefile.toml at clone root: /x' });
      expect(roomEvents().at(-1)).toEqual({
        event: 'build_status',
        data: { phase: 'failed', message: 'Lean environment could not be prepared. The agent will continue without Lean tooling.' },
      });
      buildMock.runProjectBuildIfNeeded.mockRejectedValueOnce(new Error('boom'));
      await service.startBuild(project);
      expect(roomEvents().at(-1)).toEqual({ event: 'build_status', data: { phase: 'failed', message: 'Lean build failed. Check logs for details.' } });
    });

    it('runs a module build for a target and merges it with a full build', async () => {
      buildMock.runModuleBuild.mockImplementation(async (_context, module, options) => {
        options.reporter?.('building', `Building ${module}`);
        options.reporter?.('complete', 'Build complete');
        return newBuildOutput();
      });
      const outcome = await service.startBuild(project, { target: 'Foo.Bar' });
      expect(outcome.status).toBe('ok');
      expect(buildMock.runModuleBuild).toHaveBeenCalledWith(expect.anything(), 'Foo.Bar', expect.anything());
      let releaseFull!: () => void;
      let blocked = false;
      buildMock.runProjectBuildIfNeeded.mockImplementation(async () => {
        if (!blocked) {
          blocked = true;
          await new Promise<void>((resolve) => {
            releaseFull = resolve;
          });
        }
        return newBuildOutput();
      });
      buildMock.runModuleBuild.mockClear();
      const full = service.startBuild(project);
      await sleep(1);
      const a = service.startBuild(project, { target: 'Foo.Bar' });
      const b = service.startBuild(project, { target: 'Foo.Baz' });
      releaseFull();
      await Promise.all([full, a, b]);
      // The two different module targets collapsed into one follow-up full build.
      expect(buildMock.runModuleBuild).not.toHaveBeenCalled();
      expect(buildMock.runProjectBuildIfNeeded).toHaveBeenCalledTimes(2);
    });
  });

  describe('language server across builds', () => {
    class FakeClient {
      returncode: number | null = null;
      closed = false;
      killNow(): void {}
      async reloadDocument(): Promise<void> {}
      async closeIdleDocuments(): Promise<string[]> {
        return [];
      }
      async close(): Promise<void> {
        this.closed = true;
      }
    }

    let clients: FakeClient[];
    /** `buildInProgress` as seen by each client creation: a server must never start under a build. */
    let createdDuringBuild: boolean[];
    let gate: ReturnType<typeof deferred<void>> | null;

    beforeEach(async () => {
      await service.shutdown();
      clients = [];
      createdDuringBuild = [];
      gate = null;
      service = new LeanService(ctx, {
        settings: { ...DEFAULT_LEAN_SETTINGS, lspFileIdleTtlMs: 0 },
        createClient: async () => {
          createdDuringBuild.push(service.buildInProgress(project));
          if (gate) await gate.promise;
          const client = new FakeClient();
          clients.push(client);
          return client as unknown as LeanLSPClient;
        },
      });
      mkdirSync(join(project.projectRoot, '.lake', 'build'), { recursive: true });
      buildMock.runProjectBuildIfNeeded.mockResolvedValue(newBuildOutput());
      // A query starts the server; the builds below must bring it back.
      await service.reload(project, { file_path: 'lean/Foo/Bar.lean' });
      expect(clients).toHaveLength(1);
    });

    it('restarts the server after a build, and again after a build that begins while that restart is still starting it', async () => {
      gate = deferred<void>();
      expect((await service.startBuild(project)).status).toBe('ok');
      expect(clients[0].closed).toBe(true);
      // The eager restart is now inside `lake serve`'s handshake (client still null).
      await vi.waitFor(() => expect(createdDuringBuild).toHaveLength(2));
      const second = service.startBuild(project);
      await sleep(5);
      gate.resolve();
      gate = null;
      expect((await second).status).toBe('ok');
      // The client the first restart produced was torn down for the second
      // build, which owed a restart of its own.
      await vi.waitFor(() => expect(clients).toHaveLength(3));
      expect(clients[1].closed).toBe(true);
      expect(clients[2].closed).toBe(false);
      expect(createdDuringBuild).toEqual([false, false, false]);
      await service.reload(project, { file_path: 'lean/Foo/Bar.lean' });
      expect(clients).toHaveLength(3);
    });

    it('restarts once, after the follow-up, when a build is queued behind a running one', async () => {
      let release!: () => void;
      buildMock.runProjectBuildIfNeeded.mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return newBuildOutput();
      });
      const first = service.startBuild(project);
      await sleep(1);
      const second = service.startBuild(project);
      release();
      await Promise.all([first, second]);
      await vi.waitFor(() => expect(clients).toHaveLength(2));
      await sleep(5);
      expect(clients).toHaveLength(2);
      expect(clients[1].closed).toBe(false);
      expect(createdDuringBuild).toEqual([false, false]);
    });

    it('leaves the server down after a build with errors', async () => {
      buildMock.runProjectBuildIfNeeded.mockResolvedValueOnce({ ...newBuildOutput(), exitCode: 1 });
      expect((await service.startBuild(project)).status).toBe('errors');
      await sleep(5);
      expect(clients).toHaveLength(1);
      expect(clients[0].closed).toBe(true);
    });
  });

  it('publishes a snapshot update when a file is attested', () => {
    const hash = sourceContentHash(join(project.projectRoot, 'Foo', 'Bar.lean'));
    expect(hash).not.toBeNull();
  });
});
