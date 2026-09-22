import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api';
import {
  blueprintContinuationPath,
  isValidModuleName,
  sanitizeModuleName,
  sanitizeTargetSubdir,
  setupErrorMessage,
  stableLeanVersions,
} from '@/pages/new-project/new-project-helpers';

describe('new project helpers', () => {
  it('normalizes project names and subfolder paths', () => {
    expect(sanitizeModuleName('123-lean_project')).toBe('LeanProject');
    expect(sanitizeModuleName('---')).toBe('Project');
    expect(isValidModuleName(' MyLibrary ')).toBe(true);
    expect(isValidModuleName('my-library')).toBe(false);
    expect(sanitizeTargetSubdir(' /lean/project/ ')).toBe('lean/project');
  });

  it('filters prereleases and preserves stable Lean versions', () => {
    expect(stableLeanVersions([
      { name: 'v4.25.0' },
      { name: 'v4.26.0-rc1' },
    ])).toEqual([{ name: 'v4.25.0' }]);
  });

  it('maps API details and builds an encoded continuation path', () => {
    expect(setupErrorMessage(new ApiError('Conflict', 409, 'Already exists.')))
      .toBe('Already exists.');
    expect(blueprintContinuationPath({
      owner: 'home',
      repository: 'repo',
      title: 'My theorem',
      baseBranch: 'feature/work',
    })).toBe(
      '/repo/home/repo/blueprint/new?title=My+theorem&base=feature%2Fwork',
    );
  });
});
