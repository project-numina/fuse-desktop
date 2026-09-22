import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '@main/server/errors';
import { DEFAULT_AGENT_CONFIG, type BlueprintRow, type RepositoryRow } from '@main/store/rows';
import type { OpenProject } from '@main/services/types';
import { editContextFor, editErrorStatus, readChapterContent, updateBlueprintContent, updateChapterContent, validateBlueprintName, type BlueprintEditContext } from '@main/services/blueprint/edit';
import { createEmptyModel, saveModel } from '@main/services/blueprint/model';

let tmp: string;

function write(relative: string, content: string): void {
  const target = join(tmp, ...relative.split('/'));
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

function read(relative: string): string {
  return readFileSync(join(tmp, ...relative.split('/')), 'utf8');
}

/** An imported leanblueprint with a custom entrypoint and a cached include list. */
function importedContext(overrides: Partial<BlueprintEditContext> = {}): BlueprintEditContext {
  return {
    clonePath: tmp,
    blueprintFile: 'blueprint/src/content.tex',
    includedFiles: ['blueprint/src/content.tex', 'blueprint/src/chapter/intro.tex'],
    projectSubdir: '',
    ...overrides,
  };
}

function setupImportedClone(): void {
  write('blueprint/src/content.tex', '\\input{chapter/intro}\n');
  write('blueprint/src/chapter/intro.tex', '\\begin{theorem}[T]\n\\label{thm:t}\nStatement.\n\\end{theorem}\n');
}

async function expectHttpError(promise: Promise<unknown>, status: number, detail: RegExp): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(status);
    expect((error as HttpError).detail).toMatch(detail);
    return;
  }
  throw new Error('expected an HttpError');
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'fuse-edit-'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

describe('name validation', () => {
  it.each(['foo/bar', 'foo\\bar', 'foo bar', '..foo', 'C:foo', 'Foo', ''])('rejects %j', (name) => {
    expect(() => validateBlueprintName(name)).toThrow(/Invalid blueprint name/);
  });

  it('accepts slugs and maps messages to statuses', () => {
    expect(() => validateBlueprintName('froda-2')).not.toThrow();
    expect(editErrorStatus('Chapter not found in clone')).toBe(404);
    expect(editErrorStatus('Invalid chapter path')).toBe(400);
    expect(editErrorStatus('Chapter not part of this blueprint')).toBe(400);
    expect(editErrorStatus('Refusing to overwrite chapter with entrypoint content')).toBe(409);
  });
});

describe('updateBlueprintContent', () => {
  it('rejects a multi-segment name before touching the clone', async () => {
    write('numina/blueprints/bar/bar.tex', 'old content');
    await expectHttpError(updateBlueprintContent(importedContext({ blueprintFile: null }), 'foo/bar', 'new content'), 400, /Invalid blueprint name/);
    expect(read('numina/blueprints/bar/bar.tex')).toBe('old content');
  });

  it('writes the imported entrypoint, never the legacy default', async () => {
    setupImportedClone();
    await updateBlueprintContent(importedContext(), 'imported', '% rewritten entrypoint\n');
    expect(read('blueprint/src/content.tex')).toBe('% rewritten entrypoint\n');
    expect(existsSync(join(tmp, 'numina', 'blueprints', 'imported', 'imported.tex'))).toBe(false);
  });

  it('reports a missing parent directory as not found', async () => {
    await expectHttpError(updateBlueprintContent(importedContext({ blueprintFile: null, includedFiles: [] }), 'fresh', 'x'), 404, /Blueprint not found in clone/);
  });
});

describe('readChapterContent', () => {
  it('returns the chapter content', async () => {
    setupImportedClone();
    expect(await readChapterContent(importedContext(), 'imported', 'blueprint/src/chapter/intro.tex')).toContain('Statement.');
  });

  it('rejects a path outside the included files', async () => {
    setupImportedClone();
    write('secret.tex', 'should not be read');
    await expectHttpError(readChapterContent(importedContext(), 'imported', 'secret.tex'), 400, /not part of this blueprint/);
  });

  it('rejects path traversal before the include lookup', async () => {
    setupImportedClone();
    await expectHttpError(readChapterContent(importedContext(), 'imported', '../etc/passwd.tex'), 400, /Invalid chapter path/);
  });

  it('falls back to a live walk when the cached include list is stale', async () => {
    setupImportedClone();
    write('blueprint/src/chapter/extra.tex', 'Extra chapter.\n');
    write('blueprint/src/content.tex', '\\input{chapter/intro}\n\\input{chapter/extra}\n');
    expect(await readChapterContent(importedContext(), 'imported', 'blueprint/src/chapter/extra.tex')).toBe('Extra chapter.\n');
  });

  it('reports a listed but missing chapter as not found', async () => {
    setupImportedClone();
    rmSync(join(tmp, 'blueprint', 'src', 'chapter', 'intro.tex'));
    await expectHttpError(readChapterContent(importedContext(), 'imported', 'blueprint/src/chapter/intro.tex'), 404, /Chapter not found in clone/);
  });
});

