import { describe, expect, it } from 'vitest';
import { maskLatexComments } from '@main/services/blueprint/latex/comments';
import { normalizeStatement, proofSpans } from '@main/services/blueprint/latex/normalization';

describe('LaTeX declaration normalization', () => {
  it('normalizes metadata while retaining raw capture values', () => {
    const body = String.raw`\label{item}
\lean{Project.item}
\leanfile{Project/File.lean}
\uses{first, second}\uses{second, third}
\leanok
Statement.`;
    expect(normalizeStatement(body, maskLatexComments(body))).toEqual({
      statement: 'Statement.',
      uses: ['first', 'second', 'third'],
      leanName: 'Project.item',
      leanFile: 'Project/File.lean',
      statementLeanok: true,
    });
  });

  it('removes a nested proof as one outermost statement span', () => {
    const body = String.raw`Statement.
\begin{proof}Outer.\begin{proof}Inner.\end{proof}Done.\end{proof}
After.`;
    const spans = proofSpans(body);
    expect(spans).toHaveLength(1);
    expect(body.slice(...spans[0])).toContain('Inner.');
    expect(normalizeStatement(body, body).statement).toBe('Statement.\nAfter.');
  });

  it('ignores metadata hidden by a LaTeX comment', () => {
    const body = '% \\leanok\nStatement.';
    expect(normalizeStatement(body, maskLatexComments(body)).statementLeanok).toBe(false);
  });
});
