import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, parseSourceUpload, PDF_PAGE_RANGE_UNSUPPORTED_DETAIL } from '@main/services/workspace/create';
import { deleteWorkspace } from '@main/services/workspace/delete';
import { generateBlueprintId, safeBlueprintFilePath, sanitizeModuleName, validateLeanVersion, validateModuleName, validateProjectSubdir } from '@main/services/workspace/ids';
import { discoverLakefiles, selectLakefiles } from '@main/services/workspace/lakefiles';
import { listBlueprintCandidates, readRepoFile, repoFiles, walkRepoFiles } from '@main/services/workspace/repo-files';
import { buildLeanProjectScaffold, createStarterBlueprint, scaffoldLeanProject, STARTER_BLUEPRINT_TEX, STARTER_CHAPTER_TEX, writeStarterBlueprint } from '@main/services/workspace/scaffold';
import { projectFromRows } from '@main/services/workspace/contracts';
import { createTestContext, type TestContext } from '@test/main/services/workspace/test-context';

const FIXTURE = join(__dirname, '..', '..', '..', '..', 'fixtures', 'sample-blueprint');

// Minimal PDFs that pdf.js parses (one and two pages).
const TINY_PDF = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF',
);
const TWO_PAGE_PDF = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n4 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
);
const isWindows = process.platform === 'win32';
const emptyGitConfig = { GIT_CONFIG_GLOBAL: '', GIT_CONFIG_NOSYSTEM: '1' };

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, env: { ...process.env, ...emptyGitConfig } }).trim();
}

let test: TestContext;

beforeEach(() => {
  test = createTestContext();
  const empty = join(test.root, 'empty-gitconfig');
  writeFileSync(empty, '');
  emptyGitConfig.GIT_CONFIG_GLOBAL = empty;
  process.env.GIT_CONFIG_GLOBAL = empty;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
});

afterEach(() => {
  delete process.env.GIT_CONFIG_GLOBAL;
  delete process.env.GIT_CONFIG_NOSYSTEM;
  test.cleanup();
});

function copyFixture(name = 'repo'): string {
  const dir = join(test.root, name);
  cpSync(FIXTURE, dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 't@example.test');
    git(dir, 'commit', '--allow-empty', '-qm', 'initial');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'fixture');
  return dir;
}

describe('ids and validation', () => {
  it('generates blueprint ids like the web and the JS titleToId', () => {
    expect(generateBlueprintId('Hello World')).toBe('hello-world');
    expect(generateBlueprintId('  Fermat_last--theorem!! ')).toBe('fermat-last-theorem');
    expect(generateBlueprintId('___')).toBe('blueprint');
    expect(generateBlueprintId('Ünïcode Title')).toBe('ncode-title');
  });

  it('validates project subdirectories', () => {
    expect(validateProjectSubdir('')).toBe('');
    expect(validateProjectSubdir(' /lean/proj/ ')).toBe('lean/proj');
    expect(() => validateProjectSubdir('../x')).toThrow(/Subfolder must be a relative path/);
    expect(() => validateProjectSubdir('.hidden')).toThrow(/Subfolder/);
    expect(() => validateProjectSubdir('a b')).toThrow(/Subfolder/);
  });

  it('validates module names and versions', () => {
    expect(validateModuleName(' Froda ')).toBe('Froda');
    expect(() => validateModuleName('froda')).toThrow(/Module name must start with a capital letter/);
    expect(() => validateModuleName('Mathlib')).toThrow(/reserved/);
    expect(validateLeanVersion('v4.13.0')).toBe('v4.13.0');
    expect(validateLeanVersion('v4.14.0-rc1')).toBe('v4.14.0-rc1');
    expect(() => validateLeanVersion('4.13')).toThrow(/Lean version must look like/);
    expect(sanitizeModuleName('my-cool_repo 2')).toBe('MyCoolRepo');
    expect(sanitizeModuleName('123')).toBe('Project');
    expect(safeBlueprintFilePath('blueprint/src/content.tex')).toBe('blueprint/src/content.tex');
    expect(safeBlueprintFilePath('../x.tex')).toBeNull();
    expect(safeBlueprintFilePath('/abs.tex')).toBeNull();
    expect(safeBlueprintFilePath('notes.md')).toBeNull();
  });
});

