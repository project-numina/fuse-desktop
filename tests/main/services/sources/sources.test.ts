import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RepositoryRow } from '@main/store/rows';
import { projectFromRows } from '@main/services/workspace/contracts';
import { createTestContext, type TestContext } from '@test/main/services/workspace/test-context';
import { countTextLines, deriveOcrPhase, isSourceVisibleInContext, normalizeRepositoryFilePath, publicSourceMetadata, repositoryFilePathIsExcluded, type SourceService } from '@main/services/sources/index';

// A minimal one-page PDF that pdf.js parses.
const TINY_PDF = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF',
);

let test: TestContext;
let service: SourceService;
let repository: RepositoryRow;
let folder: string;

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function addBlueprint(id: string): void {
  test.ctx.registry.insertBlueprint({
    id, repository_id: repository.id, title: id, description: '', area: '', blueprint_file: null, project_subdir: '', source_type: 'none',
    source_id: null, pr_mode: 'off', auto_commit: true, orchestrator_child_concurrency: 1, agent: test.ctx.settings.get().agentDefaults,
    created_at: 'now', updated_at: 'now',
  });
}

beforeEach(() => {
  test = createTestContext();
  service = test.ctx.services.sources as SourceService;
  folder = join(test.root, 'repo');
  mkdirSync(folder);
  repository = test.ctx.registry.addRepository(folder);
  addBlueprint('alpha');
  addBlueprint('beta');
});

afterEach(() => test.cleanup());

describe('helpers', () => {
  it('counts lines like Python splitlines', () => {
    expect(countTextLines('')).toBe(0);
    expect(countTextLines('a')).toBe(1);
    expect(countTextLines('a\n')).toBe(1);
    expect(countTextLines('a\r\nb')).toBe(2);
    expect(countTextLines('a\nb\n\n')).toBe(3);
  });

  it('normalises metadata and visibility', () => {
    expect(publicSourceMetadata({ metadata: { blueprint_id: 'x', _text_line_count: 3 } })).toEqual({ blueprint_id: 'x', project_scoped: true, scoped_blueprint_id: 'x' });
    expect(isSourceVisibleInContext({ metadata: {} }, 'alpha')).toBe(true);
    expect(isSourceVisibleInContext({ metadata: { project_scoped: true, scoped_blueprint_id: 'alpha' } }, 'beta')).toBe(false);
    expect(isSourceVisibleInContext({ metadata: { project_scoped: true, scoped_blueprint_id: 'alpha' } }, 'alpha')).toBe(true);
    expect(isSourceVisibleInContext({ metadata: { blueprint_id: 'alpha' } }, null)).toBe(false);
    expect(deriveOcrPhase('pdf', '', null)).toBe('');
    expect(deriveOcrPhase('pdf', 'text', null)).toBe('complete');
    expect(deriveOcrPhase('latex', 'text', null)).toBe('');
    expect(deriveOcrPhase('pdf', '', 'scanning')).toBe('scanning');
  });

  it('normalises repository paths and exclusions', () => {
    expect(normalizeRepositoryFilePath(' a\\b/c.tex ')).toBe('a/b/c.tex');
    expect(() => normalizeRepositoryFilePath('../x')).toThrow();
    expect(() => normalizeRepositoryFilePath('/abs')).toThrow();
    expect(() => normalizeRepositoryFilePath('')).toThrow();
    expect(repositoryFilePathIsExcluded('numina/x')).toBe(false);
    expect(repositoryFilePathIsExcluded('src/numina/x')).toBe(false);
    expect(repositoryFilePathIsExcluded('a/.lake/b')).toBe(true);
    expect(repositoryFilePathIsExcluded('a/.git/b')).toBe(true);
    expect(repositoryFilePathIsExcluded('')).toBe(true);
  });
});

