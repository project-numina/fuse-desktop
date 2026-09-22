import { describe, expect, it } from 'vitest';

import {
  cutSpans,
  extractOptionalTitle,
  findMatchingEnd,
  maskLatexComments,
  nestedDeclarationSpans,
  removeMatches,
} from '@/features/blueprint/hooks/latex-parser/syntax';

describe('latex parser syntax helpers', () => {
  it('masks comments without moving source offsets or masking URL percentages', () => {
    const source = '\\url{https://example.com/a%20b} % hidden\nvisible\\% literal';
    const masked = maskLatexComments(source);
    expect(masked).toHaveLength(source.length);
    expect(masked).toContain('a%20b');
    expect(masked).not.toContain('hidden');
    expect(masked).toContain('visible\\% literal');
  });

  it('extracts balanced titles while ignoring brackets inside inline math', () => {
    const source = '\\begin{theorem} [Spectrum on $[0,1]$] body';
    const start = source.indexOf('}') + 1;
    expect(extractOptionalTitle(source, start)).toEqual({
      title: 'Spectrum on $[0,1]$',
      end: source.indexOf(' body'),
    });
  });

  it('falls back to the first usable close for an unbalanced nested bracket', () => {
    const source = '[Convergence on [0,infinity) intervals] body';
    expect(extractOptionalTitle(source, 0)).toEqual({
      title: 'Convergence on [0,infinity) intervals',
      end: source.indexOf(' body'),
    });
    expect(extractOptionalTitle('plain', 0)).toEqual({ title: null, end: 0 });
  });

  it('matches nested environments and rejects missing ends', () => {
    const nested = '\\begin{theorem}outer\\begin{theorem}inner\\end{theorem}tail\\end{theorem}';
    const bodyStart = nested.indexOf('}') + 1;
    expect(findMatchingEnd(nested, bodyStart, 'theorem')).toBe(nested.length);
    expect(findMatchingEnd('\\begin{lemma}unfinished', 0, 'lemma')).toBeNull();
  });

  it('cuts nested declaration spans while retaining surrounding source', () => {
    const source = 'before\\begin{lemma}inner\\end{lemma}\nafter';
    const spans = nestedDeclarationSpans(source, source, 0, source.length);
    expect(spans).toHaveLength(1);
    expect(cutSpans(source, source, 0, source.length, spans)).toEqual({
      body: 'before\n\nafter',
      structure: 'before\n\nafter',
    });
  });

  it('removes overlapping structural matches only once', () => {
    const source = 'start ABCDEF end';
    expect(removeMatches(source, source, [/ABC/g, /CDEF/g])).toBe('start  end');
    expect(removeMatches(source, source, [/missing/g])).toBe(source);
  });
});
