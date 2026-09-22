import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { declarationLeanSource, declarationStatements, leanSorryCount, readLeanSources } from '@main/services/blueprint/lean-source';

const FILE = `import Mathlib

namespace Froda

/-- The cover lemma. -/
@[simp]
theorem cover (s : Set X) (n : Nat := 3) : Finite s := by
  intro x
  simp

def helper : Nat :=
  3 + 4

end Froda
`;

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'fuse-lean-source-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

describe('declaration extraction', () => {
  it('isolates a theorem from its neighbours', () => {
    const extracted = declarationLeanSource(FILE, 'cover');
    expect(extracted.startsWith('theorem cover')).toBe(true);
    expect(extracted).not.toContain('helper');
  });

  it('finds a namespaced declaration by its qualified name', () => {
    expect(declarationLeanSource(FILE, 'Froda.cover')).toBe(declarationLeanSource(FILE, 'cover'));
  });

  it('reads an absent declaration as no source', () => {
    expect(declarationLeanSource(FILE, 'missing')).toBe('');
  });

  it('reads an ambiguous name as no source', () => {
    expect(declarationLeanSource('theorem twice : True := trivial\ntheorem twice : True := trivial\n', 'twice')).toBe('');
  });

  it('ends a declaration at the namespace that closes it', () => {
    expect(declarationLeanSource(FILE, 'helper')).not.toContain('end Froda');
  });

  it('reads an empty name as no source', () => {
    expect(declarationLeanSource(FILE, '  ')).toBe('');
  });
});

describe('proof bodies', () => {
  it("a theorem's proof is not part of its source", () => {
    expect(declarationLeanSource('theorem cover : Finite s := sorry\n', 'cover')).toBe(declarationLeanSource('theorem cover : Finite s := by\n  simp\n', 'cover'));
  });

  it('a default argument is not mistaken for the body', () => {
    expect(declarationLeanSource(FILE, 'cover')).toContain('n : Nat := 3');
  });

  it("changing a theorem's statement changes its source", () => {
    expect(declarationLeanSource('theorem c : P := sorry\n', 'c')).not.toBe(declarationLeanSource('theorem c : Q := sorry\n', 'c'));
  });

  it("a definition's body is part of its source", () => {
    expect(declarationLeanSource('def f : Nat := 1\n', 'f')).not.toBe(declarationLeanSource('def f : Nat := 2\n', 'f'));
  });

  it('declarationStatements maps names to statements and drops duplicates', () => {
    const statements = declarationStatements(`${FILE}theorem dup : True := trivial\ntheorem dup : True := trivial\n`);
    expect(Object.keys(statements).sort()).toEqual(['cover', 'helper']);
    expect(statements.cover).toContain('theorem cover');
    expect(statements.cover).not.toContain(':= by');
  });

  it('counts sorry tokens outside comments', () => {
    expect(leanSorryCount('theorem a : True := sorry\n-- sorry\n/- sorry -/\ndef sorryful := 1\ntheorem b : True := by\n  sorry\n')).toBe(2);
  });
});

describe('reading from a project', () => {
  it('returns sources keyed by label', () => {
    mkdirSync(join(tmp, 'Froda'));
    writeFileSync(join(tmp, 'Froda', 'Basic.lean'), FILE, 'utf8');
    const sources = readLeanSources(tmp, [{ label: 'lem:cover', leanFile: 'Froda/Basic.lean', leanDeclaration: 'Froda.cover' }]);
    expect(sources['lem:cover'].startsWith('theorem cover')).toBe(true);
  });

  it('a sibling formalized into the same file is not a change', () => {
    mkdirSync(join(tmp, 'Froda'));
    const target = join(tmp, 'Froda', 'Basic.lean');
    const reference = { label: 'lem:cover', leanFile: 'Froda/Basic.lean', leanDeclaration: 'cover' };
    writeFileSync(target, FILE, 'utf8');
    const before = readLeanSources(tmp, [reference]);
    writeFileSync(target, FILE.replace('end Froda', 'theorem sibling : True := trivial\n\nend Froda'), 'utf8');
    expect(readLeanSources(tmp, [reference])).toEqual(before);
  });

  it('a missing file, no project root, or an escaping path reads as no source', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readLeanSources(tmp, [{ label: 'lem:cover', leanFile: 'Froda/Gone.lean', leanDeclaration: 'cover' }])).toEqual({});
    expect(readLeanSources(null, [{ label: 'lem:cover', leanFile: 'Froda/Basic.lean', leanDeclaration: 'cover' }])).toEqual({});
    writeFileSync(join(tmp, 'outside.lean'), 'theorem cover : True := trivial\n', 'utf8');
    const project = join(tmp, 'project');
    mkdirSync(project);
    expect(readLeanSources(project, [{ label: 'lem:cover', leanFile: '../outside.lean', leanDeclaration: 'cover' }])).toEqual({});
  });

  it('several names contribute one source', () => {
    mkdirSync(join(tmp, 'Froda'));
    writeFileSync(join(tmp, 'Froda', 'Basic.lean'), FILE, 'utf8');
    const sources = readLeanSources(tmp, [{ label: 'lem:cover', leanFile: 'Froda/Basic.lean', leanDeclaration: 'cover, helper' }]);
    expect(sources['lem:cover']).toContain('theorem cover');
    expect(sources['lem:cover']).toContain('def helper');
  });
});
