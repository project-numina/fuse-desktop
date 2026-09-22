import { describe, expect, it } from 'vitest';

import { stripInlineMathDelimiters } from '@/lib/inline-math-text';

describe('stripInlineMathDelimiters', () => {
  it('removes dollar and parenthesis delimiters from valid inline math', () => {
    expect(
      stripInlineMathDelimiters(
        String.raw`Eigenvalues of $-y'' = \lambda y$ on \([0,\pi]\) are $n^2$`,
      ),
    ).toBe(String.raw`Eigenvalues of -y'' = \lambda y on [0,\pi] are n^2`);
  });

  it('preserves free text and paired currency amounts', () => {
    const title = String.raw`Optimization 100% complete; back\slash; Price $5 and $10`;

    expect(stripInlineMathDelimiters(title)).toBe(title);
  });
});
