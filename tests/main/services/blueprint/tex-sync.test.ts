import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { declarationTags } from '@main/services/blueprint/latex/tags';
import { parseBlueprintSource, refreshBlueprintModel } from '@main/services/blueprint/metadata';
import { createEmptyModel, getDeclaration, listDeclarations, updateDeclarationFields, type BlueprintModel } from '@main/services/blueprint/model';
import { clonePathOf } from '@main/services/blueprint/paths';
import {
  STATUS_TARGETS,
  applyDeclarationStatusPlan,
  countLabelsInSource,
  declarationStatusSummary,
  labelSourceFiles,
  planDeclarationStatusUpdates,
  rewriteTagsAcrossFiles,
} from '@main/services/blueprint/tex-sync';

const FIXTURE = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../fixtures/sample-blueprint');

let tmp: string;
let clone: string;

function write(relative: string, content: string): void {
  const target = join(clone, ...relative.split('/'));
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

function read(relative: string): string {
  return readFileSync(join(clone, ...relative.split('/')), 'utf8');
}

function statuses(name: string, blueprintFile: string | null = null): Record<string, string> {
  const parsed = parseBlueprintSource(clone, name, blueprintFile)!;
  return Object.fromEntries(parsed.declarations.map((d) => [d.label, d.status]));
}

/** Run the whole set_declaration_status cycle the way the tool does. */
function setStatus(model: BlueprintModel, entrypoint: string, labels: string[], target: keyof typeof STATUS_TARGETS): { successes: string[]; summary: string; failures: string[] } {
  const [status, requireFormalizationData] = STATUS_TARGETS[target];
  const plan = planDeclarationStatusUpdates(listDeclarations(model), labels, status, requireFormalizationData);
  const successes = applyDeclarationStatusPlan(model, clone, clonePathOf(clone, entrypoint), plan);
  return { successes, summary: declarationStatusSummary(plan, successes, target), failures: plan.failures };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'fuse-tex-sync-'));
  clone = join(tmp, 'clone');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

describe('labelSourceFiles', () => {
  it('maps labels to the first defining file, ignoring comments', () => {
    write('blueprint/src/content.tex', '\\input{one}\n\\input{two}\n');
    write('blueprint/src/one.tex', '% \\label{thm:two}\n\\begin{theorem}\\label{thm:one}\nS.\\end{theorem}\n');
    write('blueprint/src/two.tex', '\\begin{theorem}\\label{thm:two}\nS.\\end{theorem}\n\\begin{lemma}\\label{thm:one}\nDup.\\end{lemma}\n');
    expect(labelSourceFiles(clone, clonePathOf(clone, 'blueprint/src/content.tex'))).toEqual({ 'thm:one': 'blueprint/src/one.tex', 'thm:two': 'blueprint/src/two.tex' });
    expect(countLabelsInSource(read('blueprint/src/one.tex'))).toBe(1);
  });
});

