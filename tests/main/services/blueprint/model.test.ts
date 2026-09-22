import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyParserRefresh,
  blueprintSettings,
  coerceRelevantDeclaration,
  coerceRelevantDeclarations,
  createEmptyModel,
  declarationToEntry,
  declarationToJson,
  deleteAllDeclarations,
  getDeclaration,
  getDeclarationByReference,
  listDeclarations,
  loadModel,
  mergeRelevantDeclarations,
  modelFilePath,
  resolveDeclarationByLeanName,
  resolveModelFile,
  saveModel,
  setDeclarationStatus,
  updateDeclarationFields,
  type BlueprintModel,
  type ParsedDeclaration,
} from '@main/services/blueprint/model';

function parsed(label: string, overrides: Partial<ParsedDeclaration> = {}): ParsedDeclaration {
  return {
    label,
    kind: 'theorem',
    title: `Title for ${label}`,
    statement: 'S',
    proof: 'P',
    uses: [],
    sourceFile: 'blueprint/src/content.tex',
    proofSourceFile: '',
    leanDeclaration: '',
    leanFile: '',
    status: 'not_started',
    ...overrides,
  };
}

function refresh(model: BlueprintModel, declarations: ParsedDeclaration[], labelsInSource: string[], includedFiles: string[] = []): void {
  applyParserRefresh(model, { declarations, includedFiles, labelsInSource: new Set(labelsInSource) });
}

describe('applyParserRefresh', () => {
  it('inserts new declarations in document order', () => {
    const model = createEmptyModel();
    refresh(model, [parsed('thm:a'), parsed('thm:b')], ['thm:a', 'thm:b'], ['blueprint/src/content.tex']);
    const rows = listDeclarations(model);
    expect(rows.map((row) => row.label)).toEqual(['thm:a', 'thm:b']);
    expect(rows.map((row) => row.sortIndex)).toEqual([0, 1]);
    expect(model.includedFiles).toEqual(['blueprint/src/content.tex']);
    expect(model.parserRevision).toBe(1);
  });

  it('dedupes duplicate labels in source, keeping the first', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const model = createEmptyModel();
    refresh(model, [parsed('thm:a', { title: 'First' }), parsed('thm:b'), parsed('thm:a', { title: 'Duplicate' })], ['thm:a', 'thm:b']);
    expect(listDeclarations(model).map((row) => row.label)).toEqual(['thm:a', 'thm:b']);
    expect(getDeclaration(model, 'thm:a')?.title).toBe('First');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Duplicate label thm:a'));
    warn.mockRestore();
  });

  it('preserves agent-written Lean fields when the .tex has none', () => {
    const model = createEmptyModel();
    refresh(model, [parsed('thm:a')], ['thm:a']);
    expect(updateDeclarationFields(model, 'thm:a', { leanDeclaration: 'Foo.bar', leanFile: 'Foo/Bar.lean' })).toBe(true);
    refresh(model, [parsed('thm:a')], ['thm:a']);
    const row = getDeclaration(model, 'thm:a')!;
    expect(row.leanDeclaration).toBe('Foo.bar');
    expect(row.leanFile).toBe('Foo/Bar.lean');
  });

  it('lets .tex Lean tags override agent Lean fields', () => {
    const model = createEmptyModel();
    refresh(model, [parsed('thm:a')], ['thm:a']);
    updateDeclarationFields(model, 'thm:a', { leanDeclaration: 'Old.name', leanFile: 'Old.lean' });
    refresh(model, [parsed('thm:a', { leanDeclaration: 'New.name', leanFile: 'New/File.lean' })], ['thm:a']);
    const row = getDeclaration(model, 'thm:a')!;
    expect(row.leanDeclaration).toBe('New.name');
    expect(row.leanFile).toBe('New/File.lean');
  });

  it('preserves agent-owned fields across refresh while overwriting parser-owned ones', () => {
    const model = createEmptyModel();
    refresh(model, [parsed('thm:a', { title: 'Old' })], ['thm:a']);
    updateDeclarationFields(model, 'thm:a', { assessment: 'IMPOSSIBLE', notes: 'tricky', issues: ['needs lemma'] });
    refresh(model, [parsed('thm:a', { title: 'New parsed title' })], ['thm:a']);
    const row = getDeclaration(model, 'thm:a')!;
    expect(row.title).toBe('New parsed title');
    expect(row.assessment).toBe('IMPOSSIBLE');
    expect(row.notes).toBe('tricky');
    expect(row.issues).toEqual(['needs lemma']);
  });

  it('status follows the parsed leanok status on every refresh', () => {
    const model = createEmptyModel();
    refresh(model, [parsed('thm:a', { status: 'proved' })], ['thm:a']);
    expect(getDeclaration(model, 'thm:a')?.status).toBe('proved');
    refresh(model, [parsed('thm:a', { status: 'not_started' })], ['thm:a']);
    expect(getDeclaration(model, 'thm:a')?.status).toBe('not_started');
  });

  it('deletes a label gone from the source', () => {
    const model = createEmptyModel();
    refresh(model, [parsed('thm:a'), parsed('thm:b')], ['thm:a', 'thm:b']);
    refresh(model, [parsed('thm:a')], ['thm:a']);
    expect(listDeclarations(model).map((row) => row.label)).toEqual(['thm:a']);
  });

  it('preserves a label still in source but unparsed', () => {
    const model = createEmptyModel();
    refresh(model, [parsed('thm:a'), parsed('thm:b')], ['thm:a', 'thm:b']);
    refresh(model, [parsed('thm:a')], ['thm:a', 'thm:b']);
    expect(new Set(listDeclarations(model).map((row) => row.label))).toEqual(new Set(['thm:a', 'thm:b']));
  });

  it('collapses duplicate labels in the parsed set, first wins', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const model = createEmptyModel();
    refresh(
      model,
      [parsed('def:dimensions', { title: 'From web.tex' }), parsed('thm:b'), parsed('def:dimensions', { title: 'From print.tex' })],
      ['def:dimensions', 'thm:b'],
    );
    expect(listDeclarations(model).map((row) => row.label).sort()).toEqual(['def:dimensions', 'thm:b']);
    const row = getDeclaration(model, 'def:dimensions')!;
    expect(row.title).toBe('From web.tex');
    expect(row.sortIndex).toBe(0);
    vi.restoreAllMocks();
  });
});