describe('lakefiles', () => {
  it('finds projects beyond large unrelated folders and skips caches and agent worktrees', async () => {
    const dir = join(test.root, 'large-repo');
    mkdirSync(join(dir, 'z-data'), { recursive: true });
    for (let i = 0; i < 5100; i += 1) {
      writeFileSync(join(dir, 'z-data', `${i}.txt`), '');
    }
    for (const project of ['lean/kakeya', 'lean/conjectures', 'deep/nested/project']) {
      mkdirSync(join(dir, project), { recursive: true });
      writeFileSync(join(dir, project, 'lakefile.toml'), '');
    }
    for (const cache of ['__pycache__', '.venv', '.claude', '.codex', '.worktrees', '.lake', 'node_modules']) {
      mkdirSync(join(dir, cache, 'nested'), { recursive: true });
      writeFileSync(join(dir, cache, 'nested', 'lakefile.lean'), '');
    }
    const result = await discoverLakefiles(dir);
    expect(result.truncated).toBe(false);
    expect(result.lakefiles.map((entry) => entry.path)).toEqual([
      'deep/nested/project/lakefile.toml', 'lean/conjectures/lakefile.toml', 'lean/kakeya/lakefile.toml',
    ]);
  });

  it('prefers lakefile.toml per directory and sorts by directory', () => {
    const entries = selectLakefiles(['b/lakefile.lean', 'lakefile.lean', 'lakefile.toml', 'a/x/lakefile.lean', 'docs/readme.md']);
    expect(entries).toEqual([
      { directory: '', lakefile: 'lakefile.toml', path: 'lakefile.toml' },
      { directory: 'a/x', lakefile: 'lakefile.lean', path: 'a/x/lakefile.lean' },
      { directory: 'b', lakefile: 'lakefile.lean', path: 'b/lakefile.lean' },
    ]);
  });

  it('walks the working tree whatever ref is asked for', async () => {
    const dir = copyFixture();
    mkdirSync(join(dir, 'nested'));
    writeFileSync(join(dir, 'nested', 'lakefile.lean'), 'import Lake\n');
    mkdirSync(join(dir, '.lake', 'packages', 'dep'), { recursive: true });
    writeFileSync(join(dir, '.lake', 'packages', 'dep', 'lakefile.toml'), '');
    const discovered = await discoverLakefiles(dir);
    expect(discovered.lakefiles.map((entry) => entry.path)).toEqual(['lakefile.toml', 'nested/lakefile.lean']);
    expect(discovered.truncated).toBe(false);
    // The workspace builds the checkout, so another branch's projects are
    // never offered: ``ref`` is ignored.
    git(dir, 'branch', 'other', 'HEAD');
    const fromRef = await discoverLakefiles(dir, 'other');
    expect(fromRef.lakefiles.map((entry) => entry.path)).toEqual(['lakefile.toml', 'nested/lakefile.lean']);
    const plain = join(test.root, 'plain');
    mkdirSync(plain);
    writeFileSync(join(plain, 'lakefile.toml'), '');
    expect((await discoverLakefiles(plain, 'main')).lakefiles).toHaveLength(1);
  });
});

