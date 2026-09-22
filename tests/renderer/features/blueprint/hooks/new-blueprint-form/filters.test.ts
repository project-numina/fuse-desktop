import { describe, expect, it } from 'vitest';
import { filterBranches } from '@/features/blueprint/hooks/new-blueprint-form/filters';

describe('new blueprint branch filtering', () => {
  it('matches a trimmed query without changing the source order', () => {
    const branches = ['develop', 'Feature/Lean', 'release'];
    expect(filterBranches(branches, ' LEAN ')).toEqual(['Feature/Lean']);
    expect(filterBranches(branches, '  ')).toBe(branches);
  });
});
