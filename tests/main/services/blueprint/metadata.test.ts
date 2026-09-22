import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adoptProjectBlueprint, isSafeLabel, parseBlueprintSource, refreshBlueprintModel } from '@main/services/blueprint/metadata';
import { createEmptyModel, listDeclarations } from '@main/services/blueprint/model';

let tmp: string;
let clone: string;

function write(relative: string, content: string): void {
  const target = join(clone, ...relative.split('/'));
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

/** Write a Fuse-drafted blueprint .tex into a fake clone (legacy layout). */
function setupClone(name: string, source: string): void {
  write(`numina/blueprints/${name}/${name}.tex`, source);
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'fuse-metadata-'));
  clone = join(tmp, 'clone');
  mkdirSync(clone);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

describe('isSafeLabel', () => {
  it('allows conventional labels and rejects path-like ones', () => {
    expect(isSafeLabel('thm:main')).toBe(true);
    expect(isSafeLabel('lem:a.b_c-d')).toBe(true);
    expect(isSafeLabel('')).toBe(false);
    expect(isSafeLabel('../escape')).toBe(false);
    expect(isSafeLabel('a/b')).toBe(false);
    expect(isSafeLabel('a\\b')).toBe(false);
    expect(isSafeLabel(':leading')).toBe(false);
    expect(isSafeLabel('has space')).toBe(false);
  });
});