describe('scaffold', () => {
  it('builds the four files verbatim', () => {
    const scaffold = buildLeanProjectScaffold('Froda', { leanToolchain: 'leanprover/lean4:v4.13.0', mathlibRevision: 'v4.13.0', projectSubdir: 'lean' });
    expect(scaffold.files).toEqual([
      ['lean/lakefile.toml', 'name = "Froda"\ndefaultTargets = ["Froda"]\n\n[[require]]\nname = "mathlib"\nscope = "leanprover-community"\nversion = "git#v4.13.0"\n\n[[lean_lib]]\nname = "Froda"\n'],
      ['lean/lean-toolchain', 'leanprover/lean4:v4.13.0\n'],
      ['lean/Froda.lean', 'import Froda.Basic\n'],
      ['lean/Froda/Basic.lean', 'import Mathlib\n\nnamespace Froda\n\n-- Add your definitions and theorems here.\n\nend Froda\n'],
    ]);
    const bare = buildLeanProjectScaffold('Bare', { leanToolchain: 'leanprover/lean4:v4.25.0\n', mathlibRevision: null });
    expect(bare.files[0][1]).toBe('name = "Bare"\ndefaultTargets = ["Bare"]\n\n[[lean_lib]]\nname = "Bare"\n');
    expect(bare.files[3][1]).toBe('namespace Bare\n\n-- Add your definitions and theorems here.\n\nend Bare\n');
    expect(() => buildLeanProjectScaffold('Bad', { leanToolchain: 'not a spec', mathlibRevision: null })).toThrow(/lean_toolchain/);
  });

  it('writes an uncommitted project into a git folder, refusing overwrites', async () => {
    const dir = join(test.root, 'new');
    mkdirSync(dir);
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'user.email', 't@example.test');
    git(dir, 'commit', '--allow-empty', '-qm', 'initial');
    const fetchImpl = (async () => new Response('leanprover/lean4:v4.99.0\n')) as unknown as typeof fetch;
    const result = await scaffoldLeanProject(dir, { moduleName: 'Demo', fetchImpl });
    expect(result).toEqual({ default_branch: 'main', module_name: 'Demo', project_subdir: '', pull_request_url: null, pull_request_number: null });
    expect(readFileSync(join(dir, 'lean-toolchain'), 'utf8')).toBe('leanprover/lean4:v4.99.0\n');
    expect(git(dir, 'log', '-1', '--format=%s')).toBe('initial');
    expect(git(dir, 'status', '--porcelain')).toContain('?? lakefile.toml');
    await expect(scaffoldLeanProject(dir, { moduleName: 'Demo', leanVersion: 'v4.13.0' })).rejects.toMatchObject({
      status: 409,
      detail: "'lakefile.toml' already exists on main; setup would overwrite it.",
    });
    const nested = await scaffoldLeanProject(dir, { moduleName: 'Sub', leanVersion: 'v4.13.0', targetSubdir: 'sub' });
    expect(nested.project_subdir).toBe('sub');
    expect(git(dir, 'log', '-1', '--format=%s')).toBe('initial');
    await expect(scaffoldLeanProject(dir, { moduleName: 'bad' })).rejects.toMatchObject({ status: 422 });
    // The base branch is a check, never a checkout.
    git(dir, 'branch', 'feature');
    await expect(scaffoldLeanProject(dir, { moduleName: 'Elsewhere', leanVersion: 'v4.13.0', targetSubdir: 'elsewhere', baseBranch: 'refs/heads/feature' })).rejects.toMatchObject({
      status: 409,
      detail: 'Setup runs on the checked-out branch (main); check out feature in the folder first.',
    });
    expect(git(dir, 'branch', '--show-current')).toBe('main');
    expect(existsSync(join(dir, 'elsewhere'))).toBe(false);
    expect((await scaffoldLeanProject(dir, { moduleName: 'Same', leanVersion: 'v4.13.0', targetSubdir: 'same', baseBranch: 'main' })).default_branch).toBe('main');
    const plain = join(test.root, 'plain');
    mkdirSync(plain);
    const offline = await scaffoldLeanProject(plain, { moduleName: 'Plain', leanVersion: 'v4.13.0' });
    expect(offline.default_branch).toBe('main');
    expect(existsSync(join(plain, 'Plain', 'Basic.lean'))).toBe(true);
  });

  it('leaves scaffold files uncommitted and preserves pre-staged changes', async () => {
    const dir = join(test.root, 'staged');
    mkdirSync(dir);
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'user.email', 't@example.test');
    writeFileSync(join(dir, 'README.md'), 'hi\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    writeFileSync(join(dir, 'staged.txt'), 'staged\n');
    git(dir, 'add', 'staged.txt');
    writeFileSync(join(dir, 'README.md'), 'edited\n');
    await scaffoldLeanProject(dir, { moduleName: 'Demo', leanVersion: 'v4.13.0', targetSubdir: 'newproj' });
    expect(git(dir, 'log', '-1', '--format=%s')).toBe('base');
    expect(git(dir, 'status', '--porcelain')).toContain('?? newproj/');
    expect(git(dir, 'diff', '--cached', '--name-only')).toBe('staged.txt');
    expect(git(dir, 'diff', '--name-only')).toBe('README.md');
  });

  it('writes the starter blueprint once and adopts an existing one', async () => {
    const dir = join(test.root, 'starter');
    mkdirSync(join(dir, 'proj'), { recursive: true });
    const first = await writeStarterBlueprint(dir, 'proj');
    expect(first).toEqual({ existed: false, entrypoint: 'proj/blueprint/src/content.tex' });
    expect(readFileSync(join(dir, 'proj', 'blueprint', 'src', 'content.tex'), 'utf8')).toBe(STARTER_BLUEPRINT_TEX);
    expect(readFileSync(join(dir, 'proj', 'blueprint', 'src', 'chapters', 'example_chapter.tex'), 'utf8')).toBe(STARTER_CHAPTER_TEX);
    writeFileSync(join(dir, 'proj', 'blueprint', 'src', 'content.tex'), '% custom\n');
    expect(await writeStarterBlueprint(dir, 'proj')).toEqual({ existed: true, entrypoint: 'proj/blueprint/src/content.tex' });
    expect(readFileSync(join(dir, 'proj', 'blueprint', 'src', 'content.tex'), 'utf8')).toBe('% custom\n');
    const repository = test.ctx.registry.addRepository(dir);
    test.ctx.registry.insertBlueprint({
      id: 'demo', repository_id: repository.id, title: 'Demo', description: '', area: '', blueprint_file: null, project_subdir: '',
      source_type: 'none', source_id: null, pr_mode: 'off', auto_commit: true, orchestrator_child_concurrency: 1,
      agent: test.ctx.settings.get().agentDefaults, created_at: 'now', updated_at: 'now',
    });
    const project = projectFromRows(repository, test.ctx.registry.requireBlueprint(repository.id, 'demo'));
    const created = await createStarterBlueprint(project);
    expect(created).toEqual({ blueprint_file: 'blueprint/src/content.tex', included_files: ['blueprint/src/chapters/example_chapter.tex'], entry_count: 0 });
    const persisted = await createStarterBlueprint(project, test.ctx);
    expect(persisted.blueprint_file).toBe('blueprint/src/content.tex');
    expect(test.ctx.registry.requireBlueprint(repository.id, 'demo').blueprint_file).toBe('blueprint/src/content.tex');
  });
});