describe('OpenProject calling convention', () => {
  it('derives the edit context from the open project and its persisted model', async () => {
    setupImportedClone();
    const repository: RepositoryRow = { id: 1, owner: 'owner', name: 'repo', path: tmp, description: null, created_at: 't', last_activity_at: null };
    const blueprint: BlueprintRow = {
      id: 'imported',
      repository_id: 1,
      title: 'Imported',
      description: '',
      area: '',
      blueprint_file: 'blueprint/src/content.tex',
      project_subdir: '',
      source_type: 'none',
      source_id: null,
      pr_mode: 'off',
      auto_commit: true,
      orchestrator_child_concurrency: 1,
      agent: DEFAULT_AGENT_CONFIG,
      created_at: 't',
      updated_at: 'u',
    };
    const project: OpenProject = { repository, blueprint, clonePath: tmp, projectSubdir: '', projectRoot: tmp, blueprintFile: blueprint.blueprint_file, roomKey: 'owner/repo/imported' };
    expect(await readChapterContent(project, 'imported', 'blueprint/src/chapter/intro.tex')).toContain('Statement.');
    expect(await updateChapterContent(project, 'imported', 'blueprint/src/chapter/intro.tex', '% via project\n')).toBe('blueprint/src/chapter/intro.tex');
    await updateBlueprintContent(project, 'imported', '% entry via project\n');
    expect(read('blueprint/src/content.tex')).toBe('% entry via project\n');
    // A chapter dropped from the entrypoint but still in the persisted include list stays editable.
    const model = createEmptyModel();
    model.includedFiles = ['blueprint/src/content.tex', 'blueprint/src/chapter/intro.tex'];
    saveModel(project.projectRoot, model);
    expect(await readChapterContent(project, 'imported', 'blueprint/src/chapter/intro.tex')).toBe('% via project\n');
    expect(editContextFor(project, model).includedFiles).toEqual(model.includedFiles);
  });
});

describe('updateChapterContent', () => {
  it('writes the chapter file', async () => {
    setupImportedClone();
    const safePath = await updateChapterContent(importedContext(), 'imported', 'blueprint/src/chapter/intro.tex', '% new chapter content\n');
    expect(safePath).toBe('blueprint/src/chapter/intro.tex');
    expect(read('blueprint/src/chapter/intro.tex')).toBe('% new chapter content\n');
  });

  it('refuses to overwrite a body chapter with the entrypoint content', async () => {
    setupImportedClone();
    const entrypointContent = read('blueprint/src/content.tex');
    const original = read('blueprint/src/chapter/intro.tex');
    await expectHttpError(updateChapterContent(importedContext(), 'imported', 'blueprint/src/chapter/intro.tex', entrypointContent), 409, /entrypoint content/);
    expect(read('blueprint/src/chapter/intro.tex')).toBe(original);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Rejected chapter save whose content matches the entrypoint'));
  });

  it('skips the entrypoint guard when the entrypoint is not UTF-8', async () => {
    setupImportedClone();
    writeFileSync(join(tmp, 'blueprint', 'src', 'content.tex'), Buffer.from([0xff]));
    const safePath = await updateChapterContent(importedContext(), 'imported', 'blueprint/src/chapter/intro.tex', '% new chapter content\n');
    expect(safePath).toBe('blueprint/src/chapter/intro.tex');
    expect(read('blueprint/src/chapter/intro.tex')).toBe('% new chapter content\n');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Could not read blueprint entrypoint while guarding chapter save'));
  });

  it('allows writing the entrypoint itself', async () => {
    setupImportedClone();
    await updateChapterContent(importedContext(), 'imported', 'blueprint/src/content.tex', '% new table of contents\n');
    expect(read('blueprint/src/content.tex')).toBe('% new table of contents\n');
  });

  it('writes exactly what it is given, CRLF included', async () => {
    setupImportedClone();
    await updateChapterContent(importedContext(), 'imported', 'blueprint/src/chapter/intro.tex', 'a\r\nb\r\n');
    expect(readFileSync(join(tmp, 'blueprint', 'src', 'chapter', 'intro.tex'), 'utf8')).toBe('a\r\nb\r\n');
    expect(await readChapterContent(importedContext(), 'imported', 'blueprint/src/chapter/intro.tex')).toBe('a\nb\n');
  });
});
