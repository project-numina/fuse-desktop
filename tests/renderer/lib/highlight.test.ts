import { describe, expect, it } from 'vitest';

import { highlightLatex, highlightLean } from '@/lib/highlight';

describe('syntax highlighting', () => {
  it('highlights Lean and preserves empty input', () => {
    expect(highlightLean('theorem foo : Nat := 0')).toContain('hljs-');
    expect(highlightLean('')).toBe('');
  });

  it('highlights LaTeX and preserves empty input', () => {
    expect(highlightLatex('\\begin{theorem}')).toContain('token');
    expect(highlightLatex('')).toBe('');
  });
});