describe('upload and list', () => {
  it('stores each type with the right artifacts and metadata', async () => {
    const tex = await service.upload(repository, { name: 'paper.tex', bytes: text('\\section{A}\nline2') });
    expect(tex.artifacts).toEqual(['original', 'latex']);
    expect(tex.source_type).toBe('latex');
    expect(tex.status).toBe('ready');
    expect(tex.metadata).toEqual({});
    expect(tex.github_repo_id).toBe(repository.id);
    expect(readFileSync(join(test.ctx.paths.sourcesDir(repository.id), tex.id, 'original.tex'), 'utf8')).toBe('\\section{A}\nline2');
    expect(test.ctx.registry.getSource(repository.id, tex.id)?.metadata).toEqual({ _text_line_count: 2 });
    const md = await service.upload(repository, { name: 'notes.MARKDOWN', bytes: text('# hi') }, { displayName: '  Notes  ' });
    expect(md.artifacts).toEqual(['original']);
    expect(md.source_type).toBe('markdown');
    expect(md.display_name).toBe('Notes');
    const pdf = await service.upload(repository, { name: 'doc.pdf', bytes: TINY_PDF }, { projectScoped: true, blueprintId: 'alpha' });
    expect(pdf.artifacts).toEqual(['original']);
    expect(pdf.metadata).toEqual({ project_scoped: true, scoped_blueprint_id: 'alpha' });
    const all = service.list(repository, 'alpha');
    expect(all.map((source) => source.id)).toEqual([pdf.id, md.id, tex.id]);
    expect(service.list(repository, 'beta').map((source) => source.id)).toEqual([md.id, tex.id]);
    expect(service.list(repository).map((source) => source.id)).toEqual([md.id, tex.id]);
  });

  it('rejects unsupported, oversized, corrupt and badly named uploads', async () => {
    await expect(service.upload(repository, { name: 'x.docx', bytes: text('x') })).rejects.toMatchObject({ status: 400, detail: 'Unsupported file type. Please upload a .tex, .md, .markdown, or .pdf file.' });
    await expect(service.upload(repository, { name: 'x.tex', bytes: new Uint8Array(20 * 1024 * 1024 + 1) })).rejects.toMatchObject({ status: 400, detail: 'File is too large. Maximum upload size is 20 MB.' });
    await expect(service.upload(repository, { name: 'x.pdf', bytes: text('nope') })).rejects.toMatchObject({ status: 400, detail: 'Could not read PDF file. It may be corrupt or not a PDF.' });
    await expect(service.upload(repository, { name: 'x.tex', bytes: new Uint8Array([0xff]) })).rejects.toMatchObject({ status: 400, detail: 'Uploaded .tex file is not valid UTF-8.' });
    await expect(service.upload(repository, { name: 'x.md', bytes: new Uint8Array([0xff]) })).rejects.toMatchObject({ status: 400, detail: 'Uploaded .md file is not valid UTF-8.' });
    await expect(service.upload(repository, { name: 'x.tex', bytes: text('x') }, { displayName: 'n'.repeat(121) })).rejects.toMatchObject({ status: 400, detail: 'Source names must be 120 characters or fewer.' });
    await expect(service.upload(repository, { name: 'x.tex', bytes: text('x') }, { projectScoped: true })).rejects.toMatchObject({ status: 400, detail: 'A workspace-only source requires a blueprint id.' });
    await expect(service.upload(repository, { name: 'x.tex', bytes: text('x') }, { projectScoped: true, blueprintId: 'nope' })).rejects.toMatchObject({ status: 404, detail: 'Blueprint not found' });
    expect(test.ctx.registry.listSources(repository.id)).toHaveLength(0);
    // Text sources beyond the 50,000-character editor limit are accepted.
    const large = await service.upload(repository, { name: 'big.tex', bytes: text('x'.repeat(60_000)) });
    expect(large.status).toBe('ready');
  });

  it('enforces name uniqueness across scopes, case and whitespace', async () => {
    await service.upload(repository, { name: 'Paper.tex', bytes: text('a') }, { projectScoped: true, blueprintId: 'alpha' });
    await expect(service.upload(repository, { name: 'other.tex', bytes: text('b') }, { displayName: ' paper.TEX ', projectScoped: true, blueprintId: 'alpha' })).rejects.toMatchObject({ status: 409, detail: "A source named 'paper.TEX' already exists." });
    // A different workspace may reuse the name; a repository-wide upload may not.
    await service.upload(repository, { name: 'paper.tex', bytes: text('c') }, { projectScoped: true, blueprintId: 'beta' });
    await expect(service.upload(repository, { name: 'paper.tex', bytes: text('d') })).rejects.toMatchObject({ status: 409 });
    await service.upload(repository, { name: 'shared.tex', bytes: text('e') });
    await expect(service.upload(repository, { name: 'shared.tex', bytes: text('f') }, { projectScoped: true, blueprintId: 'alpha' })).rejects.toMatchObject({ status: 409 });
    // Deleting frees the name again.
    const shared = service.list(repository).find((source) => source.display_name === 'shared.tex');
    await service.delete(repository, shared!.id);
    await service.upload(repository, { name: 'shared.tex', bytes: text('g') });
  });
});