describe('mappings', () => {
  it('declaration_to_entry and declaration_to_json round trip', () => {
    const model = createEmptyModel();
    refresh(model, [parsed('thm:a', { uses: ['lem:x'], leanDeclaration: 'A.b' })], ['thm:a']);
    const row = getDeclaration(model, 'thm:a')!;
    const entry = declarationToEntry(row);
    expect(entry.label).toBe('thm:a');
    expect(entry.lean_name).toBe('A.b');
    expect(entry.uses).toEqual(['lem:x']);
    expect(entry.lean_line).toBe(0);
    expect(entry.title).toBe('Title for thm:a');
    const payload = declarationToJson(row);
    expect(payload.leanDeclaration).toBe('A.b');
    expect(payload.uses).toEqual(['lem:x']);
    expect(payload.status).toBe('not_started');
    expect(Object.keys(payload).sort()).toEqual(
      ['label', 'kind', 'title', 'leanDeclaration', 'leanFile', 'uses', 'statement', 'proof', 'sourceFile', 'proofSourceFile', 'status', 'assessment', 'notes', 'issues', 'scratchFile', 'relevantDeclarations'].sort(),
    );
  });

  it('entry title falls back to the label and accepts nonstandard kinds', () => {
    const model = createEmptyModel();
    refresh(model, [parsed('clm:a', { kind: 'claim', title: '' })], ['clm:a']);
    const entry = declarationToEntry(getDeclaration(model, 'clm:a')!);
    expect(entry.kind).toBe('claim');
    expect(entry.title).toBe('clm:a');
  });

  it('blueprintSettings is forgiving about stored values', () => {
    expect(blueprintSettings({ pr_mode: 'draft', auto_commit: false })).toEqual({ prMode: 'draft', autoCommit: false });
    expect(blueprintSettings({ pr_mode: 'bogus' as never, auto_commit: undefined as never })).toEqual({ prMode: 'off', autoCommit: false });
  });
});