describe('rewriteTagsAcrossFiles', () => {
  it('rewrites each label in its own chapter and reports missing labels', () => {
    cpSync(FIXTURE, clone, { recursive: true });
    const entrypoint = clonePathOf(clone, 'blueprint/src/content.tex');
    const failures: string[] = [];
    const matched = rewriteTagsAcrossFiles(
      clone,
      entrypoint,
      {
        'conj:cube': declarationTags({ leanName: 'cube_bound', leanok: true, uses: ['def:square'] }),
        'thm:twice-eq': declarationTags(),
        'thm:missing': declarationTags({ leanok: true }),
      },
      { 'conj:cube': 'blueprint/src/chapters/squares.tex', 'thm:twice-eq': '', 'thm:missing': 'blueprint/src/chapters/squares.tex' },
      failures,
    );
    expect(matched).toEqual(new Set(['conj:cube', 'thm:twice-eq']));
    expect(failures).toEqual(['thm:missing (label not found in blueprint/src/chapters/squares.tex; refresh_blueprint_metadata or check the source)']);
    const squares = read('blueprint/src/chapters/squares.tex');
    expect(squares).toContain('\\label{conj:cube}\n  \\lean{cube_bound}\n  \\uses{def:square}\n  \\leanok\n');
    const doubling = read('blueprint/src/chapters/doubling.tex');
    expect(doubling).not.toContain('\\lean{twice_eq}');
    expect(statuses('sample')).toEqual({
      'def:twice': 'proved',
      'lem:twice-zero': 'proved',
      'thm:twice-eq': 'not_started',
      'def:square': 'proved',
      'thm:twice-le-square': 'in_progress',
      'conj:cube': 'proved',
    });
  });

  it('accepts Maps for the per-label inputs', () => {
    write('blueprint/src/content.tex', '\\begin{theorem}\n\\label{thm:a}\nS.\n\\end{theorem}\n');
    const failures: string[] = [];
    const pending = new Map<string, unknown>([['thm:a', declarationTags({ leanName: 'A.a', leanok: true })]]);
    // A repo-relative entrypoint (what the service passes) is accepted too.
    const matched = rewriteTagsAcrossFiles(clone, 'blueprint/src/content.tex', pending, new Map([['thm:a', '']]), failures, new Map());
    expect(matched).toEqual(new Set(['thm:a']));
    expect(read('blueprint/src/content.tex')).toContain('\\lean{A.a}\n\\leanok\n');
  });

  it('refuses source paths escaping the clone', () => {
    write('blueprint/src/content.tex', '\\begin{theorem}\n\\label{thm:a}\nS.\n\\end{theorem}\n');
    writeFileSync(join(tmp, 'outside.tex'), '\\label{thm:a}\n');
    const failures: string[] = [];
    // A stored source path with '..' fails safeBlueprintFilePath and falls back to the include index.
    const matched = rewriteTagsAcrossFiles(clone, clonePathOf(clone, 'blueprint/src/content.tex'), { 'thm:a': declarationTags({ leanok: true }) }, { 'thm:a': '../outside.tex' }, failures);
    expect(matched).toEqual(new Set(['thm:a']));
    expect(failures).toEqual([]);
    expect(read('blueprint/src/content.tex')).toContain('\\leanok');
    expect(readFileSync(join(tmp, 'outside.tex'), 'utf8')).toBe('\\label{thm:a}\n');
  });

  it('marks cross-file proofs in their own chapter and only counts fully synced labels', () => {
    write('blueprint/src/content.tex', '\\input{chapter-one}\n\\input{appendix}\n');
    write('blueprint/src/chapter-one.tex', '\\begin{theorem}[Main]\n\\label{thm:main}\n\\lean{Demo.main}\nStatement.\n\\end{theorem}\n');
    write('blueprint/src/appendix.tex', '\\begin{proof}\n\\proves{thm:main}\nThe proof, restated in the appendix.\n\\end{proof}\n');
    const model = createEmptyModel();
    expect(refreshBlueprintModel(model, clone, 'demo', 'blueprint/src/content.tex')).toBe(true);
    expect(getDeclaration(model, 'thm:main')?.proofSourceFile).toBe('blueprint/src/appendix.tex');

    const result = setStatus(model, 'blueprint/src/content.tex', ['thm:main'], 'proved');
    expect(result.successes).toEqual(['thm:main']);
    expect(read('blueprint/src/appendix.tex')).toBe('\\begin{proof}\n\\leanok\n\\proves{thm:main}\nThe proof, restated in the appendix.\n\\end{proof}\n');
    expect(read('blueprint/src/chapter-one.tex')).toContain('\\leanok');
    expect(getDeclaration(model, 'thm:main')?.status).toBe('proved');
    expect(statuses('demo', 'blueprint/src/content.tex')).toEqual({ 'thm:main': 'proved' });

    // Unformalizing removes both markers again.
    const undo = setStatus(model, 'blueprint/src/content.tex', ['thm:main'], 'unformalized');
    expect(undo.successes).toEqual(['thm:main']);
    expect(read('blueprint/src/appendix.tex')).not.toContain('\\leanok');
    expect(read('blueprint/src/chapter-one.tex')).not.toContain('\\leanok');
    expect(statuses('demo', 'blueprint/src/content.tex')).toEqual({ 'thm:main': 'not_started' });

    // A proof block that vanished makes the label fail even though the statement matched.
    write('blueprint/src/appendix.tex', 'No proof here.\n');
    const broken = setStatus(model, 'blueprint/src/content.tex', ['thm:main'], 'proved');
    expect(broken.successes).toEqual([]);
    expect(broken.failures).toEqual(['thm:main (no \\proves{thm:main} proof block in blueprint/src/appendix.tex; refresh_blueprint_metadata or check the source)']);
    expect(getDeclaration(model, 'thm:main')?.status).toBe('not_started');
  });
});