describe('delete, artifacts and preview', () => {
  it('serves artifacts by kind and tombstones deleted rows', async () => {
    const pdf = await service.upload(repository, { name: 'doc.pdf', bytes: TINY_PDF }, { projectScoped: true, blueprintId: 'alpha' });
    const artifact = service.artifact(repository, pdf.id, 'original', 'alpha');
    expect(artifact.mediaType).toBe('application/pdf');
    expect(existsSync(artifact.path)).toBe(true);
    expect(() => service.artifact(repository, pdf.id, 'latex', 'alpha')).toThrow(expect.objectContaining({ status: 404, detail: 'Artifact not found' }));
    expect(() => service.artifact(repository, pdf.id, 'original', 'beta')).toThrow(expect.objectContaining({ status: 404, detail: 'Source not found' }));
    expect(service.pdfPreview(repository, pdf.id, 'alpha').path).toBe(artifact.path);
    const tex = await service.upload(repository, { name: 't.tex', bytes: text('x') });
    expect(service.artifact(repository, tex.id, 'latex').mediaType).toBe('text/plain');
    expect(() => service.pdfPreview(repository, tex.id)).toThrow(expect.objectContaining({ detail: 'PDF preview not found' }));
    await expect(service.delete(repository, pdf.id, 'beta')).rejects.toMatchObject({ status: 404, detail: 'Source not found' });
    await expect(service.delete(repository, tex.id, 'ghost')).rejects.toMatchObject({ status: 404, detail: 'Blueprint not found' });
    await service.delete(repository, pdf.id, 'alpha');
    expect(existsSync(artifact.path)).toBe(false);
    const row = test.ctx.registry.getSource(repository.id, pdf.id);
    expect(row?.status).toBe('deleted');
    expect(row?.artifacts).toEqual({});
    expect(service.list(repository, 'alpha').map((source) => source.id)).toEqual([tex.id]);
    expect(() => service.get(repository, pdf.id, 'alpha')).toThrow(expect.objectContaining({ status: 404 }));
  });

  it('archives a blueprint\'s sources and exposes the canonical view', async () => {
    const canonical = await service.create({
      repository, filename: 'src.tex', displayName: 'alpha-source', bytes: text('\\section{S}'),
      scopedBlueprintId: 'alpha', metadata: { blueprint_id: 'alpha', blueprint_title: 'Alpha', created_from: 'blueprint_create' },
    });
    await service.upload(repository, { name: 'extra.md', bytes: text('m') }, { projectScoped: true, blueprintId: 'alpha' });
    await service.upload(repository, { name: 'wide.md', bytes: text('w') });
    const view = await service.canonicalSourceView(repository, 'alpha');
    expect(view).toEqual({
      source_content: '\\section{S}',
      source_type: 'latex',
      source_pdf_path: '',
      source_file_url: `/api/repositories/${repository.owner}/${repository.name}/sources/${canonical.id}/artifacts/latex?blueprint_id=alpha`,
      source_pdf_url: '',
    });
    expect(await service.canonicalSourceView(repository, 'beta')).toBeNull();
    expect(service.archiveBlueprintSources(repository.id, 'alpha')).toBe(2);
    expect(service.list(repository, 'alpha')).toHaveLength(1);
    expect(service.archiveBlueprintSources(repository.id, 'alpha')).toBe(0);
  });
});