describe('parseBlueprintSource', () => {
  it('extracts declarations and the labels present in source', () => {
    setupClone(
      'froda',
      `
\\begin{theorem}[Froda's Theorem]
\\label{thm:froda}
A monotone function has countably many discontinuities.
\\end{theorem}

\\begin{definition}[Continuous]
\\label{def:continuous}
A function is continuous at a point.
\\end{definition}
`,
    );
    const parsed = parseBlueprintSource(clone, 'froda');
    expect(parsed).not.toBeNull();
    expect(parsed!.declarations.map((d) => d.label)).toEqual(['thm:froda', 'def:continuous']);
    expect(parsed!.declarations[0].kind).toBe('theorem');
    expect(parsed!.declarations[0].title).toBe("Froda's Theorem");
    expect(parsed!.declarations[0].statement).toContain('monotone function');
    expect(parsed!.labelsInSource).toEqual(new Set(['thm:froda', 'def:continuous']));
  });

  it('ignores a commented-out declaration', () => {
    setupClone(
      'test',
      '\\begin{theorem}[Live]\n\\label{thm:live}\nStatement.\n\\end{theorem}\n\n% \\begin{theorem}[Retired]\n%     \\label{thm:retired}\n%     Statement.\n% \\end{theorem}\n',
    );
    const parsed = parseBlueprintSource(clone, 'test')!;
    expect(parsed.declarations.map((d) => d.label)).toEqual(['thm:live']);
    expect(parsed.labelsInSource).toEqual(new Set(['thm:live']));
  });

  it('returns null when the source is missing', () => {
    expect(parseBlueprintSource(clone, 'absent')).toBeNull();
  });

  it('skips unsafe labels', () => {
    setupClone('test', '\\begin{theorem}[Bad]\n\\label{../escape}\nStatement.\n\\end{theorem}\n\\begin{theorem}[Good]\n\\label{thm:good}\nStatement.\n\\end{theorem}\n');
    expect(parseBlueprintSource(clone, 'test')!.declarations.map((d) => d.label)).toEqual(['thm:good']);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('unsafe label'));
  });

  it('parses an imported blueprint file and records the chapter', () => {
    write('blueprint/src/content.tex', '\\input{chapter/imported}\n');
    write('blueprint/src/chapter/imported.tex', '\\begin{theorem}[Imported]\n\\label{thm:imported}\nStatement.\n\\end{theorem}\n');
    const parsed = parseBlueprintSource(clone, 'imported', 'blueprint/src/content.tex')!;
    expect(parsed.declarations.map((d) => d.label)).toEqual(['thm:imported']);
    expect(parsed.declarations[0].sourceFile).toBe('blueprint/src/chapter/imported.tex');
    expect(parsed.includedFiles).toContain('blueprint/src/content.tex');
  });

  it('uses the compile working directory for nested inputs', () => {
    write('blueprint/src/content.tex', '\\input{chapters/one}\n');
    write('blueprint/src/chapters/one.tex', '\\input{chapters/two}\n');
    write('blueprint/src/chapters/two.tex', '\\begin{lemma}[Two]\n\\label{lem:two}\nStatement.\n\\end{lemma}\n');
    const parsed = parseBlueprintSource(clone, 'imported', 'blueprint/src/content.tex')!;
    expect(parsed.declarations.map((d) => d.label)).toEqual(['lem:two']);
    expect(parsed.includedFiles).toContain('blueprint/src/chapters/two.tex');
  });

  it('reports contained include targets it could not read, once each, without listing them as chapters', () => {
    write('blueprint/src/content.tex', '\\input{chapters/one}\n\\input{chapters/missing}\n\\input{chapters/missing}\n\\input{../../../outside}\n');
    write('blueprint/src/chapters/one.tex', '\\input{appendix/later}\n\\begin{lemma}\n\\label{lem:one}\nS.\n\\end{lemma}\n');
    const parsed = parseBlueprintSource(clone, 'imported', 'blueprint/src/content.tex')!;
    expect(parsed.includedFiles).toEqual(['blueprint/src/content.tex', 'blueprint/src/chapters/one.tex']);
    // Pre-order, like includedFiles: a chapter whose directory does not exist
    // yet, then one that does not exist; the escaping target is dropped.
    expect(parsed.missingIncludes).toEqual(['blueprint/src/appendix/later.tex', 'blueprint/src/chapters/missing.tex']);
    const model = createEmptyModel();
    expect(refreshBlueprintModel(model, clone, 'imported', 'blueprint/src/content.tex')).toBe(true);
    expect(model.missingIncludes).toEqual(['blueprint/src/appendix/later.tex', 'blueprint/src/chapters/missing.tex']);
    // Once written, the target moves from missing to included.
    write('blueprint/src/chapters/missing.tex', '\\section{Found}\n');
    expect(refreshBlueprintModel(model, clone, 'imported', 'blueprint/src/content.tex')).toBe(true);
    expect(model.includedFiles).toContain('blueprint/src/chapters/missing.tex');
    expect(model.missingIncludes).toEqual(['blueprint/src/appendix/later.tex']);
  });

  it('groups a multi-file legacy blueprint by chapter', () => {
    write('numina/blueprints/multi/multi.tex', '\\input{chapter-one}\n\\input{chapter-two}\n');
    write('numina/blueprints/multi/chapter-one.tex', '\\begin{theorem}[One]\n\\label{thm:one}\nS.\n\\end{theorem}\n');
    write('numina/blueprints/multi/chapter-two.tex', '\\begin{theorem}[Two]\n\\label{thm:two}\nS.\n\\end{theorem}\n');
    const parsed = parseBlueprintSource(clone, 'multi')!;
    const byLabel = Object.fromEntries(parsed.declarations.map((d) => [d.label, d.sourceFile]));
    expect(byLabel['thm:one']).toBe('numina/blueprints/multi/chapter-one.tex');
    expect(byLabel['thm:two']).toBe('numina/blueprints/multi/chapter-two.tex');
  });

  it('attaches a cross-file \\proves proof and derives the status from it', () => {
    write('numina/blueprints/multi/multi.tex', '\\input{chapter-one}\n\\input{appendix}\n');
    write('numina/blueprints/multi/chapter-one.tex', '\\begin{theorem}[Main]\n\\label{thm:main}\n\\leanok\nStatement.\n\\end{theorem}\n');
    write('numina/blueprints/multi/appendix.tex', '\\begin{proof}\n\\proves{thm:main}\n\\leanok\nThe proof, restated in the appendix.\n\\end{proof}\n');
    const parsed = parseBlueprintSource(clone, 'multi')!;
    expect(parsed.declarations).toHaveLength(1);
    const declaration = parsed.declarations[0];
    expect(declaration.proof).toContain('restated in the appendix');
    expect(declaration.sourceFile).toBe('numina/blueprints/multi/chapter-one.tex');
    expect(declaration.proofSourceFile).toBe('numina/blueprints/multi/appendix.tex');
    expect(declaration.status).toBe('proved');
  });

  it('leaves proofSourceFile empty for a \\proves proof in the same chapter', () => {
    write(
      'numina/blueprints/single/single.tex',
      '\\begin{theorem}[Main]\n\\label{thm:main}\nStatement.\n\\end{theorem}\n\nProse in between.\n\n\\begin{proof}\n\\proves{thm:main}\nDetached but local.\n\\end{proof}\n',
    );
    const declaration = parseBlueprintSource(clone, 'single')!.declarations[0];
    expect(declaration.proof).toContain('Detached but local');
    expect(declaration.proofSourceFile).toBe('');
  });

  it('drops a \\proves proof with no declaration anywhere', () => {
    write('numina/blueprints/multi/multi.tex', '\\input{appendix}\n');
    write(
      'numina/blueprints/multi/appendix.tex',
      '\\begin{theorem}[Other]\n\\label{thm:other}\nStatement.\n\\end{theorem}\n\n\\begin{proof}\n\\proves{thm:nowhere}\nOrphaned proof.\n\\end{proof}\n',
    );
    const parsed = parseBlueprintSource(clone, 'multi')!;
    expect(parsed.declarations).toHaveLength(1);
    expect(parsed.declarations[0].proof).toBeNull();
  });

  it('finds a nested project blueprint only through the project subdir', () => {
    write('2_2/blueprint/src/content.tex', '\\begin{lemma}[Nested]\n\\label{lem:n}\nS.\n\\end{lemma}\n');
    expect(parseBlueprintSource(clone, 'nested', null)).toBeNull();
    expect(parseBlueprintSource(clone, 'nested', null, '2_2')!.declarations.map((d) => d.label)).toEqual(['lem:n']);
  });

  it('translates CRLF sources like the web backend', () => {
    setupClone('crlf', '\\begin{theorem}[T]\r\n\\label{thm:t}\r\nFirst line.\r\nSecond line.\r\n\\end{theorem}\r\n');
    const parsed = parseBlueprintSource(clone, 'crlf')!;
    expect(parsed.declarations[0].statement).not.toContain('\r');
    expect(parsed.labelsInSource).toEqual(new Set(['thm:t']));
  });
});

