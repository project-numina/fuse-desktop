import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlueprintResponse, BlueprintSettingsResponse, BlueprintSourceFileResponse, BlueprintSummary } from '@shared/api-types';
import { BlueprintService } from '@main/services/blueprint-service';
import { atomicWriteJson } from '@main/services/lean/build/snapshot';
import { createTestContext, type TestContext } from '@test/main/services/workspace/test-context';
import { DEFAULT_AGENT_CONFIG, type BlueprintRow, type RepositoryRow } from '@main/store/rows';
import { errorResponse } from '@main/server/errors';
import { blueprintRoutes } from '@main/server/routes/blueprints';

const FIXTURE = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../fixtures/sample-blueprint');
const ENTRYPOINT = 'blueprint/src/content.tex';

let test: TestContext;
let repoDir: string;
let repository: RepositoryRow;
let app: Hono;
let base: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
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

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function jsonRequest(method: string, path: string, body: unknown): Promise<Response> {
  return app.request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

/** Read SSE frames from a streaming response until `count` (non-heartbeat) frames arrived, then abort. */
async function readFrames(
  path: string,
  count: number,
  options: { includeHeartbeats?: boolean; timeoutMs?: number } = {},
): Promise<Array<{ event: string; data: unknown; id?: string }>> {
  const timeoutMs = options.timeoutMs ?? 4000;
  const controller = new AbortController();
  const response = await app.request(path, { signal: controller.signal });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const frames: Array<{ event: string; data: unknown; id?: string }> = [];
  let buffer = '';
  const deadline = Date.now() + timeoutMs;
  const counted = (): number => frames.filter((frame) => frame.event !== 'heartbeat').length;
  while (counted() < count && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separator = buffer.indexOf('\n\n');
    while (separator >= 0) {
      const raw = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const frame: { event: string; data: unknown; id?: string } = { event: 'message', data: '' };
      let data = '';
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) frame.event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
        else if (line.startsWith('id:')) frame.id = line.slice(3).trim();
      }
      frame.data = data ? JSON.parse(data) : '';
      if (frame.event !== 'heartbeat' || options.includeHeartbeats) frames.push(frame);
      separator = buffer.indexOf('\n\n');
    }
  }
  controller.abort();
  await reader.cancel().catch(() => undefined);
  return frames;
}

beforeEach(() => {
  test = createTestContext();
  repoDir = join(test.root, 'sample-blueprint');
  cpSync(FIXTURE, repoDir, { recursive: true, filter: (source) => !source.includes(join('sample-blueprint', '.lake')) });
  git(repoDir, 'init', '-q', '-b', 'main');
  git(repoDir, 'config', 'user.email', 'test@example.com');
  git(repoDir, 'config', 'user.name', 'Test User');
  git(repoDir, 'config', 'commit.gpgsign', 'false');
  git(repoDir, 'add', '-A');
  git(repoDir, 'commit', '-q', '-m', 'initial');
  repository = test.ctx.registry.addRepository(repoDir);
  base = `/api/repositories/${repository.owner}/${repository.name}/blueprints`;
  const service = new BlueprintService(test.ctx);
  service.heartbeatMs = 60;
  service.watcherOptions = { debounceMs: 50, pollIntervalMs: 50 };
  test.ctx.services.blueprints = service;
  app = new Hono();
  app.onError((error, c) => errorResponse(c, error));
  app.route('/api/repositories', blueprintRoutes(test.ctx));
});

afterEach(() => {
  (test.ctx.services.blueprints as BlueprintService).shutdown();
  test.cleanup();
});

