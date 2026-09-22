/**
 * Opt-in end-to-end test against the real Lean toolchain:
 *
 *   FUSE_LIVE_LEAN=1 npx vitest run tests/main/services/lean/lean.live.test.ts
 *
 * Copies the fixture project to a temp git repository, runs the build
 * pipeline through `LeanService`, then drives `lake serve` with goal, hover
 * and diagnostics queries exactly as the Infoview does.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppContext } from '@main/server/context';
import { SseRooms } from '@main/server/sse';
import { appPaths } from '@main/paths';
import { Registry } from '@main/store/registry';
import { DEFAULT_AGENT_CONFIG, type BlueprintRow } from '@main/store/rows';
import { roomKeyFor, type OpenProject } from '@main/services/types';
import { readSnapshot, SNAPSHOT_FILE } from '@main/services/lean/build/snapshot';
import { readBuildStamp } from '@main/services/lean/build/stamp';
import { LeanService } from '@main/services/lean/service';
import { DEFAULT_LEAN_SETTINGS } from '@main/services/lean/settings';

const live = process.env.FUSE_LIVE_LEAN === '1';
const FIXTURE = join(__dirname, '..', '..', '..', '..', 'fixtures', 'sample-blueprint');

describe.skipIf(!live)('LeanService against the real toolchain', () => {
  let dataDir: string;
  let repoDir: string;
  let ctx: AppContext;
  let project: OpenProject;
  let service: LeanService;

  beforeAll(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'fuse-live-data-'));
    repoDir = mkdtempSync(join(tmpdir(), 'fuse-live-repo-'));
    cpSync(FIXTURE, repoDir, { recursive: true });
    // The fixture ships build artifacts; start from a clean tree so the
    // pipeline really compiles.
    rmSync(join(repoDir, '.lake'), { recursive: true, force: true });
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: repoDir, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
    };
    git('init', '-q');
    git('add', '.');
    git('commit', '-q', '-m', 'fixture');
    const registry = new Registry(appPaths(dataDir));
    const repository = registry.addRepository(repoDir);
    const now = new Date().toISOString();
    const blueprint: BlueprintRow = {
      id: 'sample',
      repository_id: repository.id,
      title: 'sample',
      description: '',
      area: '',
      blueprint_file: 'blueprint/src/content.tex',
      project_subdir: '',
      source_type: 'tex',
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
    project = { repository, blueprint, clonePath: repoDir, projectSubdir: '', projectRoot: repoDir, blueprintFile: blueprint.blueprint_file, roomKey: roomKeyFor(repository, 'sample') };
    service = new LeanService(ctx, { settings: { ...DEFAULT_LEAN_SETTINGS, lspFileIdleTtlMs: 0 } });
  });

  afterAll(async () => {
    await service?.shutdown();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  });

  function phases(): string[] {
    return (ctx.blueprintRooms.get(project.roomKey).replayAfter(null) ?? []).filter((f) => f.event === 'build_status').map((f) => (f.data as { phase: string }).phase);
  }

  it('builds the project, records the stamp and the snapshot, then skips the rebuild', async () => {
    const outcome = await service.startBuild(project, { reason: 'session' });
    expect(outcome.error).toBeNull();
    expect(outcome.status).toBe('ok');
    expect(outcome.output?.exitCode).toBe(0);
    expect(phases()).toEqual(['preparing', 'building', 'complete']);
    expect(readBuildStamp(repoDir)?.outcome).toBe('ok');
    expect(existsSync(join(repoDir, SNAPSHOT_FILE))).toBe(true);
    // The fixture has a `sorry`, reported as a warning.
    expect(readSnapshot(repoDir)['Sample/Squares.lean']?.[0]).toMatchObject({ severity: 'warning', line: 9 });
    expect(service.errorCounts(project)).toEqual({ 'Sample/Squares.lean': { errors: 0, warnings: 1 } });
    expect(service.buildStatus(project).status).toBe('done');

    const again = await service.startBuild(project);
    expect(again.status).toBe('up_to_date');
    expect(phases().slice(-1)).toEqual(['up_to_date']);
  }, 180_000);

  it('answers goals, hover and diagnostics through lake serve', async () => {
    const file = 'Sample/Squares.lean';
    const goals = await service.goals(project, { file_path: file, line: 10, column: 3 });
    expect(goals.goals?.[0]).toContain('⊢ twice n ≤ square n');
    expect(goals.line_context).toBe('  unfold twice square');
    const after = await service.goals(project, { file_path: file, line: 11, column: 3 });
    expect(after.goals?.[0]).toContain('⊢ n + n ≤ n * n');
    expect(after.line_context).toBe('  sorry');

    const term = await service.goals(project, { file_path: file, line: 4, column: 31 });
    expect(term.goals).toEqual([]);
    expect(term.expected_type).toContain('Nat');

    const hover = await service.hover(project, { file_path: file, line: 4, column: 6 });
    expect(hover.contents).toContain('square');
    expect(hover.start_line).toBe(4);

    const diagnostics = await service.diagnostics(project, { file_path: file });
    expect(diagnostics.complete).toBe(true);
    expect(diagnostics.failed_dependencies).toEqual([]);
    expect(diagnostics.items.map((item) => item.severity)).toEqual(['warning']);
    expect(diagnostics.items[0]).toMatchObject({ line: 9, column: 9, end_line: 9, end_column: 24 });
    expect(service.cachedDiagnostics(project, { file_path: file }).items).toHaveLength(1);

    await expect(service.goals(project, { file_path: file, line: 999, column: 1 })).rejects.toMatchObject({ status: 400, code: 'lean_cursor_out_of_range' });
  }, 120_000);

  it('picks up saved edits on the next query and mirrors errors into the snapshot', async () => {
    const file = 'Sample/Squares.lean';
    const original = readFileSync(join(repoDir, file), 'utf8');
    await service.save(project, { file_path: file, content: original.replace('sorry', 'exact (by decide : (1 : Nat) = 2)') });
    const diagnostics = await service.diagnostics(project, { file_path: file });
    expect(diagnostics.complete).toBe(true);
    expect(diagnostics.items.some((item) => item.severity === 'error')).toBe(true);
    expect(service.errorCounts(project)[file]?.errors).toBeGreaterThan(0);
    const events = ctx.blueprintRooms.get(project.roomKey).replayAfter(null) ?? [];
    expect(events.some((frame) => frame.event === 'build_errors_updated')).toBe(true);
    await service.save(project, { file_path: file, content: original });
    expect((await service.reload(project, { file_path: file })).ok).toBe(true);
    const restored = await service.diagnostics(project, { file_path: file });
    expect(restored.items.map((item) => item.severity)).toEqual(['warning']);
    writeFileSync(join(repoDir, file), original);
  }, 120_000);

  it('runs a module build and rebuilds after a source change', async () => {
    const outcome = await service.startBuild(project, { target: 'Sample.Basic' });
    expect(outcome.status).toBe('ok');
    // Lake prints nothing for an up-to-date module, so only a rebuild lists it.
    expect(outcome.output?.exitCode).toBe(0);
    const file = 'Sample/Basic.lean';
    writeFileSync(join(repoDir, file), `${readFileSync(join(repoDir, file), 'utf8')}\ntheorem extra : twice 2 = 4 := by rfl\n`);
    const rebuilt = await service.startBuild(project, { target: 'Sample.Basic' });
    expect(rebuilt.status).toBe('ok');
    expect(rebuilt.output?.builtModules).toContain('Sample.Basic');
    const full = await service.startBuild(project);
    expect(full.status).toBe('ok');
    expect(full.output?.filesTotal).toBeGreaterThan(0);
  }, 180_000);
});