describe('reference resolution', () => {
  function seeded(): BlueprintModel {
    const model = createEmptyModel();
    refresh(model, [parsed('thm:froda', { leanDeclaration: 'Numina.Froda.froda' }), parsed('lem:helper', { leanDeclaration: 'Numina.Froda.helper' })], ['thm:froda', 'lem:helper']);
    return model;
  }

  it('exact label wins', () => {
    expect(getDeclarationByReference(seeded(), 'thm:froda')?.label).toBe('thm:froda');
  });

  it('resolves qualified, bare and prefixed Lean names', () => {
    const model = seeded();
    for (const reference of ['Numina.Froda.froda', 'froda', 'lem:froda']) {
      expect(getDeclarationByReference(model, reference)?.label, reference).toBe('thm:froda');
    }
  });

  it('unknown and ambiguous references stay unresolved', () => {
    const model = seeded();
    expect(getDeclarationByReference(model, 'nope')).toBeNull();
    const rows = listDeclarations(model);
    for (const row of rows) row.leanDeclaration = 'Numina.Dup.same';
    expect(resolveDeclarationByLeanName(rows, 'same')).toBeNull();
  });
});

describe('agent field writes', () => {
  it('rejects fields outside the allowlist and keeps status read-only', () => {
    const model = createEmptyModel();
    refresh(model, [parsed('thm:a')], ['thm:a']);
    expect(() => updateDeclarationFields(model, 'thm:a', { status: 'proved' })).toThrow(/not an agent-writable field/);
    expect(updateDeclarationFields(model, 'missing', { notes: 'x' })).toBe(false);
    expect(setDeclarationStatus(model, 'thm:a', 'proved')).toBe(true);
    expect(getDeclaration(model, 'thm:a')?.status).toBe('proved');
    expect(setDeclarationStatus(model, 'missing', 'proved')).toBe(false);
    updateDeclarationFields(model, 'thm:a', { assessment: null });
    expect(getDeclaration(model, 'thm:a')?.assessment).toBe('');
    expect(deleteAllDeclarations(model)).toBe(1);
    expect(listDeclarations(model)).toEqual([]);
  });
});

describe('relevant declarations', () => {
  it('coerces a bare name to an object', () => {
    expect(coerceRelevantDeclaration('Nat.add_comm')).toEqual({ name: 'Nat.add_comm' });
  });

  it('keeps only known object keys', () => {
    expect(
      coerceRelevantDeclaration({ name: 'Metric.packingNumber', source: 'Mathlib', location: 'Mathlib/X.lean', signature: 'sig', relevance: 'the bound', use: 'gone', kind: 'gone' }),
    ).toEqual({ name: 'Metric.packingNumber', source: 'Mathlib', location: 'Mathlib/X.lean', signature: 'sig', relevance: 'the bound' });
  });

  it('coerces a mixed list and skips malformed legacy entries', () => {
    expect(coerceRelevantDeclarations(['Nat.add_comm', { name: 'List.map', source: 'Mathlib' }])).toEqual([{ name: 'Nat.add_comm' }, { name: 'List.map', source: 'Mathlib' }]);
    expect(coerceRelevantDeclarations(['Nat.add_comm', null, 123, { name: 'List.map' }])).toEqual([{ name: 'Nat.add_comm' }, { name: 'List.map' }]);
  });

  it('update and read round trip coerces', () => {
    const model = createEmptyModel();
    refresh(model, [parsed('thm:a')], ['thm:a']);
    updateDeclarationFields(model, 'thm:a', { relevantDeclarations: ['Nat.add_comm', { name: 'Metric.packingNumber', signature: 'sig' }] });
    const payload = declarationToJson(getDeclaration(model, 'thm:a')!);
    expect(payload.relevantDeclarations).toEqual([{ name: 'Nat.add_comm' }, { name: 'Metric.packingNumber', signature: 'sig' }]);
    expect('buildOn' in payload).toBe(false);
  });

  it('merge unions by name, incoming wins, order preserved', () => {
    expect(mergeRelevantDeclarations([{ name: 'A' }, { name: 'B', signature: 'old' }], [{ name: 'B', signature: 'new' }, { name: 'C' }])).toEqual([
      { name: 'A' },
      { name: 'B', signature: 'new' },
      { name: 'C' },
    ]);
  });

  it('merge does not downgrade an enriched entry', () => {
    expect(mergeRelevantDeclarations([{ name: 'A', source: 'Mathlib', signature: 'sig' }], [{ name: 'A' }])).toEqual([{ name: 'A', source: 'Mathlib', signature: 'sig' }]);
    expect(mergeRelevantDeclarations([{ name: 'A', signature: 'sig' }], [{ name: 'A', signature: '', source: 'Mathlib' }])).toEqual([{ name: 'A', signature: 'sig', source: 'Mathlib' }]);
  });

  it('a second write does not clobber the first', () => {
    const model = createEmptyModel();
    refresh(model, [parsed('thm:a')], ['thm:a']);
    updateDeclarationFields(model, 'thm:a', { relevantDeclarations: ['A', 'B'] });
    updateDeclarationFields(model, 'thm:a', { relevantDeclarations: [{ name: 'A', signature: 's' }, { name: 'C' }] });
    expect(declarationToJson(getDeclaration(model, 'thm:a')!).relevantDeclarations).toEqual([{ name: 'A', signature: 's' }, { name: 'B' }, { name: 'C' }]);
  });
});

