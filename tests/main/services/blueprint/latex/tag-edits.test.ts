import { describe, expect, it, vi } from 'vitest';
import { setLatexWarningSink } from '@main/services/blueprint/latex/log';
import {
  applyEdits,
  isInComment,
  leanokRemovalEdits,
  rewriteProofLeanok,
} from '@main/services/blueprint/latex/tag-edits';

describe('tag edit primitives', () => {
  it('sorts edits and skips overlaps without corrupting source', () => {
    const warning = vi.fn();
    setLatexWarningSink(warning);
    expect(applyEdits('abcdef', [[4, 6, 'F'], [1, 3, 'B'], [2, 5, 'X']])).toBe('aBdF');
    expect(warning).toHaveBeenCalledOnce();
    setLatexWarningSink(null);
  });

  it('distinguishes comments from escaped percent signs', () => {
    expect(isInComment('text % \\leanok', 8)).toBe(true);
    expect(isInComment('text \\% \\leanok', 9)).toBe(false);
  });

  it('removes owned markers while preserving excluded spans', () => {
    const source = '\\leanok\ntext \\leanok here\n';
    const inline = source.lastIndexOf('\\leanok');
    const edits = leanokRemovalEdits(source, 0, source.length, [[inline, inline + 7]]);
    expect(applyEdits(source, edits)).toBe('text \\leanok here\n');
  });

  it('normalizes multiline and single-line proof markers', () => {
    expect(rewriteProofLeanok('\\begin{proof}\n  exact h\n\\end{proof}', true, '\n')).toBe(
      '\\begin{proof}\n  \\leanok\n  exact h\n\\end{proof}',
    );
    expect(rewriteProofLeanok('\\begin{proof} \\leanok exact h \\end{proof}', false, '\n')).toBe(
      '\\begin{proof} exact h \\end{proof}',
    );
  });
});