describe('PUT /blueprints/:name/lean-project', () => {
  it('persists the selected project without changing the blueprint, building, or writing repository files', async () => {
    insertBlueprint({ blueprint_file: ENTRYPOINT });
    write(repoDir, 'lean/other/lakefile.toml', 'name = "other"');
    const before = git(repoDir, 'status', '--porcelain');
    const startBuild = vi.fn();
    test.ctx.services.lean = { startBuild, buildSnapshot: () => null };
    const response = await jsonRequest('PUT', `${base}/sample/lean-project`, { lakefile: 'lean/other/lakefile.toml' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ project_subdir: 'lean/other' });
    expect(test.ctx.registry.getBlueprint(repository.id, 'sample')).toMatchObject({
      project_subdir: 'lean/other', blueprint_file: ENTRYPOINT,
    });
    expect(git(repoDir, 'status', '--porcelain')).toBe(before);
    expect(startBuild).not.toHaveBeenCalled();
  });

  it('rejects invalid paths and symlinks outside the repository', async () => {
    insertBlueprint();
    for (const lakefile of ['../lakefile.lean', '/tmp/lakefile.lean', '.lake/lakefile.lean', 'README.md']) {
      expect((await jsonRequest('PUT', `${base}/sample/lean-project`, { lakefile })).status).toBe(422);
    }
    write(test.root, 'outside/lakefile.lean', '');
    symlinkSync(join(test.root, 'outside'), join(repoDir, 'linked'));
    expect((await jsonRequest('PUT', `${base}/sample/lean-project`, { lakefile: 'linked/lakefile.lean' })).status).toBe(404);
    expect((await jsonRequest('PUT', `${base}/sample/lean-project`, { lakefile: 'missing/lakefile.lean' })).status).toBe(404);
  });

  it('does not change context during an agent session or Lean build', async () => {
    insertBlueprint();
    write(repoDir, 'other/lakefile.lean', '');
    test.ctx.services.sessions = { isBlueprintBusy: () => true };
    expect((await jsonRequest('PUT', `${base}/sample/lean-project`, { lakefile: 'other/lakefile.lean' })).status).toBe(409);
    test.ctx.services.sessions = {};
    test.ctx.services.lean = { buildSnapshot: () => ({ status: 'running' }) };
    expect((await jsonRequest('PUT', `${base}/sample/lean-project`, { lakefile: 'other/lakefile.lean' })).status).toBe(409);
    expect(test.ctx.registry.getBlueprint(repository.id, 'sample')?.project_subdir).toBe('');
  });
});

describe('GET /blueprints and /blueprints/:name', () => {
  it('lists summaries and serves the detail payload', async () => {
    insertBlueprint();
    let list = await json<BlueprintSummary[]>(await app.request(base));
    expect(list).toEqual([expect.objectContaining({ id: 'sample', name: 'Sample Blueprint', entry_count: 0, can_edit: true })]);

    const response = await app.request(`${base}/sample`);
    expect(response.status).toBe(200);
    const detail = await json<BlueprintResponse & { agent: unknown }>(response);
    expect(detail.blueprint_file).toBe(ENTRYPOINT);
    expect(detail.blueprint_content).toContain('\\input{chapters/doubling}');
    expect(detail.entries).toHaveLength(6);
    expect(detail.entries[0]).toMatchObject({ kind: 'definition', label: 'def:twice', lean_name: 'twice', status: 'proved', source_file: 'blueprint/src/chapters/doubling.tex' });
    expect(detail.latex_macros).toEqual({});
    expect(detail.chapter_references).toEqual({ 'chap:doubling': '1', 'chap:squares': '2' });
    expect(detail.branch_status?.branch).toBe('main');
    expect(detail.is_merged).toBe(false);
    expect(detail.agent).toEqual(DEFAULT_AGENT_CONFIG);

    list = await json<BlueprintSummary[]>(await app.request(base));
    expect(list[0].entry_count).toBe(6);
  });

  it('returns the web 404 envelope for unknown blueprints and repositories', async () => {
    const missing = await app.request(`${base}/missing`);
    expect(missing.status).toBe(404);
    expect(await json<{ detail: string; code: string }>(missing)).toMatchObject({ detail: 'Blueprint not found', code: 'http_404' });
    expect((await app.request('/api/repositories/nobody/nothing/blueprints')).status).toBe(404);
  });

  it('decodes percent-encoded route segments', async () => {
    insertBlueprint();
    const response = await app.request(`/api/repositories/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/blueprints/${encodeURIComponent('sample')}`);
    expect(response.status).toBe(200);
  });
});

