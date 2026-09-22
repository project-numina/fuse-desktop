/**
 * Route-level tests for the repositories, git, sources, pull-request, auth
 * and system routes, driven through a Hono app the way app.ts mounts them.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { errorResponse } from '@main/server/errors';
import { createTestContext, type TestContext } from '@test/main/services/workspace/test-context';
import { authRoutes } from '@main/server/routes/auth';
import { additionalWritablePaths, gitRoutes } from '@main/server/routes/git';
import { pullRequestRoutes } from '@main/server/routes/pull-requests';
import { repositoryRoutes } from '@main/server/routes/repositories';
import { parseRangeHeader, sourceRoutes } from '@main/server/routes/sources';
import { systemRoutes } from '@main/server/routes/system';

const FIXTURE = join(__dirname, '..', '..', '..', '..', 'fixtures', 'sample-blueprint');

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

let test: TestContext;
let app: Hono;
let folder: string;

function buildApp(): Hono {
  const root = new Hono();
  root.onError((error, c) => errorResponse(c, error));
  const api = new Hono();
  api.route('/auth', authRoutes(test.ctx));
  api.route('/', systemRoutes(test.ctx));
  api.route('/repositories', repositoryRoutes(test.ctx));
  api.route('/repositories', sourceRoutes(test.ctx));
  api.route('/repositories', gitRoutes(test.ctx));
  api.route('/repositories', pullRequestRoutes(test.ctx));
  root.route('/api', api);
  return root;
}

async function json<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  return app.request(`http://localhost/api${path}`, init);
}

function postJson(path: string, body: unknown): Promise<Response> {
  return request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

beforeEach(() => {
  test = createTestContext();
  const empty = join(test.root, 'empty-gitconfig');
  writeFileSync(empty, '');
  process.env.GIT_CONFIG_GLOBAL = empty;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  folder = join(test.root, 'repo');
  cpSync(FIXTURE, folder, { recursive: true });
  git(folder, 'init', '-q', '-b', 'main');
  git(folder, 'config', 'user.name', 'Test');
  git(folder, 'config', 'user.email', 't@example.test');
  git(folder, 'add', '-A');
  git(folder, 'commit', '-q', '-m', 'fixture');
  app = buildApp();
});

afterEach(() => {
  delete process.env.GIT_CONFIG_GLOBAL;
  delete process.env.GIT_CONFIG_NOSYSTEM;
  test.cleanup();
});

async function registerFixture(): Promise<{ owner: string; name: string; id: number; weekly_commits: number[] }> {
  const response = await postJson('/repositories', { path: folder });
  expect(response.status).toBe(201);
  return json(response);
}

async function createBlueprint(owner: string, name: string, title = 'Demo'): Promise<string> {
  const repository = test.ctx.registry.requireRepository(owner, name);
  const { createWorkspace } = await import('@main/services/workspace');
  return (await createWorkspace(test.ctx, repository, { title })).blueprint_id;
}

describe('auth and system', () => {
  it('serves the local user and stubs', async () => {
    test.ctx.settings.update({ displayName: 'Ada' });
    const me = await json(await request('/auth/me'));
    expect(me).toMatchObject({ github_username: 'Ada', name: 'Ada', is_admin: false, user_group: 'numina', orchestrator_concurrency_max: 1 });
    expect((await request('/auth/logout', { method: 'POST' })).status).toBe(204);
    expect(await json(await request('/auth/me/push-config'))).toEqual({ enabled: false, vapid_public_key: null });
    expect(await json(await request('/push/config'))).toEqual({ enabled: false, vapid_public_key: null });
    expect(await json(await request('/deployment/status'))).toMatchObject({ phase: 'idle', show_banner: false });
    expect((await request('/health')).status).toBe(200);
  });
});

describe('repositories', () => {
  it('registers, lists, describes and unregisters folders', async () => {
    expect(await json(await request('/repositories'))).toEqual({ repositories: [], repositories_needing_setup: [], hidden_count: 0 });
    const created = await registerFixture();
    expect(created).toMatchObject({ owner: expect.any(String), name: 'repo', visibility: 'private', description: null });
    expect(created.weekly_commits).toHaveLength(52);
    const again = await postJson('/repositories', { path: folder });
    expect(again.status).toBe(200);
    const missing = await postJson('/repositories', { path: join(test.root, 'nope') });
    expect(missing.status).toBe(404);
    expect((await postJson('/repositories', {})).status).toBe(422);
    const list = await json<{ repositories: Array<{ id: number; updated_at: string }> }>(await request('/repositories'));
    expect(list.repositories).toHaveLength(1);
    expect(list.repositories[0].updated_at).toMatch(/^\d{4}-/);
    const activity = await json<Array<{ weekly_commits: number[] }>>(await request('/repositories/activity'));
    expect(activity[0].weekly_commits.reduce((sum, value) => sum + value, 0)).toBe(1);
    expect(await json(await request('/repositories/background-sessions'))).toEqual({});
    const detail = await json(await request(`/repositories/${created.owner}/${created.name}`));
    expect(detail).toMatchObject({ id: created.id, background_sessions: [] });
    expect((await request('/repositories/nobody/nothing')).status).toBe(404);
    expect((await request(`/repositories/${created.owner}/${created.name}`, { method: 'DELETE' })).status).toBe(204);
    expect((await request(`/repositories/${created.owner}/${created.name}`)).status).toBe(404);
  });

  it('forgetting a folder removes its workspaces, conversations and sources', async () => {
    const created = await registerFixture();
    const id = await createBlueprint(created.owner, created.name);
    const repository = test.ctx.registry.requireRepository(created.owner, created.name);
    test.ctx.registry.upsertConversation({
      id: 'conv-1', repository_id: repository.id, blueprint_id: id, title: null, status: 'completed', created_at: 'now', updated_at: 'now',
      completed_at: null, input_tokens: null, output_tokens: null, total_cost_usd: null, provider_thread_id: null, provider: 'claude', tier: 'completed',
      background_updates: [], roadblocks: [],
    });
    const form = new FormData();
    form.append('file', new File(['\\section{x}'], 'notes.tex'));
    expect((await request(`/repositories/${created.owner}/${created.name}/sources`, { method: 'POST', body: form })).status).toBe(200);
    expect(existsSync(test.ctx.paths.repositoryDir(repository.id))).toBe(true);
    test.ctx.services.sessions = { activeSessionsForRepository: () => [{ id: 'c', blueprint_name: id, title: null, tier: 'active', updated_at: null, background_updates: [], roadblocks: [] }] };
    expect((await request(`/repositories/${created.owner}/${created.name}`, { method: 'DELETE' })).status).toBe(409);
    test.ctx.services.sessions = { activeSessionsForRepository: () => [] };
    expect((await request(`/repositories/${created.owner}/${created.name}`, { method: 'DELETE' })).status).toBe(204);
    expect(test.ctx.registry.getConversation('conv-1')).toBeNull();
    expect(existsSync(test.ctx.paths.repositoryDir(repository.id))).toBe(false);
    // Nothing on disk in the folder is touched; re-adding starts clean.
    expect(existsSync(join(folder, 'Sample.lean'))).toBe(true);
    const again = await json<{ id: number; owner: string; name: string }>(await postJson('/repositories', { path: folder }));
    expect(await json(await request(`/repositories/${again.owner}/${again.name}/blueprints`.replace('/blueprints', '/sources')))).toEqual({ sources: [] });
  });

  it('lists branches, lakefiles and files', async () => {
    const { owner, name } = await registerFixture();
    git(folder, 'branch', 'numina/orphan');
    git(folder, 'branch', 'numina/lean-setup-x');
    git(folder, 'branch', 'feature');
    const blueprintId = await createBlueprint(owner, name, 'Orphan');
    expect(blueprintId).toBe('orphan');
    // A workspace runs on the checked-out branch, so that is the only offer.
    expect(await json(await request(`/repositories/${owner}/${name}/branches`))).toEqual({ default_branch: 'main', branches: ['main'] });
    git(folder, 'checkout', '-q', 'feature');
    expect(await json(await request(`/repositories/${owner}/${name}/branches`))).toEqual({ default_branch: 'feature', branches: ['feature'] });
    git(folder, 'checkout', '-q', 'main');
    const lakefiles = await json(await request(`/repositories/${owner}/${name}/lakefiles?ref=feature`));
    expect(lakefiles).toEqual({ lakefiles: [{ directory: '', lakefile: 'lakefile.toml', path: 'lakefile.toml' }], truncated: false });
    const file = await json<{ path: string; content: string; sha: string }>(await request(`/repositories/${owner}/${name}/files/blueprint/src/content.tex?ref=numina/orphan`));
    expect(file.path).toBe('blueprint/src/content.tex');
    expect(file.content).toContain('\\input');
    expect((await request(`/repositories/${owner}/${name}/files/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
    expect((await request(`/repositories/${owner}/${name}/files/blueprint`)).status).toBe(400);
    const raw = await request(`/repositories/${owner}/${name}/files-raw/Sample.lean`);
    expect(raw.headers.get('content-type')).toBe('application/octet-stream');
    expect(raw.headers.get('x-content-type-options')).toBe('nosniff');
    // VCS internals (a remote URL with credentials, say) are never served.
    expect((await request(`/repositories/${owner}/${name}/files/.git/config`)).status).toBe(404);
    expect((await request(`/repositories/${owner}/${name}/files-raw/.git/config`)).status).toBe(404);
    expect((await request(`/repositories/${owner}/${name}/files-raw/.git%2Fconfig`)).status).toBe(404);
    const files = await json<{ files: Array<{ path: string }>; clone_ready: boolean }>(await request(`/repositories/${owner}/${name}/repo-files?blueprint_name=orphan`));
    expect(files.clone_ready).toBe(true);
    expect(files.files.map((entry) => entry.path)).toContain('Sample.lean');
    expect((await request(`/repositories/${owner}/${name}/repo-files`)).status).toBe(422);
    expect((await request(`/repositories/${owner}/${name}/repo-files?blueprint_name=ghost`)).status).toBe(404);
    const viaBlueprint = await json<{ files: unknown[] }>(await request(`/repositories/${owner}/${name}/blueprints/orphan/files`));
    expect(viaBlueprint.files.length).toBe(files.files.length);
  });

  it('scaffolds a Lean project through setup', async () => {
    const empty = join(test.root, 'empty');
    mkdirSync(empty);
    git(empty, 'init', '-q', '-b', 'main');
    git(empty, 'config', 'user.name', 'Test');
    git(empty, 'config', 'user.email', 't@example.test');
    git(empty, 'commit', '--allow-empty', '-qm', 'initial');
    const created = await json<{ owner: string; name: string }>(await postJson('/repositories', { path: empty }));
    const response = await postJson(`/repositories/${created.owner}/${created.name}/setup`, { module_name: 'Demo', lean_version: 'v4.13.0' });
    expect(response.status).toBe(201);
    expect(await json(response)).toEqual({ default_branch: 'main', module_name: 'Demo', project_subdir: '', pull_request_url: null, pull_request_number: null });
    expect(git(empty, 'log', '-1', '--format=%s')).toBe('initial');
    expect(git(empty, 'status', '--porcelain')).toContain('?? lakefile.toml');
    // Setup never switches the folder's branch, even when asked for another one.
    git(empty, 'branch', 'feature');
    const elsewhere = await postJson(`/repositories/${created.owner}/${created.name}/setup`, { module_name: 'Other', lean_version: 'v4.13.0', target_subdir: 'other', base_branch: 'feature' });
    expect(elsewhere.status).toBe(409);
    expect(git(empty, 'branch', '--show-current')).toBe('main');
    expect((await postJson(`/repositories/${created.owner}/${created.name}/setup`, { module_name: 'demo' })).status).toBe(422);
    expect((await postJson(`/repositories/${created.owner}/${created.name}/setup`, { module_name: 'Demo', lean_version: 'v4.13.0' })).status).toBe(409);
  });
});

describe('git routes', () => {
  it('keeps explicit commits local even with an upstream and legacy AI messages enabled', async () => {
    const { owner, name } = await registerFixture();
    const id = await createBlueprint(owner, name);
    const remote = join(test.root, 'upstream.git');
    git(test.root, 'init', '--bare', remote);
    git(folder, 'remote', 'add', 'origin', remote);
    git(folder, 'push', '-u', 'origin', 'main');
    const original = git(remote, 'rev-parse', 'refs/heads/main');
    test.ctx.settings.update({ aiCommitMessages: true, claudePath: '/nonexistent/claude' });
    writeFileSync(join(folder, 'Sample.lean'), '-- user-requested edit\n');
    const result = await json<{ status: string }>(await postJson(`/repositories/${owner}/${name}/blueprints/${id}/commit`, {}));
    expect(result.status).toBe('committed');
    expect(git(folder, 'rev-parse', 'HEAD')).not.toBe(original);
    expect(git(remote, 'rev-parse', 'refs/heads/main')).toBe(original);
  });

  it('reads history and diffs and commits changes', async () => {
    const { owner, name } = await registerFixture();
    const id = await createBlueprint(owner, name);
    const base = `/repositories/${owner}/${name}/blueprints/${id}`;
    const commits = await json<{ commits: Array<{ sha: string; message: string; html_url: string | null }> }>(await request(`${base}/commits?limit=10`));
    expect(commits.commits).toHaveLength(1);
    expect(commits.commits[0].message).toBe('fixture');
    expect(commits.commits[0].html_url).toBeNull();
    expect((await request(`${base}/commits?limit=0`)).status).toBe(422);
    const detail = await json<{ files: Array<{ path: string }> }>(await request(`${base}/commits/${commits.commits[0].sha}`));
    expect(detail.files.map((file) => file.path)).toContain('Sample.lean');
    expect((await request(`${base}/commits/zzzz`)).status).toBe(404);
    expect((await request(`${base}/commits/--bad`)).status).toBe(404);
    expect(await json(await request(`${base}/diff`))).toEqual({ files: [] });
    writeFileSync(join(folder, 'blueprint', 'src', 'content.tex'), '% edited\n');
    const diff = await json<{ files: Array<{ path: string; status: string }> }>(await request(`${base}/diff`));
    expect(diff.files).toEqual([expect.objectContaining({ path: 'blueprint/src/content.tex', status: 'modified' })]);
    let events = 0;
    test.ctx.blueprintRooms.get(`${owner}/${name}/${id}`).subscribe(() => {
      events += 1;
    });
    const committed = await json<{ status: string; commit_sha: string }>(await postJson(`${base}/commit`, { message: 'Edit content\n\nDetails' }));
    expect(committed.status).toBe('committed');
    expect(git(folder, 'log', '-1', '--format=%B')).toBe(`Edit content\n\nDetails\n\nUser: Test\nBlueprint: ${id}\nRepository: ${owner}/${name}`);
    expect(git(folder, 'log', '-1', '--format=%an <%ae>')).toBe('Test <t@example.test>');
    expect(events).toBe(1);
    const nothing = await json<{ status: string }>(await postJson(`${base}/commit`, { message: null }));
    expect(nothing.status).toBe('no_changes');
    writeFileSync(join(folder, 'Sample', 'New.lean'), 'theorem t : True := trivial\n');
    const generated = await json<{ status: string }>(await postJson(`${base}/commit`, {}));
    expect(generated.status).toBe('committed');
    expect(git(folder, 'log', '-1', '--format=%s')).toBe('Update Sample/New.lean');
    // Desktop shape: the checked-out branch, whether a remote exists, and the
    // web's BlueprintBranchStatus only when there is a remote to compare with.
    expect((await request(`${base}/branch-status`).then(json))).toEqual({ branch: 'main', has_remote: false, status: null });
    expect((await request(`${base}/branch-freshness`).then(json))).toMatchObject({ default_branch: 'main', commits_behind: 0, is_stale: false });
    const sync = await json(await postJson(`${base}/sync`, {}));
    expect(sync).toMatchObject({ status: 'up_to_date' });
    const syncMain = await json(await postJson(`${base}/sync-main`, {}));
    expect(syncMain).toMatchObject({ status: 'up_to_date', freshness: expect.objectContaining({ default_branch: 'main' }) });
    expect((await request(`${base}/commits`.replace(id, 'Bad_Name'))).status).toBe(400);
    expect((await request(`${base}/commits`.replace(id, 'ghost'))).status).toBe(404);
  });

  it('commits transitively included chapters outside a nested project', async () => {
    const { owner, name } = await registerFixture();
    // A nested Lean project whose blueprint lives in docs/ and \inputs a sibling folder.
    mkdirSync(join(folder, 'lean', 'Proj'), { recursive: true });
    writeFileSync(join(folder, 'lean', 'lakefile.toml'), 'name = "Proj"\n');
    mkdirSync(join(folder, 'docs', 'chapters'), { recursive: true });
    writeFileSync(join(folder, 'docs', 'main.tex'), '\\input{chapters/ch1}\n');
    writeFileSync(join(folder, 'docs', 'chapters', 'ch1.tex'), '\\section{One}\n');
    git(folder, 'add', '-A');
    git(folder, 'commit', '-q', '-m', 'nested');
    const repository = test.ctx.registry.requireRepository(owner, name);
    const { createWorkspace, projectFromRows } = await import('@main/services/workspace');
    const { blueprint_id: id } = await createWorkspace(test.ctx, repository, { title: 'Nested', project_subdir: 'lean', existing_blueprint_path: 'docs/main.tex' });
    const project = projectFromRows(repository, test.ctx.registry.requireBlueprint(repository.id, id));
    expect(additionalWritablePaths(project)).toEqual(['docs/main.tex', 'docs/chapters/ch1.tex']);
    writeFileSync(join(folder, 'docs', 'chapters', 'ch1.tex'), '\\section{One}\n\\section{Two}\n');
    writeFileSync(join(folder, 'lean', 'Proj', 'A.lean'), 'theorem a : True := trivial\n');
    writeFileSync(join(folder, 'README.md'), 'unrelated\n');
    const committed = await json<{ status: string }>(await postJson(`/repositories/${owner}/${name}/blueprints/${id}/commit`, { message: 'chapter' }));
    expect(committed.status).toBe('committed');
    expect(git(folder, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual(['docs/chapters/ch1.tex', 'lean/Proj/A.lean']);
    expect(git(folder, 'status', '--porcelain')).toBe('?? README.md');
  });

  it('degrades for a folder that is not a git repository', async () => {
    const plain = join(test.root, 'plain');
    mkdirSync(plain);
    writeFileSync(join(plain, 'lakefile.toml'), 'name = "x"\n');
    const created = await json<{ owner: string; name: string }>(await postJson('/repositories', { path: plain }));
    const id = await createBlueprint(created.owner, created.name, 'Plain');
    const base = `/repositories/${created.owner}/${created.name}/blueprints/${id}`;
    expect(await json(await request(`${base}/commits`))).toEqual({ commits: [] });
    expect(await json(await request(`${base}/diff`))).toEqual({ files: [] });
    expect((await request(`${base}/commits/deadbeef`)).status).toBe(404);
    expect((await postJson(`${base}/commit`, { message: 'x' })).status).toBe(409);
    expect(await json(await request(`${base}/branch-status`))).toEqual({ branch: null, has_remote: false, status: null });
    expect(await json(await request(`${base}/branches`.replace(`/blueprints/${id}`, '')))).toEqual({ default_branch: 'main', branches: ['main'] });
  });
});

describe('sources routes', () => {
  it('uploads, lists, serves ranges and deletes', async () => {
    const { owner, name } = await registerFixture();
    const id = await createBlueprint(owner, name);
    const base = `/repositories/${owner}/${name}/sources`;
    const form = new FormData();
    form.append('file', new File([`${'x'.repeat(70_000)}\ntail`], 'notes.tex', { type: 'text/plain' }));
    form.append('display_name', 'Notes');
    form.append('project_scoped', 'true');
    form.append('blueprint_id', id);
    const uploaded = await json<{ id: string; display_name: string; artifacts: string[]; metadata: Record<string, unknown> }>(await request(base, { method: 'POST', body: form }));
    expect(uploaded.display_name).toBe('Notes');
    expect(uploaded.artifacts).toEqual(['original', 'latex']);
    expect(uploaded.metadata).toEqual({ project_scoped: true, scoped_blueprint_id: id });
    const listed = await json<{ sources: Array<{ id: string }> }>(await request(`${base}?blueprint_id=${id}`));
    expect(listed.sources.map((source) => source.id)).toEqual([uploaded.id]);
    expect((await json<{ sources: unknown[] }>(await request(base))).sources).toEqual([]);
    const partial = await request(`${base}/${uploaded.id}/artifacts/latex?blueprint_id=${id}`, { headers: { Range: 'bytes=0-65535' } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe('bytes 0-65535/70005');
    expect(partial.headers.get('content-type')).toBe('text/plain');
    expect(partial.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await partial.text()).length).toBe(65536);
    const full = await request(`${base}/${uploaded.id}/artifacts/original?blueprint_id=${id}`);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-length')).toBe('70005');
    expect((await request(`${base}/${uploaded.id}/artifacts/latex?blueprint_id=${id}`, { headers: { Range: 'bytes=99999999-' } })).status).toBe(416);
    expect((await request(`${base}/${uploaded.id}/artifacts/ocr?blueprint_id=${id}`)).status).toBe(404);
    expect((await request(`${base}/${uploaded.id}/artifacts/latex`)).status).toBe(404);
    expect((await request(`${base}/${uploaded.id}/pdf-preview?blueprint_id=${id}`)).status).toBe(404);
    const bad = new FormData();
    bad.append('file', new File(['x'], 'x.docx'));
    const rejected = await request(base, { method: 'POST', body: bad });
    expect(rejected.status).toBe(400);
    expect(await json(rejected)).toMatchObject({ detail: 'Unsupported file type. Please upload a .tex, .md, .markdown, or .pdf file.' });
    const imported = await json<{ id: string; display_name: string }>(await postJson(`${base}/import`, { blueprint_id: id, repo_path: 'blueprint/src/chapters/squares.tex' }));
    expect(imported.display_name).toBe('blueprint/src/chapters/squares.tex');
    expect((await postJson(`${base}/import`, { blueprint_id: id, repo_path: 'Sample.lean' })).status).toBe(400);
    expect((await postJson(`${base}/import`, { blueprint_id: 'ghost', repo_path: 'x.tex' })).status).toBe(404);
    expect((await request(`${base}/${uploaded.id}?blueprint_id=${id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await request(`${base}/${uploaded.id}?blueprint_id=${id}`)).status).toBe(404);
  });

  it('parses range headers', () => {
    expect(parseRangeHeader(undefined, 10)).toBeNull();
    expect(parseRangeHeader('bytes=0-3', 10)).toEqual({ start: 0, end: 3 });
    expect(parseRangeHeader('bytes=5-', 10)).toEqual({ start: 5, end: 9 });
    expect(parseRangeHeader('bytes=-2', 10)).toEqual({ start: 8, end: 9 });
    expect(parseRangeHeader('bytes=0-100', 10)).toEqual({ start: 0, end: 9 });
    expect(parseRangeHeader('bytes=10-', 10)).toBe('unsatisfiable');
    expect(parseRangeHeader('items=1-2', 10)).toBeNull();
  });
});

describe('pull requests', () => {
  it('answers with nothing tracked', async () => {
    const { owner, name } = await registerFixture();
    const id = await createBlueprint(owner, name);
    expect(await json(await request(`/repositories/${owner}/${name}/pull-requests`))).toEqual([]);
    expect(await json(await request(`/repositories/${owner}/${name}/blueprints/${id}/pull-request-status`))).toEqual({ open_pr_number: null });
    expect((await request(`/repositories/${owner}/${name}/pulls/1`)).status).toBe(404);
    expect((await request(`/repositories/${owner}/${name}/pulls/1/close`, { method: 'POST' })).status).toBe(404);
  });
});
