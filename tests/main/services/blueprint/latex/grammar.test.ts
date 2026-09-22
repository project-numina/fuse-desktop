import { describe, expect, it } from 'vitest';
import {
  extractOptionalTitle,
  findAll,
  nestedDeclarationSpans,
} from '@main/services/blueprint/latex/grammar';

describe('LaTeX declaration grammar', () => {
  it('does not return a match that crosses the bounded search region', () => {
    expect(findAll(/ab./, 'ab1ab2', 0, 5).map((match) => match[0])).toEqual(['ab1']);
  });

  it('keeps brackets in inline math inside an optional title', () => {
    const source = String.raw` [$x[0]$ and [nested]] body`;
    expect(extractOptionalTitle(source, source, 0)).toEqual({
      title: '$x[0]$ and [nested]',
      end: 22,
    });
  });

  it('extends a nested declaration span through its trailing proof', () => {
    const source = String.raw`before
\begin{lemma}\label{inner}Inner.\end{lemma}
\begin{proof}Proof.\end{proof}
after`;
    const spans = nestedDeclarationSpans(source, source, 0, source.length);
    expect(spans).toHaveLength(1);
    expect(source.slice(...spans[0])).toBe(String.raw`\begin{lemma}\label{inner}Inner.\end{lemma}
\begin{proof}Proof.\end{proof}`);
  });
});