describe('chapters and content', () => {
  it('GET /chapter validates the query and reads chapter files', async () => {
    insertBlueprint();
    expect((await app.request(`${base}/sample/chapter`)).status).toBe(422);
    expect((await app.request(`${base}/sample/chapter?path=`)).status).toBe(422);
    expect((await app.request(`${base}/sample/chapter?path=${'a'.repeat(513)}`)).status).toBe(422);
    const notPart = await app.request(`${base}/sample/chapter?path=${encodeURIComponent('Sample/Basic.lean')}`);
    expect(notPart.status).toBe(400);
    const outside = await app.request(`${base}/sample/chapter?path=${encodeURIComponent('../secret.tex')}`);
    expect(outside.status).toBe(400);
    const ok = await app.request(`${base}/sample/chapter?path=${encodeURIComponent('blueprint/src/chapters/doubling.tex')}`);
    expect(ok.status).toBe(200);
    expect(await json<{ path: string; content: string }>(ok)).toEqual({ path: 'blueprint/src/chapters/doubling.tex', content: read(repoDir, 'blueprint/src/chapters/doubling.tex') });
  });

  it('PUT /chapter writes the file (204), guards size and the entrypoint-content mistake', async () => {
    insertBlueprint();
    const path = `${base}/sample/chapter?path=${encodeURIComponent('blueprint/src/chapters/squares.tex')}`;
    const content = `${read(repoDir, 'blueprint/src/chapters/squares.tex')}% edited via PUT\n`;
    const ok = await jsonRequest('PUT', path, { content });
    expect(ok.status).toBe(204);
    expect(read(repoDir, 'blueprint/src/chapters/squares.tex')).toBe(content);

    const tooLarge = await jsonRequest('PUT', path, { content: 'x'.repeat(50_001) });
    expect(tooLarge.status).toBe(422);
    expect((await json<{ detail: string }>(tooLarge)).detail).toBe('Chapter content is too large (50,001 characters). Maximum is 50,000 characters.');

    const clobber = await jsonRequest('PUT', path, { content: read(repoDir, ENTRYPOINT) });
    expect(clobber.status).toBe(409);
    expect((await json<{ detail: string }>(clobber)).detail).toBe('Refusing to overwrite chapter with entrypoint content');

    expect((await jsonRequest('PUT', path, { content: 'x', extra: true })).status).toBe(422);
    expect((await app.request(path, { method: 'PUT', body: 'not json' })).status).toBe(422);
  });

  it('PUT /content writes the entrypoint', async () => {
    insertBlueprint();
    const latex = `${read(repoDir, ENTRYPOINT)}% via content\n`;
    expect((await jsonRequest('PUT', `${base}/sample/content`, { latex_source: latex })).status).toBe(204);
    expect(read(repoDir, ENTRYPOINT)).toBe(latex);
    const tooLarge = await jsonRequest('PUT', `${base}/sample/content`, { latex_source: 'x'.repeat(50_001) });
    expect(tooLarge.status).toBe(422);
    expect((await json<{ detail: string }>(tooLarge)).detail).toContain('LaTeX source is too large');
  });
});