describe('repository files', () => {
  it('walks files with exclusions and reads them with blob shas', async () => {
    const dir = copyFixture();
    mkdirSync(join(dir, 'numina', 'sub'), { recursive: true });
    writeFileSync(join(dir, 'numina', 'sub', 'x.txt'), 'x');
    mkdirSync(join(dir, 'src', 'numina'), { recursive: true });
    writeFileSync(join(dir, 'src', 'numina', 'ok.txt'), 'ok');
    if (!isWindows) symlinkSync('Sample.lean', join(dir, 'link.lean'));
    const { files, truncated } = await walkRepoFiles(dir);
    const paths = files.map((file) => file.path);
    expect(truncated).toBe(false);
    expect(paths).toContain('blueprint/src/content.tex');
    expect(paths).toContain('src/numina/ok.txt');
    expect(paths).toContain('numina/sub/x.txt');
    expect(paths.some((path) => path.startsWith('.lake/') || path.startsWith('.git/'))).toBe(false);
    expect(paths).not.toContain('link.lean');
    expect(paths).toEqual([...paths].sort());
    const listing = await repoFiles(dir);
    expect(listing.clone_ready).toBe(true);
    expect((await repoFiles(join(test.root, 'nope'))).clone_ready).toBe(false);
    const content = await readRepoFile(dir, 'Sample.lean');
    expect(content.name).toBe('Sample.lean');
    expect(content.sha).toBe(git(dir, 'rev-parse', 'HEAD:Sample.lean'));
    expect(content.size).toBe(Buffer.byteLength(content.content));
    await expect(readRepoFile(dir, '../outside.txt')).rejects.toMatchObject({ status: 404 });
    // VCS internals are not served; ordinary numina folders are.
    await expect(readRepoFile(dir, '.git/config')).rejects.toMatchObject({ status: 404 });
    expect((await readRepoFile(dir, 'numina/sub/x.txt')).content).toBe('x');
    expect((await readRepoFile(dir, 'src/numina/ok.txt')).content).toBe('ok');
    await expect(readRepoFile(dir, 'Sample')).rejects.toMatchObject({ status: 400 });
    await expect(readRepoFile(dir, 'missing.tex')).rejects.toMatchObject({ status: 404 });
  });

  it('lists blueprint candidates with the blueprint folder first', async () => {
    const dir = copyFixture();
    mkdirSync(join(dir, 'alt', 'src'), { recursive: true });
    writeFileSync(join(dir, 'alt', 'src', 'content.tex'), '%');
    mkdirSync(join(dir, '.lake', 'packages', 'dep', 'blueprint', 'src'), { recursive: true });
    writeFileSync(join(dir, '.lake', 'packages', 'dep', 'blueprint', 'src', 'content.tex'), '%');
    const candidates = await listBlueprintCandidates(dir);
    expect(candidates.map((candidate) => candidate.name)).toEqual(['blueprint', 'alt']);
    expect(candidates[0].path).toBe('blueprint/src/content.tex');
  });
});