describe('import', () => {
  it('copies a repository file, refreshes it in place and rejects bad paths', async () => {
    mkdirSync(join(folder, 'docs'));
    writeFileSync(join(folder, 'docs', 'paper.tex'), '\\section{v1}');
    writeFileSync(join(folder, 'docs', 'image.png'), 'png');
    mkdirSync(join(folder, 'numina'));
    writeFileSync(join(folder, 'numina', 'hidden.tex'), 'x');
    const project = projectFromRows(repository, test.ctx.registry.requireBlueprint(repository.id, 'alpha'));
    const created = await service.importRepositoryFile(project, 'docs\\paper.tex');
    expect(created.display_name).toBe('docs/paper.tex');
    expect(created.metadata).toMatchObject({ project_scoped: true, scoped_blueprint_id: 'alpha', repository_path: 'docs/paper.tex' });
    expect(typeof created.metadata.repository_content_sha256).toBe('string');
    const again = await service.importRepositoryFile(project, 'docs/paper.tex');
    expect(again.id).toBe(created.id);
    writeFileSync(join(folder, 'docs', 'paper.tex'), '\\section{v2}');
    const refreshed = await service.importRepositoryFile(project, 'docs/paper.tex');
    expect(refreshed.id).toBe(created.id);
    expect(refreshed.metadata.repository_content_sha256).not.toBe(created.metadata.repository_content_sha256);
    expect(await service.readArtifactText(test.ctx.registry.getSource(repository.id, created.id)!, 'latex')).toBe('\\section{v2}');
    expect(test.ctx.registry.listSources(repository.id)).toHaveLength(1);
    await expect(service.importRepositoryFile(project, '../etc/passwd')).rejects.toMatchObject({ status: 400, detail: 'repo_path must be a repository-relative file path.' });
    expect((await service.importRepositoryFile(project, 'numina/hidden.tex')).display_name).toBe('numina/hidden.tex');
    await expect(service.importRepositoryFile(project, 'docs/image.png')).rejects.toMatchObject({ status: 400, detail: 'Unsupported source type. Choose a .tex, .md, .markdown, or .pdf file.' });
    await expect(service.importRepositoryFile(project, 'docs/missing.tex')).rejects.toMatchObject({ status: 404, detail: 'File not found' });
    if (process.platform !== 'win32') {
      symlinkSync(join(folder, 'docs', 'paper.tex'), join(folder, 'docs', 'link.tex'));
      await expect(service.importRepositoryFile(project, 'docs/link.tex')).rejects.toMatchObject({ status: 404 });
    }
    // Another workspace importing the same path gets its own source.
    const other = projectFromRows(repository, test.ctx.registry.requireBlueprint(repository.id, 'beta'));
    const separate = await service.importRepositoryFile(other, 'docs/paper.tex');
    expect(separate.id).not.toBe(created.id);
  });

  it('reports a type change for an imported path', async () => {
    writeFileSync(join(folder, 'a.tex'), 'tex');
    const project = projectFromRows(repository, test.ctx.registry.requireBlueprint(repository.id, 'alpha'));
    const created = await service.importRepositoryFile(project, 'a.tex');
    test.ctx.registry.updateSource(repository.id, created.id, { source_type: 'markdown' });
    writeFileSync(join(folder, 'a.tex'), 'changed');
    await expect(service.importRepositoryFile(project, 'a.tex')).rejects.toMatchObject({ status: 409, detail: 'The repository file type no longer matches its source.' });
  });
});

// ── Built-app smoke test ───────────────────────────────────────────────────
//
// pdf.js resolves its in-thread worker at runtime, so a source-level test
// cannot prove the bundled main process can read a PDF; this drives the
// headless harness (``npm run build`` first). Skipped when nothing is built.

const STANDALONE = join(__dirname, '..', '..', '..', '..', 'out', 'main', 'standalone.js');

async function startHarness(dataDir: string, folder: string): Promise<{ baseUrl: string; token: string; stop: () => Promise<void> }> {
  const child = spawn(process.execPath, [STANDALONE, '--data', dataDir, '--port', '0', '--renderer', 'none', '--register', folder], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  const stop = async (): Promise<void> => {
    child.kill();
    await exited;
  };
  const ready = await new Promise<{ baseUrl: string; token: string }>((resolve, reject) => {
    let stdout = '';
    const timer = setTimeout(() => reject(new Error(`harness did not start\n${stderr}`)), 30_000);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      const line = stdout.split('\n').find((candidate) => candidate.startsWith('{'));
      if (!line) return;
      clearTimeout(timer);
      resolve(JSON.parse(line) as { baseUrl: string; token: string });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`harness exited with ${code}\n${stderr}`));
    });
  });
  return { ...ready, stop };
}

describe.skipIf(!existsSync(STANDALONE))('built main process', () => {
  it('reads a PDF through the bundled pdf.js (pdf-info and source upload)', async () => {
    const harness = await startHarness(join(test.root, 'harness-data'), folder);
    try {
      const headers = { Authorization: `Bearer ${harness.token}` };
      const listed = (await (await fetch(`${harness.baseUrl}/api/repositories`, { headers })).json()) as { repositories: Array<{ owner: string; name: string }> };
      const [{ owner, name }] = listed.repositories;
      const repositoryUrl = `${harness.baseUrl}/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
      const info = new FormData();
      info.append('file', new File([TINY_PDF], 'paper.pdf', { type: 'application/pdf' }));
      const pageCount = await fetch(`${repositoryUrl}/blueprints/pdf-info`, { method: 'POST', headers, body: info });
      expect(await pageCount.json()).toEqual({ page_count: 1 });
      const upload = new FormData();
      upload.append('file', new File([TINY_PDF], 'paper.pdf', { type: 'application/pdf' }));
      const uploaded = await fetch(`${repositoryUrl}/sources`, { method: 'POST', headers, body: upload });
      expect(uploaded.status).toBe(200);
      expect(await uploaded.json()).toMatchObject({ source_type: 'pdf', status: 'ready', artifacts: ['original'] });
    } finally {
      await harness.stop();
    }
  }, 60_000);
});
