import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const processMocks = vi.hoisted(() => ({ runToolCollect: vi.fn() }));

vi.mock('@main/services/lean/process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/lean/process')>();
  return { ...actual, runToolCollect: processMocks.runToolCollect };
});

import { AbortError } from '@main/services/lean/async';
import {
  buildClone,
  persistedBuildStatus,
  readPackageRevisions,
  runFreshProjectBuild,
  runModuleBuild,
  runProjectBuildIfNeeded,
  type BuildPhase,
} from '@main/services/lean/build';
import { depsReady, readSnapshot, replaceAll } from '@main/services/lean/build/snapshot';
import { readBuildStamp, writeBuildStamp } from '@main/services/lean/build/stamp';
import { newBuildOutput, type BuildOutput, type Diagnostic } from '@main/services/lean/diagnostics';
import { workspaceExecutionContext } from '@main/services/lean/paths';
import { DEFAULT_LEAN_SETTINGS } from '@main/services/lean/settings';

function output(overrides: Partial<BuildOutput> = {}): BuildOutput {
  return { ...newBuildOutput(), ...overrides };
}

describe('Lean build orchestration', () => {
  let repository: string;
  let project: string;
  let context: ReturnType<typeof workspaceExecutionContext>;

  beforeEach(() => {
    processMocks.runToolCollect.mockReset();
    repository = mkdtempSync(join(tmpdir(), 'fuse-build-test-'));
    project = join(repository, 'LeanProject');
    mkdirSync(join(project, 'Foo'), { recursive: true });
    writeFileSync(join(project, 'lakefile.toml'), 'name = "example"\n');
    writeFileSync(join(project, 'Foo', 'Bar.lean'), 'theorem ok : True := by trivial\n');
    context = workspaceExecutionContext(repository, 'LeanProject');
    repository = context.repositoryRoot;
    project = context.projectRoot;
  });

  afterEach(() => {
    rmSync(repository, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('readPackageRevisions', () => {
    it('accepts flat and nested git entries while rejecting unsafe or incomplete records', () => {
      writeFileSync(join(project, 'lake-manifest.json'), JSON.stringify({ packages: [
        { name: 'mathlib', rev: 'abc-123', url: 'https://example.test/mathlib' },
        { git: { name: 'batteries', rev: 'v1.0.0', url: 'https://example.test/batteries' } },
        { name: '../escape', rev: 'abc', url: 'https://example.test/bad' },
        { name: 'missing-url', rev: 'abc' },
        null,
      ] }));

      expect(readPackageRevisions(project)).toEqual({
        mathlib: { rev: 'abc-123', url: 'https://example.test/mathlib' },
        batteries: { rev: 'v1.0.0', url: 'https://example.test/batteries' },
      });
    });

    it('returns null for missing, malformed, empty, and wrongly shaped manifests', () => {
      expect(readPackageRevisions(project)).toBeNull();
      for (const manifest of ['{', 'null', '{}', '{"packages":{}}', '{"packages":[{"name":"x"}]}']) {
        writeFileSync(join(project, 'lake-manifest.json'), manifest);
        expect(readPackageRevisions(project)).toBeNull();
      }
    });
  });

  describe('buildClone', () => {
    it('resolves a cold manifest, tries the Mathlib cache, opens the dependency gate, and runs Lake', async () => {
      const phases: Array<[BuildPhase, string]> = [];
      const cacheRunner = vi.fn(async (_root: string, args: string[]) => {
        if (args[0] === 'update') {
          writeFileSync(join(project, 'lake-manifest.json'), JSON.stringify({
            packages: [{ git: { name: 'mathlib', rev: 'v4.19.0', url: 'https://example.test/mathlib' } }],
          }));
          return { exitCode: 0, output: 'updated' };
        }
        return { exitCode: 7, output: 'cache unavailable' };
      });
      const lakeRunner = vi.fn().mockResolvedValue({ exitCode: 2, output: output({ unscopedErrors: ['compile failed'] }) });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const result = await buildClone(project, {
        settings: DEFAULT_LEAN_SETTINGS,
        repositoryPath: repository,
        cacheRunner,
        lakeRunner,
        reporter: (phase, message) => phases.push([phase, message]),
      });

      expect(cacheRunner.mock.calls.map((call) => call.slice(1))).toEqual([
        [['update'], DEFAULT_LEAN_SETTINGS.lakeUpdateTimeoutMs],
        [['exe', 'cache', 'get'], DEFAULT_LEAN_SETTINGS.lakeCacheGetTimeoutMs],
      ]);
      expect(lakeRunner).toHaveBeenCalledWith(project, ['build'], {
        settings: DEFAULT_LEAN_SETTINGS,
        timeoutMs: DEFAULT_LEAN_SETTINGS.leanBuildTimeoutMs,
        signal: undefined,
      });
      expect(result.exitCode).toBe(2);
      expect(phases.map(([phase]) => phase)).toEqual(['resolving_deps', 'downloading_cache', 'building']);
      expect(depsReady(project)).toBe(true);
      expect(warn).toHaveBeenCalledWith('[lean] lake exe cache get exited 7; continuing with a source build');
    });

    it('treats ordinary cache timeouts as soft but propagates cancellation', async () => {
      writeFileSync(join(project, 'lake-manifest.json'), JSON.stringify({ packages: [{ name: 'mathlib', rev: 'abc', url: 'https://example.test' }] }));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const lakeRunner = vi.fn().mockResolvedValue({ exitCode: 0, output: output() });
      const timeout = new Error('cache timed out');

      await expect(buildClone(project, {
        settings: DEFAULT_LEAN_SETTINGS,
        cacheRunner: vi.fn().mockRejectedValue(timeout),
        lakeRunner,
      })).resolves.toMatchObject({ exitCode: 0 });
      expect(warn).toHaveBeenCalledWith('[lean] lake exe cache get failed: cache timed out');
      expect(lakeRunner).toHaveBeenCalledOnce();

      rmSync(join(project, '.lake'), { recursive: true, force: true });
      lakeRunner.mockClear();
      const cancelled = new AbortError('cancelled');
      await expect(buildClone(project, {
        settings: DEFAULT_LEAN_SETTINGS,
        cacheRunner: vi.fn().mockRejectedValue(cancelled),
        lakeRunner,
      })).rejects.toBe(cancelled);
      expect(lakeRunner).not.toHaveBeenCalled();
      expect(depsReady(project)).toBe(false);
    });

    it('uses the bounded process runner for cache retrieval when no test runner is injected', async () => {
      processMocks.runToolCollect.mockImplementation(async (_command: string, args: string[]) => {
        if (args[0] === 'update') {
          writeFileSync(join(project, 'lake-manifest.json'), JSON.stringify({ packages: [{ name: 'mathlib', rev: 'abc', url: 'https://example.test' }] }));
        }
        return { exitCode: 0, output: 'completed' };
      });
      const lakeRunner = vi.fn().mockResolvedValue({ exitCode: 0, output: output() });
      const settings = { ...DEFAULT_LEAN_SETTINGS, mathlibDownloadCacheDir: '/tmp/fuse-mathlib-cache' };

      await buildClone(project, { settings, lakeRunner });

      expect(processMocks.runToolCollect).toHaveBeenNthCalledWith(1, 'lake', ['update'], expect.objectContaining({
        cwd: project,
        timeoutMs: settings.lakeUpdateTimeoutMs,
        signal: undefined,
      }));
      expect(processMocks.runToolCollect).toHaveBeenNthCalledWith(2, 'lake', ['exe', 'cache', 'get'], expect.objectContaining({
        cwd: project,
        timeoutMs: settings.lakeCacheGetTimeoutMs,
        signal: undefined,
        env: expect.objectContaining({ MATHLIB_CACHE_DIR: '/tmp/fuse-mathlib-cache' }),
      }));
      expect(lakeRunner).toHaveBeenCalledOnce();
    });

    it('clears dependency readiness when the bounded Lake build rejects', async () => {
      writeFileSync(join(project, 'lake-manifest.json'), '{"packages":[]}');
      const timeout = new Error('lake build timed out after 900000ms');

      await expect(buildClone(project, {
        settings: DEFAULT_LEAN_SETTINGS,
        lakeRunner: vi.fn().mockRejectedValue(timeout),
      })).rejects.toBe(timeout);
      expect(depsReady(project)).toBe(false);
    });

    it('fails before building when dependency resolution fails or the project context is invalid', async () => {
      const lakeRunner = vi.fn();
      await expect(buildClone(project, {
        settings: DEFAULT_LEAN_SETTINGS,
        cacheRunner: vi.fn().mockResolvedValue({ exitCode: 1, output: `prefix\n${'x'.repeat(2100)}` }),
        lakeRunner,
      })).rejects.toThrow(/lake update failed \(exit 1\): x{100}/);
      expect(lakeRunner).not.toHaveBeenCalled();

      rmSync(join(project, 'lakefile.toml'));
      await expect(buildClone(project, { settings: DEFAULT_LEAN_SETTINGS, lakeRunner })).rejects.toThrow('No lakefile.lean or lakefile.toml');
      await expect(buildClone(project, { settings: DEFAULT_LEAN_SETTINGS, repositoryPath: join(repository, 'Other'), lakeRunner })).rejects.toThrow(
        'Lean project path must be contained in its repository',
      );
    });
  });

  describe('project builds and persisted status', () => {
    it('records diagnostics, publishes a snapshot, and skips a matching second build', async () => {
      writeFileSync(join(project, 'lake-manifest.json'), '{"packages":[]}');
      const diagnostic: Diagnostic = { file: 'Foo/Bar.lean', line: 1, column: 1, severity: 'error', message: 'broken' };
      const buildRunner = vi.fn().mockResolvedValue(output({ diagnostics: [diagnostic] }));
      const reporter = vi.fn();
      const publish = vi.fn();

      const first = await runProjectBuildIfNeeded(context, {
        settings: DEFAULT_LEAN_SETTINGS,
        preparing: true,
        buildRunner,
        reporter,
        publish,
      });

      expect(first?.diagnostics).toEqual([diagnostic]);
      expect(buildRunner).toHaveBeenCalledWith(project, expect.objectContaining({
        repositoryPath: repository,
        linkDependencies: true,
      }));
      expect(reporter).toHaveBeenNthCalledWith(1, 'preparing', 'Preparing workspace...');
      expect(reporter).toHaveBeenLastCalledWith('complete', 'Build complete');
      expect(publish).toHaveBeenCalledWith({ 'Foo/Bar.lean': [diagnostic] });
      expect(readBuildStamp(project)?.outcome).toBe('errors');

      buildRunner.mockClear();
      reporter.mockClear();
      await expect(runProjectBuildIfNeeded(context, { settings: DEFAULT_LEAN_SETTINGS, buildRunner, reporter })).resolves.toBeNull();
      expect(buildRunner).not.toHaveBeenCalled();
      expect(reporter).toHaveBeenCalledWith('up_to_date', 'Build up to date');
    });

    it('rebuilds changed sources without relinking unchanged dependencies', async () => {
      writeFileSync(join(project, 'lean-toolchain'), 'leanprover/lean4:v4.19.0\n');
      writeFileSync(join(project, 'lake-manifest.json'), '{"packages":[]}');
      const buildRunner = vi.fn().mockResolvedValue(output());
      await runProjectBuildIfNeeded(context, { settings: DEFAULT_LEAN_SETTINGS, buildRunner });

      writeFileSync(join(project, 'Foo', 'Bar.lean'), 'theorem changed : True := by trivial\n');
      buildRunner.mockClear();
      await runProjectBuildIfNeeded(context, { settings: DEFAULT_LEAN_SETTINGS, buildRunner });
      expect(buildRunner).toHaveBeenCalledWith(project, expect.objectContaining({ linkDependencies: false }));
    });

    it('fresh builds delete old stamps and preserve the last snapshot on infrastructure failure', async () => {
      writeFileSync(join(project, 'lake-manifest.json'), '{"packages":[]}');
      replaceAll(project, [{ file: 'Foo/Bar.lean', line: 2, column: 3, severity: 'warning', message: 'old' }]);
      writeBuildStamp(project, { head: 'old', worktree_hash: 'old', toolchain_hash: 'old', manifest_hash: 'old' });
      const publish = vi.fn();
      const buildRunner = vi.fn().mockResolvedValue(output({ exitCode: 1, unscopedErrors: ['worker died'] }));

      await runFreshProjectBuild(context, { settings: DEFAULT_LEAN_SETTINGS, buildRunner, publish });

      expect(readBuildStamp(project)?.outcome).toBe('errors');
      expect(publish).toHaveBeenCalledWith({
        'Foo/Bar.lean': [{ file: 'Foo/Bar.lean', line: 2, column: 3, severity: 'warning', message: 'old' }],
      });
      expect(buildRunner).toHaveBeenCalledWith(project, expect.not.objectContaining({ linkDependencies: expect.anything() }));
    });

    it('maps a missing stamp and an existing stamp to the persisted API status', () => {
      expect(persistedBuildStatus(project)).toEqual({ status: 'not_built', head: null, toolchain_hash: null, manifest_hash: null });
      writeBuildStamp(project, { head: 'abc', worktree_hash: 'dirty', toolchain_hash: 'tool', manifest_hash: 'manifest' });
      expect(persistedBuildStatus(project)).toEqual({ status: 'done', head: 'abc', toolchain_hash: 'tool', manifest_hash: 'manifest' });
    });
  });

  describe('module builds', () => {
    it('updates only the requested and reported modules, retaining unrelated diagnostics', async () => {
      writeFileSync(join(project, 'Foo', 'Other.lean'), 'def other := 1\n');
      replaceAll(project, [
        { file: 'Foo/Bar.lean', line: 1, column: 1, severity: 'error', message: 'stale target' },
        { file: 'Foo/Other.lean', line: 1, column: 1, severity: 'warning', message: 'retain me' },
      ]);
      const fresh: Diagnostic = { file: 'Foo/Generated.lean', line: 4, column: 2, severity: 'error', message: 'new error' };
      const lakeRunner = vi.fn().mockResolvedValue({
        exitCode: 1,
        output: output({ diagnostics: [fresh], builtModules: ['Foo.Generated'] }),
      });
      const reporter = vi.fn();
      const publish = vi.fn();

      const result = await runModuleBuild(context, 'Foo.Bar', {
        settings: DEFAULT_LEAN_SETTINGS,
        lakeRunner,
        reporter,
        publish,
      });

      expect(result.exitCode).toBe(1);
      expect(lakeRunner).toHaveBeenCalledWith(project, ['build', 'Foo.Bar'], expect.objectContaining({
        timeoutMs: DEFAULT_LEAN_SETTINGS.leanBuildTimeoutMs,
      }));
      expect(publish).toHaveBeenCalledWith({
        'Foo/Bar.lean': [],
        'Foo/Other.lean': [expect.objectContaining({ message: 'retain me' })],
        'Foo/Generated.lean': [fresh],
      });
      expect(reporter.mock.calls).toEqual([
        ['building', 'Building Foo.Bar'],
        ['complete', 'Build complete'],
      ]);
    });

    it('publishes the previous snapshot for a non-diagnostic infrastructure failure', async () => {
      const previous = { file: 'Foo/Bar.lean', line: 1, column: 1, severity: 'error', message: 'previous' } satisfies Diagnostic;
      replaceAll(project, [previous]);
      const publish = vi.fn();

      await runModuleBuild(context, 'Foo.Bar', {
        settings: DEFAULT_LEAN_SETTINGS,
        lakeRunner: vi.fn().mockResolvedValue({ exitCode: 9, output: output() }),
        publish,
      });

      expect(publish).toHaveBeenCalledWith({ 'Foo/Bar.lean': [previous] });
      expect(readSnapshot(project)).toEqual({ 'Foo/Bar.lean': [previous] });
    });

    it('rejects before invoking Lake when the lakefile is missing or the signal is already aborted', async () => {
      const lakeRunner = vi.fn();
      rmSync(join(project, 'lakefile.toml'));
      await expect(runModuleBuild(context, 'Foo.Bar', { settings: DEFAULT_LEAN_SETTINGS, lakeRunner })).rejects.toThrow('No lakefile.lean or lakefile.toml');

      writeFileSync(join(project, 'lakefile.toml'), 'name = "example"\n');
      const controller = new AbortController();
      controller.abort();
      await expect(runModuleBuild(context, 'Foo.Bar', { settings: DEFAULT_LEAN_SETTINGS, lakeRunner, signal: controller.signal })).rejects.toBeInstanceOf(AbortError);
      expect(lakeRunner).not.toHaveBeenCalled();
      expect(existsSync(join(project, '.lake', '.build.lock'))).toBe(false);
    });
  });
});