describe('createWorkspace / deleteWorkspace', () => {
  it('validates the form and persists the row with agent defaults', async () => {
    const dir = copyFixture();
    const repository = test.ctx.registry.addRepository(dir);
    await expect(createWorkspace(test.ctx, repository, { title: '  ' })).rejects.toMatchObject({ status: 400, detail: 'Title is required' });
    await expect(createWorkspace(test.ctx, repository, { title: 'X', project_subdir: '../x' })).rejects.toMatchObject({ status: 422 });
    await expect(createWorkspace(test.ctx, repository, { title: 'X', existing_blueprint_path: 'notes.md' })).rejects.toMatchObject({ status: 422 });
    await expect(createWorkspace(test.ctx, repository, { title: 'X', existing_blueprint_path: 'a.tex', latex_content: '\\section{x}' })).rejects.toMatchObject({ status: 422 });
    await expect(createWorkspace(test.ctx, repository, { title: 'X', latex_content: 'x'.repeat(50_001) })).rejects.toMatchObject({ status: 400, detail: 'LaTeX source is too large (50,001 characters). Maximum is 50,000 characters.' });
    git(dir, 'branch', 'feature');
    await expect(createWorkspace(test.ctx, repository, { title: 'X', base_branch: 'feature' })).rejects.toMatchObject({
      status: 409,
      detail: 'Workspaces run on the checked-out branch (main); check out feature in the folder first.',
    });
    expect(test.ctx.registry.listBlueprints(repository.id)).toEqual([]);
    const response = await createWorkspace(test.ctx, repository, { title: 'My First Blueprint', base_branch: 'main', project_subdir: '' });
    expect(response).toEqual({ blueprint_id: 'my-first-blueprint', message: "Blueprint 'My First Blueprint' created successfully" });
    const row = test.ctx.registry.requireBlueprint(repository.id, 'my-first-blueprint');
    expect(row.title).toBe('My First Blueprint');
    expect(row.blueprint_file).toBe('blueprint/src/content.tex');
    expect(row.agent).toEqual(test.ctx.settings.get().agentDefaults);
    expect(row.auto_commit).toBe(false);
    await expect(createWorkspace(test.ctx, repository, { title: 'my first blueprint' })).rejects.toMatchObject({ status: 409, detail: 'A blueprint with this title already exists.' });
  });

  it('stores an uploaded source scoped to the blueprint and cleans up on delete', async () => {
    const dir = copyFixture();
    const repository = test.ctx.registry.addRepository(dir);
    const response = await createWorkspace(
      test.ctx,
      repository,
      { title: 'With Source' },
      { name: 'paper.tex', bytes: new TextEncoder().encode('\\begin{theorem}x\\end{theorem}\n') },
    );
    const row = test.ctx.registry.requireBlueprint(repository.id, response.blueprint_id);
    expect(row.source_type).toBe('latex');
    const sources = test.ctx.registry.listSources(repository.id);
    expect(sources).toHaveLength(1);
    expect(sources[0].id).toBe(row.source_id);
    expect(sources[0].display_name).toBe('paper.tex');
    expect(sources[0].metadata).toMatchObject({ blueprint_id: 'with-source', blueprint_title: 'With Source', created_from: 'blueprint_create' });
    test.ctx.registry.upsertConversation({
      id: 'conv-1', repository_id: repository.id, blueprint_id: 'with-source', title: null, status: 'completed', created_at: 'now', updated_at: 'now',
      completed_at: null, input_tokens: null, output_tokens: null, total_cost_usd: null, provider_thread_id: null, provider: 'claude', tier: 'completed',
      background_updates: [], roadblocks: [],
    });
    const project = projectFromRows(repository, row);
    test.ctx.services.sessions = { activeSessionsForRepository: () => [{ id: 'c', blueprint_name: 'with-source', title: null, tier: 'active', updated_at: null, background_updates: [], roadblocks: [] }] };
    await expect(deleteWorkspace(test.ctx, project)).rejects.toMatchObject({ status: 409, detail: 'Cannot delete a blueprint with active agent sessions.' });
    test.ctx.services.sessions = { activeSessionsForRepository: () => [] };
    await deleteWorkspace(test.ctx, project);
    expect(test.ctx.registry.getBlueprint(repository.id, 'with-source')).toBeNull();
    expect(test.ctx.registry.getConversation('conv-1')).toBeNull();
    expect(test.ctx.registry.listSources(repository.id)[0].status).toBe('archived');
    await deleteWorkspace(test.ctx, project);
    expect(existsSync(join(dir, 'Sample.lean'))).toBe(true);
  });

  it('parses source uploads', async () => {
    await expect(parseSourceUpload({ name: 'x.docx', bytes: new Uint8Array(3) }, '')).rejects.toThrow('Unsupported file type. Please upload a .tex or .pdf file.');
    await expect(parseSourceUpload({ name: 'x.tex', bytes: new Uint8Array([0xff, 0xfe]) }, '')).rejects.toThrow('Uploaded .tex file is not valid UTF-8.');
    await expect(parseSourceUpload({ name: 'x.pdf', bytes: new TextEncoder().encode('nope') }, '')).rejects.toThrow('Could not read PDF file. It may be corrupt or not a PDF.');
    await expect(parseSourceUpload({ name: 'x.pdf', bytes: new Uint8Array(20 * 1024 * 1024 + 1) }, '')).rejects.toThrow('File is too large. Maximum upload size is 20 MB.');
    expect(await parseSourceUpload(null, 'text')).toEqual({ sourceLatex: 'text', sourcePdfBytes: null });
    expect(await parseSourceUpload(null, '')).toEqual({ sourceLatex: '', sourcePdfBytes: null });
    // A page range is validated, but only the whole document can be stored.
    const pdf = { name: 'x.pdf', bytes: TINY_PDF };
    await expect(parseSourceUpload(pdf, '', 1, 2)).rejects.toThrow('Invalid page range 1–2 for a 1-page PDF.');
    await expect(parseSourceUpload(pdf, '', 0, 1)).rejects.toThrow('Invalid page range 0–1 for a 1-page PDF.');
    expect(await parseSourceUpload(pdf, '', 1, 1)).toEqual({ sourceLatex: '', sourcePdfBytes: TINY_PDF });
    const twoPages = { name: 'y.pdf', bytes: TWO_PAGE_PDF };
    await expect(parseSourceUpload(twoPages, '', 2, 2)).rejects.toThrow(PDF_PAGE_RANGE_UNSUPPORTED_DETAIL);
    expect(await parseSourceUpload(twoPages, '', 1, 2)).toEqual({ sourceLatex: '', sourcePdfBytes: TWO_PAGE_PDF });
  });
});
