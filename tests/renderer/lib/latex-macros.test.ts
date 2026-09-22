import { describe, expect, it } from 'vitest';

import { EMPTY_MACROS, toKatexMacros } from '@/lib/latex-macros';

describe('LaTeX macros', () => {
  it('normalizes command names for KaTeX without mutating the source', () => {
    const source = { RR: '\\mathbb{R}', NN: '\\mathbb{N}' };
    expect(toKatexMacros(source)).toEqual({ '\\RR': '\\mathbb{R}', '\\NN': '\\mathbb{N}' });
    expect(source).toEqual({ RR: '\\mathbb{R}', NN: '\\mathbb{N}' });
  });

  it('provides an immutable empty dictionary', () => {
    expect(EMPTY_MACROS).toEqual({});
    expect(Object.isFrozen(EMPTY_MACROS)).toBe(true);
  });
});
