import { describe, expect, it } from 'vitest';

import {
  buildBreadcrumbs,
  buildDirectoryEntries,
  buildErrorTitle,
  changedFilesDividerIndex,
  diffStatsTitle,
  normalizeTreeRoot,
  parentPath,
} from '@/features/blueprint/components/changed-files-tree';

describe('changed files tree derivation', () => {
  it('aggregates folders and orders changed entries before clean ones', () => {
    const entries = buildDirectoryEntries({
      files: [
        'lean/root/a-clean.lean',
        'lean/root/z-changed.lean',
        'lean/root/sub/A.lean',
      ],
      directories: ['lean/root/empty'],
      currentPath: 'lean/root',
      diffStats: {
        'lean/root/z-changed.lean': { added: 2, deleted: 1 },
        'lean/root/sub/A.lean': { added: 3, deleted: 0 },
      },
      buildErrorCounts: {
        'lean/root/sub/A.lean': { errors: 1, warnings: 2 },
      },
    });

    expect(entries.map((entry) => `${entry.kind}:${entry.name}`)).toEqual([
      'folder:sub',
      'file:z-changed.lean',
      'folder:empty',
      'file:a-clean.lean',
    ]);
    expect(entries[0]).toMatchObject({
      diff: { added: 3, deleted: 0 },
      buildErrors: { errors: 1, warnings: 2 },
    });
    expect(changedFilesDividerIndex(entries)).toBe(2);
    expect(diffStatsTitle(entries[0])).toContain('+3 / -0 lines in this folder');
    expect(buildErrorTitle(entries[0])).toBe('1 error, 2 warnings in this folder');
  });

  it('normalizes roots and builds bounded breadcrumb paths', () => {
    expect(normalizeTreeRoot(' /lean/project/ ')).toBe('lean/project');
    expect(buildBreadcrumbs('lean/project/Foo/Bar', 'lean/project')).toEqual([
      { name: 'Foo', path: 'lean/project/Foo' },
      { name: 'Bar', path: 'lean/project/Foo/Bar' },
    ]);
    expect(parentPath('lean/project/Foo', 'lean/project')).toBe('lean/project');
    expect(parentPath('Foo', '')).toBe('');
  });

  it('omits dividers and titles when there is no corresponding metadata', () => {
    const entries = buildDirectoryEntries({
      files: ['A.lean'],
      directories: [],
      currentPath: '',
      diffStats: {},
      buildErrorCounts: {},
    });
    expect(changedFilesDividerIndex(entries)).toBe(-1);
    expect(diffStatsTitle(entries[0])).toBe('');
    expect(buildErrorTitle(entries[0])).toBe('');
  });
});