describe('status planning', () => {
  it('resolves labels, normalizes terminal kinds and reports failures', () => {
    cpSync(FIXTURE, clone, { recursive: true });
    const model = createEmptyModel();
    expect(refreshBlueprintModel(model, clone, 'sample', null)).toBe(true);

    const noLean = setStatus(model, 'blueprint/src/content.tex', ['conj:cube'], 'formalized');
    expect(noLean.successes).toEqual([]);
    expect(noLean.summary).toBe('Skipped: conj:cube (no leanDeclaration; run formalizer).');
    expect(declarationStatusSummary(planDeclarationStatusUpdates([], [], 'proved', true), [], 'proved')).toBe('Error: no declarations were marked.');

    updateDeclarationFields(model, 'conj:cube', { leanDeclaration: 'cube_bound' });
    const formalized = setStatus(model, 'blueprint/src/content.tex', ['conj:cube', 'twice_eq', 'nope', 'conj:cube'], 'formalized');
    expect(formalized.successes).toEqual(['conj:cube', 'thm:twice-eq']);
    expect(getDeclaration(model, 'conj:cube')?.status).toBe('proved');
    expect(getDeclaration(model, 'thm:twice-eq')?.status).toBe('in_progress');
    expect(formalized.summary).toBe(
      "Set status of 2 declaration(s) to 'formalized': conj:cube, thm:twice-eq. " +
        "Normalized 'formalized' -> terminal for statement-only declaration(s): conj:cube. " +
        "Resolved Lean names to labels: 'twice_eq' -> 'thm:twice-eq' (pass the blueprint label directly next time). " +
        "Skipped: nope (no declaration with this label or Lean name; pass the blueprint \\label value, e.g. 'lem:...').",
    );
    // The .tex now agrees with the stored statuses: a refresh is a fixed point.
    const before = Object.fromEntries(listDeclarations(model).map((row) => [row.label, row.status]));
    expect(refreshBlueprintModel(model, clone, 'sample', null)).toBe(true);
    expect(Object.fromEntries(listDeclarations(model).map((row) => [row.label, row.status]))).toEqual(before);
    expect(read('blueprint/src/chapters/doubling.tex')).toContain('\\begin{proof}\n  \\uses{lem:twice-zero}\n  By definition.\n\\end{proof}');
  });

  it('preserves a UTF-8 BOM when rewriting tags (Python read_text keeps it)', () => {
    const body = '\\begin{theorem}[T]\n\\label{thm:t}\n\\lean{Demo.t}\nStatement.\n\\end{theorem}\n\\begin{proof}\nTrivial.\n\\end{proof}\n';
    write('blueprint/src/content.tex', `\uFEFF${body}`);
    const model = createEmptyModel();
    expect(refreshBlueprintModel(model, clone, 'bom', 'blueprint/src/content.tex')).toBe(true);
    expect(statuses('bom', 'blueprint/src/content.tex')).toEqual({ 'thm:t': 'not_started' });
    const result = setStatus(model, 'blueprint/src/content.tex', ['thm:t'], 'proved');
    expect(result.successes).toEqual(['thm:t']);
    const bytes = readFileSync(join(clone, 'blueprint', 'src', 'content.tex'));
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(read('blueprint/src/content.tex')).toContain('\\lean{Demo.t}\n\\leanok\n');
    expect(statuses('bom', 'blueprint/src/content.tex')).toEqual({ 'thm:t': 'proved' });
  });

  it('preserves CRLF sources when rewriting tags', () => {
    write('blueprint/src/content.tex', '\\begin{theorem}[T]\r\n\\label{thm:t}\r\n\\lean{Demo.t}\r\nStatement.\r\n\\end{theorem}\r\n\\begin{proof}\r\nTrivial.\r\n\\end{proof}\r\n');
    const model = createEmptyModel();
    expect(refreshBlueprintModel(model, clone, 'crlf', 'blueprint/src/content.tex')).toBe(true);
    const result = setStatus(model, 'blueprint/src/content.tex', ['thm:t'], 'proved');
    expect(result.successes).toEqual(['thm:t']);
    const source = read('blueprint/src/content.tex');
    expect(source).toContain('\\leanok\r\n');
    expect(source).not.toMatch(/[^\r]\n/);
    expect(statuses('crlf', 'blueprint/src/content.tex')).toEqual({ 'thm:t': 'proved' });
  });
});