describe('persistence', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'fuse-model-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('locates the model file under the app data directory, or a project sidecar for a directory target', () => {
    expect(modelFilePath({ blueprintDir: (id, name) => join(tmp, String(id), name) }, 3, 'demo')).toBe(join(tmp, '3', 'demo', 'model.json'));
    expect(resolveModelFile(join(tmp, 'model.json'))).toBe(join(tmp, 'model.json'));
    expect(resolveModelFile(tmp)).toBe(join(tmp, '.fuse-desktop', 'blueprint.json'));
    // A directory target never gets written over: the sidecar lives inside it.
    const model = createEmptyModel();
    refresh(model, [parsed('thm:a')], ['thm:a']);
    saveModel(tmp, model);
    expect(readFileSync(join(tmp, '.fuse-desktop', 'blueprint.json'), 'utf8')).toContain('thm:a');
    expect(listDeclarations(loadModel(tmp)).map((row) => row.label)).toEqual(['thm:a']);
  });

  it('round trips through model.json and tolerates a missing or corrupt file', () => {
    const file = join(tmp, 'blueprints', 'demo', 'model.json');
    expect(loadModel(file).declarations.size).toBe(0);
    const model = createEmptyModel();
    model.leanModule = 'Demo';
    refresh(model, [parsed('thm:b', { uses: ['thm:a'] }), parsed('thm:a', { status: 'proved', leanDeclaration: 'Demo.a' })], ['thm:a', 'thm:b'], ['blueprint/src/content.tex']);
    applyParserRefresh(model, {
      declarations: [parsed('thm:b', { uses: ['thm:a'] }), parsed('thm:a', { status: 'proved', leanDeclaration: 'Demo.a' })],
      includedFiles: ['blueprint/src/content.tex'],
      missingIncludes: ['blueprint/src/chapters/todo.tex'],
      labelsInSource: new Set(['thm:a', 'thm:b']),
    });
    updateDeclarationFields(model, 'thm:a', { notes: 'kept', relevantDeclarations: ['X'] });
    saveModel(file, model);
    const loaded = loadModel(file);
    expect(loaded.leanModule).toBe('Demo');
    expect(loaded.includedFiles).toEqual(['blueprint/src/content.tex']);
    expect(loaded.missingIncludes).toEqual(['blueprint/src/chapters/todo.tex']);
    expect(loaded.parserRevision).toBe(2);
    expect(listDeclarations(loaded).map((row) => row.label)).toEqual(['thm:b', 'thm:a']);
    expect(getDeclaration(loaded, 'thm:a')).toEqual(getDeclaration(model, 'thm:a'));
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeFileSync(file, '{not json');
    expect(loadModel(file).declarations.size).toBe(0);
    warn.mockRestore();
  });
});