describe('PATCH /settings', () => {
  it('saves the web fields plus the desktop agent block', async () => {
    insertBlueprint();
    const response = await jsonRequest('PATCH', `${base}/sample/settings`, {
      title: 'Renamed',
      description: 'notes',
      pr_mode: 'draft',
      auto_commit: true,
      orchestrator_child_concurrency: 2,
      agent: { provider: 'codex', effort: 'high', codex_sandbox: 'read-only' },
    });
    expect(response.status).toBe(200);
    expect(await json<BlueprintSettingsResponse>(response)).toEqual({
      name: 'Renamed',
      description: 'notes',
      pr_mode: 'draft',
      auto_commit: false,
      orchestrator_child_concurrency: 2,
      pr_number: null,
      pr_error: null,
      pushed: true,
      agent: { ...DEFAULT_AGENT_CONFIG, provider: 'codex', effort: 'high', codex_sandbox: 'read-only' },
    });
    const detail = await json<BlueprintResponse>(await app.request(`${base}/sample`));
    expect(detail.name).toBe('Renamed');
    expect(detail.auto_commit).toBe(false);
  });

  it('rejects unknown keys, bad enums, blank titles and over-ceiling concurrency', async () => {
    insertBlueprint();
    expect((await jsonRequest('PATCH', `${base}/sample/settings`, { unknown: 1 })).status).toBe(422);
    expect((await jsonRequest('PATCH', `${base}/sample/settings`, { pr_mode: 'maybe' })).status).toBe(422);
    expect((await jsonRequest('PATCH', `${base}/sample/settings`, { agent: { effort: 'ultra' } })).status).toBe(422);
    expect((await jsonRequest('PATCH', `${base}/sample/settings`, { orchestrator_child_concurrency: 5 })).status).toBe(422);
    const blank = await jsonRequest('PATCH', `${base}/sample/settings`, { title: ' ' });
    expect(blank.status).toBe(400);
    expect((await json<{ detail: string }>(blank)).detail).toBe('Title must not be empty');
  });
});

