import { describe, expect, it } from 'vitest';

import { entriesToLatex, mergeParsedEntries } from '@/features/blueprint/hooks/latex-parser/state';
import type { BlueprintEntry } from '@/features/blueprint/hooks/latex-parser/types';

function entry(overrides: Partial<BlueprintEntry> = {}): BlueprintEntry {
  return {
    kind: 'theorem',
    label: 'thm:main',
    title: 'Main result',
    statement: 'Every widget is good.',
    proof: null,
    leanName: '',
    leanFile: '',
    uses: [],
    status: 'not_started',
    ...overrides,
  };
}

describe('latex parser state helpers', () => {
  it('serializes metadata and proof blocks using server-compatible field aliases', () => {
    expect(entriesToLatex([entry({
      leanName: 'Ignored.Local',
      lean_name: 'Widget.main',
      lean_file: 'Widget/Main.lean',
      uses: ['def:a', 'lem:b'],
      proof: 'By inspection.',
    })])).toBe(
      '\\begin{theorem}[Main result]\n'
      + '\\label{thm:main}\n'
      + '\\lean{Widget.main}\n'
      + '\\leanfile{Widget/Main.lean}\n'
      + '\\uses{def:a, lem:b}\n'
      + '\nEvery widget is good.\n'
      + '\\end{theorem}\n'
      + '\\begin{proof}\nBy inspection.\n\\end{proof}',
    );
  });

  it('normalizes server entries when the local document has no declarations', () => {
    const server = entry({
      leanName: '',
      leanFile: '',
      lean_name: 'Widget.main',
      lean_file: 'Widget/Main.lean',
      uses: undefined as unknown as string[],
      status: '',
      proof: undefined as unknown as null,
    });

    expect(mergeParsedEntries([], [server])).toEqual([{
      ...server,
      leanName: 'Widget.main',
      leanFile: 'Widget/Main.lean',
      uses: [],
      status: '',
      proof: null,
    }]);
  });

  it('merges authoritative status, issues, proof, and missing Lean name', () => {
    const local = entry({ uses: ['def:local'] });
    const issues = [{ message: 'Needs work' }];
    const merged = mergeParsedEntries([local], [entry({
      status: 'proved',
      issues,
      proof: 'Server proof.',
      lean_name: 'Widget.main',
    })]);

    expect(merged[0]).toMatchObject({
      status: 'proved',
      issues,
      proof: 'Server proof.',
      leanName: 'Widget.main',
      uses: ['def:local'],
    });
    expect(merged[0]).not.toBe(local);
    expect(merged[0].uses).not.toBe(local.uses);
    expect(local).toMatchObject({ proof: null, leanName: '', status: 'not_started' });
  });

  it('keeps locally parsed proof and Lean name over server fallbacks', () => {
    const local = entry({ proof: 'Local proof.', leanName: 'Local.main' });
    expect(mergeParsedEntries([local], [entry({
      proof: 'Server proof.',
      lean_name: 'Server.main',
    })])[0]).toMatchObject({
      proof: 'Local proof.',
      leanName: 'Local.main',
    });
  });
});
