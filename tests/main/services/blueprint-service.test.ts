import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '@main/server/errors';
import type { SseFrame } from '@main/server/sse';
import { DEFAULT_AGENT_CONFIG, type BlueprintRow, type ConversationRow, type RepositoryRow } from '@main/store/rows';
import { BlueprintService, type WorkspacePorts } from '@main/services/blueprint-service';
import { createTestContext, type TestContext } from '@test/main/services/workspace/test-context';

const FIXTURE = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../fixtures/sample-blueprint');
const ENTRYPOINT = 'blueprint/src/content.tex';
const FIXTURE_LABELS = ['def:twice', 'lem:twice-zero', 'thm:twice-eq', 'def:square', 'thm:twice-le-square', 'conj:cube'];

let test: TestContext;
let repoDir: string;
let repository: RepositoryRow;
let service: BlueprintService;
let workspacePorts: WorkspacePorts;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
}

function initRepo(cwd: string): void {
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'Test User');
  git(cwd, 'config', 'commit.gpgsign', 'false');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'initial');
}

function commitCount(cwd: string): number {
  return Number.parseInt(git(cwd, 'rev-list', '--count', 'HEAD').trim(), 10);
}

function write(root: string, relative: string, content: string): void {
  const target = join(root, ...relative.split('/'));
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

function read(root: string, relative: string): string {
  return readFileSync(join(root, ...relative.split('/')), 'utf8');
}

function insertBlueprint(overrides: Partial<BlueprintRow> = {}): BlueprintRow {
  const now = new Date().toISOString();
  const row: BlueprintRow = {
    id: 'sample',
    repository_id: repository.id,
    title: 'Sample Blueprint',
    description: 'A fixture',
    area: '',
    blueprint_file: null,
    project_subdir: '',
    source_type: 'none',
    source_id: null,
    pr_mode: 'off',
    auto_commit: false,
    orchestrator_child_concurrency: 1,
    agent: { ...DEFAULT_AGENT_CONFIG },
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  test.ctx.registry.insertBlueprint(row);
  return row;
}

function captureRoom(roomKey: string): SseFrame[] {
  const frames: SseFrame[] = [];
  test.ctx.blueprintRooms.get(roomKey).subscribe((frame) => {
    if (frame) frames.push(frame);
  });
  return frames;
}

function waitFor<T>(probe: () => T | undefined, timeoutMs = 4000): Promise<T> {
  const started = Date.now();
  return new Promise((resolveWait, reject) => {
    const tick = (): void => {
      const value = probe();
      if (value !== undefined) {
        resolveWait(value);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error('timed out'));
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}

function settle(ms = 300): Promise<void> {
  return new Promise((resolveSettle) => setTimeout(resolveSettle, ms));
}

beforeEach(() => {
  test = createTestContext();
  repoDir = join(test.root, 'sample-blueprint');
  cpSync(FIXTURE, repoDir, { recursive: true, filter: (source) => !source.includes(`${join('sample-blueprint', '.lake')}`) });
  initRepo(repoDir);
  repository = test.ctx.registry.addRepository(repoDir);
  workspacePorts = {
    createWorkspace: vi.fn(async () => ({ blueprint_id: 'created', message: "Blueprint 'Created' created successfully" })),
    createStarterBlueprint: vi.fn(async () => ({ blueprint_file: ENTRYPOINT, included_files: [], entry_count: 0 })),
    deleteWorkspace: vi.fn(async (ctx, project) => {
      ctx.registry.deleteBlueprint(project.repository.id, project.blueprint.id);
    }),
  };
  service = new BlueprintService(test.ctx, { workspace: workspacePorts });
  service.watcherOptions = { debounceMs: 50, pollIntervalMs: 50 };
});

afterEach(() => {
  service.shutdown();
  test.cleanup();
});

describe('openProject', () => {
  it('resolves the folder, adopts the conventional entrypoint once and persists it', () => {
    insertBlueprint();
    const project = service.openProject(repository.owner, repository.name, 'sample');
    expect(project.clonePath).toBe(resolve(repoDir));
    expect(project.projectRoot).toBe(resolve(repoDir));
    expect(project.blueprintFile).toBe(ENTRYPOINT);
    expect(project.roomKey).toBe(`${repository.owner}/${repository.name}/sample`);
    expect(test.ctx.registry.getBlueprint(repository.id, 'sample')?.blueprint_file).toBe(ENTRYPOINT);
  });

  it('keeps a stored entrypoint and ignores unsafe stored values', () => {
    insertBlueprint({ blueprint_file: 'docs/custom.tex' });
    expect(service.openProject(repository.owner, repository.name, 'sample').blueprintFile).toBe('docs/custom.tex');
    test.ctx.registry.updateBlueprint(repository.id, 'sample', { blueprint_file: '../escape.tex' });
    // Unsafe → treated as unset → the conventional file is adopted instead.
    expect(service.openProject(repository.owner, repository.name, 'sample').blueprintFile).toBe(ENTRYPOINT);
  });

  it('places the project root under project_subdir and leaves nested workspaces unadopted', () => {
    insertBlueprint({ id: 'nested', project_subdir: '/lean/inner/' });
    const project = service.openProject(repository.owner, repository.name, 'nested');
    expect(project.projectSubdir).toBe('lean/inner');
    expect(project.projectRoot).toBe(join(resolve(repoDir), 'lean', 'inner'));
    expect(project.blueprintFile).toBeNull();
  });

  it('resolves a legacy numina/blueprints entrypoint for every path without persisting it', async () => {
    const legacy = join(test.root, 'legacy');
    write(legacy, 'numina/blueprints/nm/nm.tex', '\\begin{lemma}\n\\label{lem:legacy}\n\\lean{Legacy.lem}\nA claim.\n\\end{lemma}\n\\begin{proof}\nEasy.\n\\end{proof}\n');
    const legacyRepo = test.ctx.registry.addRepository(legacy);
    test.ctx.registry.insertBlueprint({ ...insertBlueprint({ id: 'ignored-legacy' }), id: 'nm', repository_id: legacyRepo.id, blueprint_file: null });
    const project = service.openProject(legacyRepo.owner, legacyRepo.name, 'nm');
    expect(project.blueprintFile).toBe('numina/blueprints/nm/nm.tex');
    expect(test.ctx.registry.getBlueprint(legacyRepo.id, 'nm')?.blueprint_file).toBeNull();

    const payload = await service.getBlueprint(project);
    expect(payload.blueprint_file).toBe('numina/blueprints/nm/nm.tex');
    expect(payload.entries.map((entry) => entry.label)).toEqual(['lem:legacy']);

    // The tag sync finds the same file the parser read.
    const result = await service.setDeclarationStatus(project, 'lem:legacy', 'proved');
    expect(result.ok).toBe(true);
    expect(result.rewritten).toEqual(['numina/blueprints/nm/nm.tex']);
    expect(read(legacy, 'numina/blueprints/nm/nm.tex')).toContain('\\leanok');

    // A content save is bookkept against the legacy file: no bounce-back as an external edit.
    service.retainRoom(project);
    const frames = captureRoom(project.roomKey);
    await service.writeContent(project, `${read(legacy, 'numina/blueprints/nm/nm.tex')}% saved\n`);
    await settle(400);
    expect(frames.map((frame) => frame.event)).toEqual(['blueprint_sync']);
    expect(read(legacy, 'numina/blueprints/nm/nm.tex')).toContain('% saved');
  });

  it('throws the web 404s for unknown repositories and blueprints', () => {
    expect(() => service.openProject('nobody', 'nothing', 'sample')).toThrow(HttpError);
    expect(() => service.openProject(repository.owner, repository.name, 'missing')).toThrowError(
      expect.objectContaining({ status: 404, detail: 'Blueprint not found' }),
    );
  });
});

describe('getBlueprint / listBlueprints', () => {
  it('opens and refreshes a workspace without starting a Lean build', async () => {
    const startBuild = vi.fn(async () => undefined);
    test.ctx.services.lean = { startBuild };
    insertBlueprint();
    const project = service.openProject(repository.owner, repository.name, 'sample');
    await service.getBlueprint(project);
    await service.getBlueprint(project);
    await settle(20);
    expect(startBuild).not.toHaveBeenCalled();
  });

  it('assembles the detail payload with row settings, git branch state and the agent block', async () => {
    insertBlueprint({ pr_mode: 'draft', auto_commit: true, orchestrator_child_concurrency: 3 });
    const project = service.openProject(repository.owner, repository.name, 'sample');
    const payload = await service.getBlueprint(project);
    expect(payload.id).toBe('sample');
    expect(payload.name).toBe('Sample Blueprint');
    expect(payload.description).toBe('A fixture');
    expect(payload.blueprint_file).toBe(ENTRYPOINT);
    expect(payload.included_files).toEqual([ENTRYPOINT, 'blueprint/src/chapters/doubling.tex', 'blueprint/src/chapters/squares.tex']);
    expect(payload.entries.map((entry) => entry.label)).toEqual(FIXTURE_LABELS);
    expect(payload.entry_count).toBe(6);
    expect(Object.keys(payload.chapter_contents)).toEqual(['blueprint/src/chapters/doubling.tex', 'blueprint/src/chapters/squares.tex']);
    expect(payload.chapter_titles['blueprint/src/chapters/doubling.tex']).toBe('Doubling');
    expect(payload.all_lean_files).toEqual(['Sample.lean', 'Sample/Basic.lean', 'Sample/Squares.lean']);
    expect(payload.pr_mode).toBe('draft');
    expect(payload.auto_commit).toBe(false);
    expect(payload.orchestrator_child_concurrency).toBe(3);
    expect(payload.is_merged).toBe(false);
    expect(payload.can_edit).toBe(true);
    expect(payload.open_pr_number).toBeNull();
    expect(payload.runtime_route_tag).toBeNull();
    expect(payload.branch_status).toEqual({ branch: 'main', is_dirty: false, commits_ahead: 0, commits_behind: 0, is_diverged: false, needs_reconcile: false });
    expect(payload.agent).toEqual(DEFAULT_AGENT_CONFIG);
    expect(payload.ocr_phase).toBe('');
  });

  it('reports null branch state for a folder that is not a git repository', async () => {
    const plain = join(test.root, 'plain');
    cpSync(join(FIXTURE, 'blueprint'), join(plain, 'blueprint'), { recursive: true });
    const plainRepo = test.ctx.registry.addRepository(plain);
    test.ctx.registry.insertBlueprint({ ...insertBlueprint(), id: 'plain', repository_id: plainRepo.id });
    const payload = await service.getBlueprint(service.openProject(plainRepo.owner, plainRepo.name, 'plain'));
    expect(payload.branch_status).toBeNull();
    expect(payload.branch_freshness).toBeNull();
    expect(payload.file_diff_stats).toEqual({});
  });

  it('lists summaries sorted by activity with entry counts from the persisted model', async () => {
    const older = insertBlueprint({ id: 'older', blueprint_file: ENTRYPOINT, created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-01T00:00:00.000Z' });
    insertBlueprint({ id: 'newer', blueprint_file: ENTRYPOINT, created_at: '2024-02-01T00:00:00.000Z', updated_at: '2024-02-01T00:00:00.000Z' });
    let summaries = await service.listBlueprints(repository);
    expect(summaries.map((row) => row.id)).toEqual(['newer', 'older']);
    expect(summaries.every((row) => row.entry_count === 0 && row.can_edit && row.workspace_id === null)).toBe(true);

    // Opening parses the source; a chat on the older workspace bumps it to the top.
    await service.getBlueprint(service.openProject(repository.owner, repository.name, 'older'));
    const conversation: ConversationRow = {
      id: 'conv-1',
      repository_id: repository.id,
      blueprint_id: older.id,
      title: null,
      status: 'completed',
      created_at: '2024-03-01T00:00:00.000Z',
      updated_at: '2024-03-01T00:00:00.000Z',
      completed_at: null,
      input_tokens: null,
      output_tokens: null,
      total_cost_usd: null,
      provider_thread_id: null,
      provider: 'claude',
      tier: 'completed',
      background_updates: [],
      roadblocks: [],
    };
    test.ctx.registry.upsertConversation(conversation);
    summaries = await service.listBlueprints(repository);
    expect(summaries.map((row) => row.id)).toEqual(['older', 'newer']);
    expect(summaries[0].entry_count).toBe(6);
    expect(summaries[0].updated_at).toBe('2024-03-01T00:00:00.000Z');
  });
});

describe('chapters', () => {
  it('reads chapters of the include chain and maps service errors to HTTP statuses', async () => {
    insertBlueprint();
    const project = service.openProject(repository.owner, repository.name, 'sample');
    const chapter = await service.readChapter(project, 'blueprint/src/chapters/squares.tex');
    expect(chapter.path).toBe('blueprint/src/chapters/squares.tex');
    expect(chapter.content).toContain('\\label{conj:cube}');
    await expect(service.readChapter(project, 'Sample.lean')).rejects.toMatchObject({ status: 400, detail: 'Invalid chapter path' });
    await expect(service.readChapter(project, 'lakefile.tex')).rejects.toMatchObject({ status: 400, detail: 'Chapter not part of this blueprint' });
    // A chapter the model still lists but that vanished from disk is "not found";
    // one that was never reachable through \input is "not part" (as the web).
    await service.refresh(project);
    rmSync(join(repoDir, 'blueprint', 'src', 'chapters', 'squares.tex'));
    await expect(service.readChapter(project, 'blueprint/src/chapters/squares.tex')).rejects.toMatchObject({ status: 404, detail: 'Chapter not found in clone' });
  });

  it('writes a chapter, re-parses the model and publishes blueprint_sync without auto-committing', async () => {
    insertBlueprint();
    const project = service.openProject(repository.owner, repository.name, 'sample');
    const frames = captureRoom(project.roomKey);
    const before = commitCount(repoDir);
    const edited = read(repoDir, 'blueprint/src/chapters/squares.tex').replace('\\begin{conjecture}[Cubes]', '\\begin{theorem}[Cubes]').replace('\\end{conjecture}', '\\end{theorem}');
    await service.writeChapter(project, 'blueprint/src/chapters/squares.tex', edited);
    expect(read(repoDir, 'blueprint/src/chapters/squares.tex')).toBe(edited);
    expect(frames).toEqual([expect.objectContaining({ event: 'blueprint_sync', data: { blueprint: 'sample' } })]);
    const declarations = await service.listDeclarations(project);
    expect(declarations.find((row) => row.label === 'conj:cube')?.kind).toBe('theorem');
    await settle();
    expect(commitCount(repoDir)).toBe(before);
    const updatedAt = test.ctx.registry.getBlueprint(repository.id, 'sample')?.updated_at ?? '';
    expect(Date.parse(updatedAt)).toBeGreaterThanOrEqual(Date.parse(project.blueprint.created_at));
  });

  it('leaves chapter saves uncommitted even with a legacy auto-commit flag', async () => {
    insertBlueprint({ auto_commit: true });
    const project = service.openProject(repository.owner, repository.name, 'sample');
    const before = commitCount(repoDir);
    await service.writeChapter(project, 'blueprint/src/chapters/doubling.tex', `${read(repoDir, 'blueprint/src/chapters/doubling.tex')}\n% edited\n`);
    await settle();
    expect(commitCount(repoDir)).toBe(before);
    expect(git(repoDir, 'status', '--porcelain')).toContain('doubling.tex');
  });

  it('refuses to overwrite a body chapter with the entrypoint content (409) and writes the entrypoint itself', async () => {
    insertBlueprint();
    const project = service.openProject(repository.owner, repository.name, 'sample');
    const entrypoint = read(repoDir, ENTRYPOINT);
    await expect(service.writeChapter(project, 'blueprint/src/chapters/doubling.tex', entrypoint)).rejects.toMatchObject({ status: 409 });
    await service.writeContent(project, `${entrypoint}% trailing comment\n`);
    expect(read(repoDir, ENTRYPOINT)).toBe(`${entrypoint}% trailing comment\n`);
  });
});

describe('settings and entrypoint selection', () => {
  it('persists settings, rejects blank titles and over-ceiling concurrency, and merges the agent block', () => {
    insertBlueprint();
    const project = service.openProject(repository.owner, repository.name, 'sample');
    const response = service.updateSettings(project, {
      title: '  Renamed  ',
      description: 'New notes',
      pr_mode: 'ready',
      auto_commit: true,
      orchestrator_child_concurrency: 2,
      agent: { provider: 'codex', model: 'gpt-5-codex' },
    });
    expect(response).toEqual({
      name: 'Renamed',
      description: 'New notes',
      pr_mode: 'ready',
      auto_commit: false,
      orchestrator_child_concurrency: 2,
      pr_number: null,
      pr_error: null,
      pushed: true,
      agent: { ...DEFAULT_AGENT_CONFIG, provider: 'codex', model: 'gpt-5-codex' },
    });
    const row = test.ctx.registry.getBlueprint(repository.id, 'sample');
    expect(row?.title).toBe('Renamed');
    expect(row?.agent.codex_sandbox).toBe('workspace-write');
    expect(() => service.updateSettings(project, { title: '   ' })).toThrowError(expect.objectContaining({ status: 400, detail: 'Title must not be empty' }));
    expect(() => service.updateSettings(project, { orchestrator_child_concurrency: 5 })).toThrowError(
      expect.objectContaining({ status: 422, detail: 'Orchestrator concurrency cannot exceed 4.' }),
    );
  });

  it('adopts an entrypoint only when it parses declarations, and never persists a rejected one', async () => {
    insertBlueprint({ blueprint_file: 'docs/custom.tex' });
    write(repoDir, 'docs/custom.tex', '\\chapter{Empty}\n');
    write(repoDir, 'docs/real.tex', '\\begin{lemma}\n\\label{lem:real}\nA claim.\n\\end{lemma}\n');
    const project = service.openProject(repository.owner, repository.name, 'sample');
    await expect(service.setSourceFile(project, 'docs/custom.tex', { requireDeclarations: true })).rejects.toMatchObject({
      status: 422,
      detail: 'docs/custom.tex has no parseable leanblueprint declarations.',
    });
    const frames = captureRoom(project.roomKey);
    const adopted = await service.setSourceFile(project, 'docs/real.tex', { requireDeclarations: true });
    expect(adopted).toEqual({ blueprint_file: 'docs/real.tex', included_files: ['docs/real.tex'], entry_count: 1 });
    expect(project.blueprintFile).toBe('docs/real.tex');
    expect(test.ctx.registry.getBlueprint(repository.id, 'sample')?.blueprint_file).toBe('docs/real.tex');
    expect(frames.map((frame) => frame.event)).toEqual(['blueprint_sync']);
    // A starter file may legitimately have no declarations yet.
    const starter = await service.setSourceFile(project, 'docs/custom.tex', { requireDeclarations: false });
    expect(starter.entry_count).toBe(0);
  });

  it('createBlueprint adopts an existing conventional entrypoint, else writes the starter and adopts it', async () => {
    insertBlueprint();
    const project = service.openProject(repository.owner, repository.name, 'sample');
    const adopted = await service.createBlueprint(project);
    expect(adopted.entry_count).toBe(6);
    expect(workspacePorts.createStarterBlueprint).not.toHaveBeenCalled();

    const fresh = join(test.root, 'fresh');
    mkdirSync(fresh, { recursive: true });
    const freshRepo = test.ctx.registry.addRepository(fresh);
    test.ctx.registry.insertBlueprint({ ...insertBlueprint({ id: 'ignored' }), id: 'fresh', repository_id: freshRepo.id, blueprint_file: null });
    (workspacePorts.createStarterBlueprint as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      write(fresh, ENTRYPOINT, '\\input{chapters/example_chapter}\n');
      write(fresh, 'blueprint/src/chapters/example_chapter.tex', '\\section{Example Chapter}\n');
      return { blueprint_file: ENTRYPOINT, included_files: [], entry_count: 0 };
    });
    const created = await service.createBlueprint(service.openProject(freshRepo.owner, freshRepo.name, 'fresh'));
    expect(created).toEqual({ blueprint_file: ENTRYPOINT, included_files: [ENTRYPOINT, 'blueprint/src/chapters/example_chapter.tex'], entry_count: 0 });
    expect(test.ctx.registry.getBlueprint(freshRepo.id, 'fresh')?.blueprint_file).toBe(ENTRYPOINT);
  });

  it('lists source candidates from the folder', async () => {
    insertBlueprint();
    const files = await service.listSourceCandidates(service.openProject(repository.owner, repository.name, 'sample'));
    expect(files).toEqual([{ path: ENTRYPOINT, name: 'blueprint', size: expect.any(Number) }]);
  });
});

describe('declaration model (MCP)', () => {
  it('lists declarations in document order with agent fields, and updates agent-writable fields', async () => {
    insertBlueprint();
    const project = service.openProject(repository.owner, repository.name, 'sample');
    const rows = await service.listDeclarations(project);
    expect(rows.map((row) => row.label)).toEqual(FIXTURE_LABELS);
    expect(rows[0]).toMatchObject({ kind: 'definition', leanDeclaration: 'twice', status: 'proved', sourceFile: 'blueprint/src/chapters/doubling.tex' });
    expect(await service.updateDeclaration(project, 'conj:cube', { notes: 'hard', issues: ['needs a bound'] })).toBe(true);
    expect(await service.updateDeclaration(project, 'nope', { notes: 'x' })).toBe(false);
    await expect(service.updateDeclaration(project, 'conj:cube', { status: 'proved' })).rejects.toMatchObject({ status: 400 });
    const again = await service.listDeclarations(project);
    expect(again.find((row) => row.label === 'conj:cube')).toMatchObject({ notes: 'hard', issues: ['needs a bound'] });
  });

  it('setDeclarationStatus rewrites the .tex before recording the status and reports the files it touched', async () => {
    insertBlueprint();
    const project = service.openProject(repository.owner, repository.name, 'sample');
    const frames = captureRoom(project.roomKey);
    const missingLean = await service.setDeclarationStatus(project, 'conj:cube', 'formalized');
    expect(missingLean.ok).toBe(false);
    expect(missingLean.reason).toContain('no leanDeclaration');
    await service.updateDeclaration(project, 'conj:cube', { leanDeclaration: 'square_le_cube' });
    const result = await service.setDeclarationStatus(project, 'conj:cube', 'formalized');
    expect(result.ok).toBe(true);
    expect(result.rewritten).toEqual(['blueprint/src/chapters/squares.tex']);
    // A conjecture has no proof, so "formalized" is terminal and normalizes to proved.
    expect(result.summary).toContain("Set status of 1 declaration(s) to 'formalized': conj:cube.");
    expect(result.summary).toContain('Normalized');
    const squares = read(repoDir, 'blueprint/src/chapters/squares.tex');
    expect(squares).toMatch(/\\label\{conj:cube\}\n\s*\\lean\{square_le_cube\}\n\s*\\uses\{def:square\}\n\s*\\leanok/);
    const rows = await service.listDeclarations(project);
    expect(rows.find((row) => row.label === 'conj:cube')?.status).toBe('proved');
    await waitFor(() => (frames.some((frame) => frame.event === 'blueprint_sync') ? true : undefined));

    const unknown = await service.setDeclarationStatus(project, 'lem:nowhere', 'proved');
    expect(unknown.ok).toBe(false);
    expect(unknown.reason).toContain('no declaration with this label or Lean name');
    await expect(service.setDeclarationStatus(project, 'conj:cube', 'bogus')).rejects.toMatchObject({ status: 400 });

    // Lean names resolve to labels; an already-synced declaration is a no-op rewrite.
    const byLeanName = await service.setDeclarationStatus(project, 'twice_zero', 'proved');
    expect(byLeanName.ok).toBe(true);
    expect(byLeanName.rewritten).toEqual([]);
    expect(byLeanName.summary).toContain("'twice_zero' -> 'lem:twice-zero'");
  });

  it('serializes overlapping model writes so neither is lost', async () => {
    insertBlueprint();
    const project = service.openProject(repository.owner, repository.name, 'sample');
    await service.refresh(project);
    await Promise.all([
      service.updateDeclaration(project, 'def:twice', { notes: 'first' }),
      service.updateDeclaration(project, 'def:square', { notes: 'second' }),
      service.refresh(project),
    ]);
    const rows = await service.listDeclarations(project);
    expect(rows.find((row) => row.label === 'def:twice')?.notes).toBe('first');
    expect(rows.find((row) => row.label === 'def:square')?.notes).toBe('second');
  });
});

describe('file watcher through the room lifecycle', () => {
  it('publishes blueprint_edit for external entrypoint edits, blueprint_sync for chapter edits, nothing for own writes', async () => {
    insertBlueprint();
    const project = service.openProject(repository.owner, repository.name, 'sample');
    await service.getBlueprint(project);
    const release = service.retainRoom(project);
    expect(service.isWatching(project.roomKey)).toBe(true);
    const frames = captureRoom(project.roomKey);

    // Own write (through the service) → only the explicit blueprint_sync.
    await service.writeChapter(project, 'blueprint/src/chapters/doubling.tex', `${read(repoDir, 'blueprint/src/chapters/doubling.tex')}% mine\n`);
    await settle(400);
    expect(frames.map((frame) => frame.event)).toEqual(['blueprint_sync']);
    frames.length = 0;

    // External chapter edit → refresh + blueprint_sync (never blueprint_edit).
    write(repoDir, 'blueprint/src/chapters/squares.tex', `${read(repoDir, 'blueprint/src/chapters/squares.tex')}% agent\n`);
    await waitFor(() => (frames.length > 0 ? true : undefined));
    await settle(200);
    expect(frames.map((frame) => frame.event)).toEqual(['blueprint_sync']);
    frames.length = 0;

    // External entrypoint edit → blueprint_edit carrying the new text, then blueprint_sync.
    const newEntrypoint = `${read(repoDir, ENTRYPOINT)}% agent touched the index\n`;
    write(repoDir, ENTRYPOINT, newEntrypoint);
    await waitFor(() => (frames.length >= 2 ? true : undefined));
    expect(frames.map((frame) => frame.event)).toEqual(['blueprint_edit', 'blueprint_sync']);
    expect(frames[0].data).toEqual({ latex_source: newEntrypoint, path: ENTRYPOINT });

    release();
    // The watcher lingers for reconnects, but a second retain reuses it.
    expect(service.isWatching(project.roomKey)).toBe(true);
    service.retainRoom(project)();
    service.shutdown();
    expect(service.isWatching(project.roomKey)).toBe(false);
  });

  it('publishes blueprint_edit with universal newlines, as GET serves blueprint_content', async () => {
    insertBlueprint();
    const project = service.openProject(repository.owner, repository.name, 'sample');
    service.retainRoom(project);
    const frames = captureRoom(project.roomKey);
    const crlf = read(repoDir, ENTRYPOINT).replace(/\n/g, '\r\n') + '% agent\r\n';
    write(repoDir, ENTRYPOINT, crlf);
    await waitFor(() => (frames.some((frame) => frame.event === 'blueprint_edit') ? true : undefined));
    const edit = frames.find((frame) => frame.event === 'blueprint_edit');
    const served = await service.getBlueprint(project);
    expect(edit?.data).toEqual({ latex_source: served.blueprint_content, path: ENTRYPOINT });
    expect(served.blueprint_content).not.toContain('\r');
  });

  it('notices a chapter that is created after its \\input line was added', async () => {
    insertBlueprint();
    const project = service.openProject(repository.owner, repository.name, 'sample');
    await service.getBlueprint(project);
    service.retainRoom(project);
    const frames = captureRoom(project.roomKey);
    // The agent writes the index first (the target does not exist yet) ...
    write(repoDir, ENTRYPOINT, `${read(repoDir, ENTRYPOINT)}\\input{chapters/newchap}\n`);
    await waitFor(() => (frames.some((frame) => frame.event === 'blueprint_sync') ? true : undefined));
    await settle(200);
    frames.length = 0;
    // ... then the chapter: the UI must be told to refetch, not wait for the next GET.
    write(repoDir, 'blueprint/src/chapters/newchap.tex', '\\chapter{New}\n\\begin{lemma}\n\\label{lem:new}\nNew.\n\\end{lemma}\n');
    await waitFor(() => (frames.some((frame) => frame.event === 'blueprint_sync') ? true : undefined));
    const rows = await service.listDeclarations(project);
    expect(rows.map((row) => row.label)).toContain('lem:new');
    // Deleting and recreating it is seen as well.
    frames.length = 0;
    rmSync(join(repoDir, 'blueprint', 'src', 'chapters', 'newchap.tex'));
    await waitFor(() => (frames.some((frame) => frame.event === 'blueprint_sync') ? true : undefined));
    frames.length = 0;
    write(repoDir, 'blueprint/src/chapters/newchap.tex', '\\chapter{New}\n\\begin{lemma}\n\\label{lem:newer}\nNewer.\n\\end{lemma}\n');
    await waitFor(() => (frames.some((frame) => frame.event === 'blueprint_sync') ? true : undefined));
    expect((await service.listDeclarations(project)).map((row) => row.label)).toContain('lem:newer');
  });

  it('starts watching newly included chapters after a re-parse', async () => {
    insertBlueprint();
    const project = service.openProject(repository.owner, repository.name, 'sample');
    service.retainRoom(project);
    const frames = captureRoom(project.roomKey);
    write(repoDir, 'blueprint/src/chapters/cubes.tex', '\\chapter{Cubes}\n');
    write(repoDir, ENTRYPOINT, `${read(repoDir, ENTRYPOINT)}\\input{chapters/cubes}\n`);
    await waitFor(() => (frames.some((frame) => frame.event === 'blueprint_sync') ? true : undefined));
    await settle(200);
    frames.length = 0;
    write(repoDir, 'blueprint/src/chapters/cubes.tex', '\\chapter{Cubes}\nNow watched.\n');
    await waitFor(() => (frames.length > 0 ? true : undefined));
    expect(frames.map((frame) => frame.event)).toEqual(['blueprint_sync']);
  });
});

describe('delete', () => {
  it('refuses while a session is live, otherwise stops the watcher and removes the workspace', async () => {
    insertBlueprint();
    const project = service.openProject(repository.owner, repository.name, 'sample');
    service.retainRoom(project);
    test.ctx.services.sessions = { hasActiveSession: () => true };
    await expect(service.deleteBlueprint(project)).rejects.toMatchObject({ status: 409, detail: 'Cannot delete a blueprint with active agent sessions.' });
    test.ctx.services.sessions = { isBlueprintBusy: () => false, hasActiveSession: () => false };
    await service.deleteBlueprint(project);
    expect(workspacePorts.deleteWorkspace).toHaveBeenCalledTimes(1);
    expect(service.isWatching(project.roomKey)).toBe(false);
    expect(test.ctx.registry.getBlueprint(repository.id, 'sample')).toBeNull();
  });
});
