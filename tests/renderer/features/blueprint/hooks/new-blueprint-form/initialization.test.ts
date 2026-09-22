import { describe, expect, it } from 'vitest';
import { resolveRepositoryBranches } from '@/features/blueprint/hooks/new-blueprint-form/initialization';

describe('new blueprint branch initialization', () => {
  it('drops invalid and duplicate branch entries', () => {
    expect(resolveRepositoryBranches(
      ['develop', '', 'feature', 'develop', null],
      'main',
    )).toEqual(['develop', 'feature']);
  });

  it('uses the repository default only when no listed branch is valid', () => {
    expect(resolveRepositoryBranches(['', null], 'release')).toEqual(['release']);
    expect(resolveRepositoryBranches([], '')).toEqual([]);
  });
});
