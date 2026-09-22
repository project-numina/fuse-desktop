import { describe, expect, it } from 'vitest';
import {
  createWorkspaceFormData,
  creationValidationError,
  scaffoldPath,
} from '@/features/blueprint/hooks/new-blueprint-form/submit';

describe('new blueprint submission helpers', () => {
  it('preserves validation priority', () => {
    expect(creationValidationError({
      title: ' ',
      isLoadingBranches: true,
      branchesLoadFailed: false,
      baseBranch: '',
      existingIds: new Set(),
    })).toBe('Please enter a title');
    expect(creationValidationError({
      title: 'Existing proof',
      isLoadingBranches: false,
      branchesLoadFailed: false,
      baseBranch: 'main',
      existingIds: new Set(['existing-proof']),
    })).toBe('A blueprint with this title already exists');
  });

  it('omits the branch after discovery fails', () => {
    const data = createWorkspaceFormData('Proof', 'main', true, 'Math');
    expect(Object.fromEntries(data.entries())).toEqual({
      title: 'Proof',
      project_subdir: 'Math',
    });
  });

  it('builds the scaffold continuation URL from trimmed user input', () => {
    expect(scaffoldPath('numina', 'math', ' Lean setup ', 'develop')).toBe(
      '/new?owner=numina&repo=math&base=develop&title=Lean+setup',
    );
  });
});