describe('entrypoint selection', () => {
  it('PUT /source-file validates, adopts, and rejects files without declarations', async () => {
    insertBlueprint({ blueprint_file: 'docs/custom.tex' });
    write(repoDir, 'docs/custom.tex', '\\chapter{Nothing}\n');
    const invalid = await jsonRequest('PUT', `${base}/sample/source-file`, { blueprint_file: '../x.tex' });
    expect(invalid.status).toBe(400);
    expect((await json<{ detail: string }>(invalid)).detail).toBe('blueprint_file must be a repository-relative .tex path.');
    const missing = await jsonRequest('PUT', `${base}/sample/source-file`, { blueprint_file: 'docs/nope.tex' });
    expect(missing.status).toBe(404);
    expect((await json<{ detail: string }>(missing)).detail).toBe('No file at docs/nope.tex in this branch.');
    const empty = await jsonRequest('PUT', `${base}/sample/source-file`, { blueprint_file: 'docs/custom.tex' });
    expect(empty.status).toBe(422);
    const adopted = await jsonRequest('PUT', `${base}/sample/source-file`, { blueprint_file: ENTRYPOINT });
    expect(adopted.status).toBe(200);
    expect(await json<BlueprintSourceFileResponse>(adopted)).toEqual({
      blueprint_file: ENTRYPOINT,
      included_files: [ENTRYPOINT, 'blueprint/src/chapters/doubling.tex', 'blueprint/src/chapters/squares.tex'],
      entry_count: 6,
    });
    expect(test.ctx.registry.getBlueprint(repository.id, 'sample')?.blueprint_file).toBe(ENTRYPOINT);
  });

  it('GET /source-candidates and POST /create-blueprint', async () => {
    insertBlueprint();
    const candidates = await json<{ files: Array<{ path: string; name: string; size: number }> }>(await app.request(`${base}/sample/source-candidates`));
    expect(candidates.files).toEqual([{ path: ENTRYPOINT, name: 'blueprint', size: expect.any(Number) }]);
    const created = await app.request(`${base}/sample/create-blueprint`, { method: 'POST' });
    expect(created.status).toBe(200);
    expect((await json<BlueprintSourceFileResponse>(created)).entry_count).toBe(6);
  });

  it('POST /create-blueprint writes the starter files into an empty workspace', async () => {
    const fresh = join(test.root, 'fresh');
    mkdirSync(fresh, { recursive: true });
    const freshRepo = test.ctx.registry.addRepository(fresh);
    test.ctx.registry.insertBlueprint({ ...insertBlueprint(), id: 'fresh', repository_id: freshRepo.id });
    const response = await app.request(`/api/repositories/${freshRepo.owner}/${freshRepo.name}/blueprints/fresh/create-blueprint`, { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await json<BlueprintSourceFileResponse>(response)).toEqual({
      blueprint_file: ENTRYPOINT,
      included_files: [ENTRYPOINT, 'blueprint/src/chapters/example_chapter.tex'],
      entry_count: 0,
    });
    expect(read(fresh, ENTRYPOINT)).toContain('\\input{chapters/example_chapter}');
    expect(read(fresh, 'blueprint/src/chapters/example_chapter.tex')).toContain('\\section{Example Chapter}');
  });
});

describe('workspace creation and deletion', () => {
  it('POST /create-workspace requires a title and creates the workspace row', async () => {
    const empty = new FormData();
    empty.set('latex_content', 'x');
    const missingTitle = await app.request(`${base}/create-workspace`, { method: 'POST', body: empty });
    expect(missingTitle.status).toBe(400);
    expect((await json<{ detail: string }>(missingTitle)).detail).toBe('Title is required');

    const form = new FormData();
    form.set('title', 'My Project');
    form.set('latex_content', '\\begin{lemma}\n\\label{lem:a}\nA.\n\\end{lemma}\n');
    const created = await app.request(`${base}/create-workspace`, { method: 'POST', body: form });
    expect(created.status).toBe(200);
    expect(await json<{ blueprint_id: string; message: string }>(created)).toEqual({ blueprint_id: 'my-project', message: "Blueprint 'My Project' created successfully" });
    const row = test.ctx.registry.getBlueprint(repository.id, 'my-project');
    expect(row?.title).toBe('My Project');
    expect(row?.blueprint_file).toBe(ENTRYPOINT);
    expect(row?.source_type).toBe('latex');
    const list = await json<BlueprintSummary[]>(await app.request(base));
    expect(list.find((entry) => entry.id === 'my-project')?.entry_count).toBe(6);
  });

  it('DELETE /:name refuses while an agent turn is live, else removes the workspace', async () => {
    insertBlueprint();
    test.ctx.services.sessions = { hasActiveSession: () => true };
    const busy = await app.request(`${base}/sample`, { method: 'DELETE' });
    expect(busy.status).toBe(409);
    expect((await json<{ detail: string }>(busy)).detail).toBe('Cannot delete a blueprint with active agent sessions.');
    delete test.ctx.services.sessions;
    expect((await app.request(`${base}/sample`, { method: 'DELETE' })).status).toBe(204);
    expect(test.ctx.registry.getBlueprint(repository.id, 'sample')).toBeNull();
    expect((await app.request(`${base}/sample`)).status).toBe(404);
  });
});

describe('POST /pdf-info', () => {
  const pdf = [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj',
    '4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj',
    'trailer << /Root 1 0 R >>',
    '%%EOF',
  ].join('\n');

  it('counts pages and rejects non-PDF uploads', async () => {
    const form = new FormData();
    form.set('file', new File([pdf], 'paper.pdf', { type: 'application/pdf' }));
    const ok = await app.request(`${base}/pdf-info`, { method: 'POST', body: form });
    expect(ok.status).toBe(200);
    expect(await json<{ page_count: number }>(ok)).toEqual({ page_count: 2 });

    const tex = new FormData();
    tex.set('file', new File(['\\section{x}'], 'paper.tex'));
    const notPdf = await app.request(`${base}/pdf-info`, { method: 'POST', body: tex });
    expect(notPdf.status).toBe(400);
    expect((await json<{ detail: string }>(notPdf)).detail).toBe('File must be a PDF.');

    const broken = new FormData();
    broken.set('file', new File(['not a pdf'], 'broken.pdf'));
    const unreadable = await app.request(`${base}/pdf-info`, { method: 'POST', body: broken });
    expect(unreadable.status).toBe(400);
    expect((await json<{ detail: string }>(unreadable)).detail).toBe('Could not read PDF file.');
  });
});

describe('GET /:name/events', () => {
  it('sends the snapshot frames, then live room events with ids', async () => {
    insertBlueprint();
    const service = test.ctx.services.blueprints as BlueprintService;
    const project = service.openProject(repository.owner, repository.name, 'sample');
    // Publish after the subscriber is attached: the stream has no replay.
    const timer = setTimeout(() => service.publish(project, 'blueprint_sync', { blueprint: 'sample' }), 100);
    const frames = await readFrames(`${base}/sample/events`, 2);
    clearTimeout(timer);
    expect(frames[0]).toEqual({ event: 'build_errors_snapshot', data: { files: {} } });
    expect(frames[1]).toMatchObject({ event: 'blueprint_sync', data: { blueprint: 'sample' } });
    expect(frames[1].id).toMatch(/^\d+$/);
  });

  it('prefixes a persisted build stamp with build_snapshot and reports snapshot counts', async () => {
    insertBlueprint();
    atomicWriteJson(join(repoDir, '.lake', '.build-stamp.json'), {
      head: 'abc',
      worktree_hash: 'h',
      toolchain_hash: 't',
      manifest_hash: 'm',
      attempted_at: '2024-01-01T00:00:00Z',
      outcome: 'errors',
    });
    atomicWriteJson(join(repoDir, '.lake', '.build-errors.json'), {
      version: 2,
      updated_at: '2024-01-01T00:00:00Z',
      content_hashes: {},
      files: { 'Sample/Basic.lean': [{ file: 'Sample/Basic.lean', line: 1, column: 1, severity: 'error', message: 'boom' }] },
    });
    const frames = await readFrames(`${base}/sample/events`, 2);
    expect(frames[0]).toEqual({ event: 'build_snapshot', data: { status: 'done', steps: [] } });
    expect(frames[1]).toEqual({ event: 'build_errors_snapshot', data: { files: { 'Sample/Basic.lean': { errors: 1, warnings: 0 } } } });
  });

  it('polls the build-errors snapshot on heartbeats and emits build_errors_updated when it changes', async () => {
    insertBlueprint();
    const timer = setTimeout(() => {
      atomicWriteJson(join(repoDir, '.lake', '.build-errors.json'), {
        version: 2,
        updated_at: '2024-01-01T00:00:00Z',
        content_hashes: {},
        files: { 'Sample/Squares.lean': [{ file: 'Sample/Squares.lean', line: 2, column: 1, severity: 'warning', message: 'unused' }] },
      });
    }, 30);
    const frames = await readFrames(`${base}/sample/events`, 2, { includeHeartbeats: true });
    clearTimeout(timer);
    expect(frames[0].event).toBe('build_errors_snapshot');
    const updated = frames.find((frame) => frame.event === 'build_errors_updated');
    expect(updated?.data).toEqual({ files: { 'Sample/Squares.lean': { errors: 0, warnings: 1 } } });
    // The disk poll runs on the heartbeat tick; the update precedes the beat.
    expect(frames.every((frame) => ['build_errors_snapshot', 'build_errors_updated', 'heartbeat'].includes(frame.event))).toBe(true);
  });

  it('prefers the Lean service for snapshots and counts when it is registered', async () => {
    insertBlueprint();
    test.ctx.services.lean = {
      buildSnapshot: vi.fn(() => ({ status: 'running', steps: [{ phase: 'building', message: 'Building Lean project...' }] })),
      errorCounts: vi.fn(() => ({ 'Sample.lean': { errors: 2, warnings: 1 } })),
    };
    const frames = await readFrames(`${base}/sample/events`, 2);
    expect(frames[0]).toEqual({ event: 'build_snapshot', data: { status: 'running', steps: [{ phase: 'building', message: 'Building Lean project...' }] } });
    expect(frames[1]).toEqual({ event: 'build_errors_snapshot', data: { files: { 'Sample.lean': { errors: 2, warnings: 1 } } } });
  });

  it('starts the file watcher for the first subscriber and relays external edits', async () => {
    insertBlueprint();
    const service = test.ctx.services.blueprints as BlueprintService;
    const project = service.openProject(repository.owner, repository.name, 'sample');
    await service.getBlueprint(project);
    const timer = setTimeout(() => {
      write(repoDir, ENTRYPOINT, `${read(repoDir, ENTRYPOINT)}% external\n`);
    }, 150);
    const frames = await readFrames(`${base}/sample/events`, 3);
    clearTimeout(timer);
    expect(frames.map((frame) => frame.event)).toEqual(['build_errors_snapshot', 'blueprint_edit', 'blueprint_sync']);
    expect(service.isWatching(project.roomKey)).toBe(true);
  });
});
