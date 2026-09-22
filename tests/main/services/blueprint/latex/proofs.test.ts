import { describe, expect, it } from 'vitest';
import { maskLatexComments } from '@main/services/blueprint/latex/comments';
import { attributeProof, provesIndex, scanProofBlocks } from '@main/services/blueprint/latex/proofs';

describe('LaTeX proof references', () => {
  it('does not assign a nested proves tag to its enclosing proof', () => {
    const source = String.raw`\begin{proof}
Outer.
\begin{proof}\proves{inner}Inner.\end{proof}
\end{proof}`;
    const blocks = scanProofBlocks(source, maskLatexComments(source));
    expect(blocks.map((block) => block.proves)).toEqual([null, 'inner']);
  });

  it('prefers an adjacent proof over a detached reference', () => {
    const source = String.raw`\end{lemma}
\begin{proof}Adjacent.\end{proof}
\begin{proof}\proves{target}Detached.\end{proof}`;
    const blocks = scanProofBlocks(source, source);
    const starts = blocks.map((block) => block.start);
    const proof = attributeProof(source, blocks, starts, provesIndex(blocks), {
      environmentEnd: String.raw`\end{lemma}`.length,
      bodyStart: 0,
      bodyEnd: 0,
      nested: [],
      label: 'target',
    });
    expect(proof?.start).toBe(blocks[0].start);
  });

  it('indexes only the first proof claiming a target', () => {
    const source = String.raw`\begin{proof}\proves{target}One.\end{proof}
\begin{proof}\proves{target}Two.\end{proof}`;
    const blocks = scanProofBlocks(source, source);
    expect(provesIndex(blocks).get('target')?.start).toBe(blocks[0].start);
  });
});
