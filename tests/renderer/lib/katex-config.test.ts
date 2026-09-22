import { describe, expect, it } from 'vitest';

import { sharedKatexOptions } from '@/lib/katex-config';

describe('shared KaTeX configuration', () => {
  it('renders malformed user input safely within bounded limits', () => {
    expect(sharedKatexOptions.throwOnError).toBe(false);
    expect(sharedKatexOptions.trust).toBe(false);
    expect(sharedKatexOptions.maxExpand).toBeGreaterThan(0);
    expect(sharedKatexOptions.maxSize).toBeGreaterThan(0);
  });
});
