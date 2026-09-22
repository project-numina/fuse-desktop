import { describe, expect, it } from 'vitest';

import { cn } from '@/lib/utils';

describe('cn', () => {
  it('joins conditional classes and resolves conflicting Tailwind utilities', () => {
    expect(cn('px-2', false && 'hidden', ['font-bold'], { block: true }, 'px-4'))
      .toBe('font-bold block px-4');
  });
});