describe('adoptProjectBlueprint', () => {
  it('preserves an explicit stored source', () => {
    write('lean/kakeya/blueprint/src/content.tex', 'candidate');
    expect(adoptProjectBlueprint(clone, 'docs/custom-blueprint.tex', 'lean/kakeya')).toBeNull();
    expect(adoptProjectBlueprint(clone, null, 'lean/kakeya')).toBe('lean/kakeya/blueprint/src/content.tex');
    expect(adoptProjectBlueprint(clone, null, 'lean/other')).toBeNull();
  });
});

describe('refreshBlueprintModel', () => {
  it('populates rows and bumps the parser revision', () => {
    setupClone('froda', '\n\\begin{theorem}[T]\n\\label{thm:t}\nStatement.\n\\end{theorem}\n');
    const model = createEmptyModel();
    expect(refreshBlueprintModel(model, clone, 'froda', null)).toBe(true);
    expect(listDeclarations(model).map((row) => row.label)).toEqual(['thm:t']);
    expect(model.parserRevision).toBe(1);
  });

  it('uses the stored blueprint file', () => {
    write('blueprint/src/content.tex', '\\begin{theorem}[Imported]\n\\label{thm:i}\nS.\n\\end{theorem}\n');
    const model = createEmptyModel();
    expect(refreshBlueprintModel(model, clone, 'imported', 'blueprint/src/content.tex')).toBe(true);
    expect(listDeclarations(model).map((row) => row.label)).toEqual(['thm:i']);
  });

  it('removes a commented-out declaration', () => {
    const live = '\\begin{theorem}[Froda]\n\\label{thm:froda}\nStatement.\n\\end{theorem}\n';
    setupClone('froda', live);
    const model = createEmptyModel();
    expect(refreshBlueprintModel(model, clone, 'froda', null)).toBe(true);
    expect(listDeclarations(model).map((row) => row.label)).toEqual(['thm:froda']);
    setupClone('froda', live.split('\n').filter(Boolean).map((line) => `% ${line}\n`).join(''));
    expect(refreshBlueprintModel(model, clone, 'froda', null)).toBe(true);
    expect(listDeclarations(model)).toEqual([]);
  });

  it('adopts a nested project blueprint', () => {
    write('2_2/blueprint/src/content.tex', '\\begin{lemma}[Nested]\n\\label{lem:n}\nS.\n\\end{lemma}\n');
    const adopted = adoptProjectBlueprint(clone, null, '2_2');
    expect(adopted).toBe('2_2/blueprint/src/content.tex');
    const model = createEmptyModel();
    expect(refreshBlueprintModel(model, clone, 'nested', adopted, '2_2')).toBe(true);
    expect(listDeclarations(model).map((row) => row.label)).toEqual(['lem:n']);
  });

  it('reports false on a missing source and leaves the model alone', () => {
    const model = createEmptyModel();
    expect(refreshBlueprintModel(model, clone, 'absent', null)).toBe(false);
    expect(model.parserRevision).toBe(0);
  });
});
