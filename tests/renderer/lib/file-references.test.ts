import { describe, expect, it } from 'vitest';

import { resolveAvailableFilePath } from '@/lib/file-references';

describe('resolveAvailableFilePath', () => {
  const files = [
    'Cordoba.lean',
    'lean/geometry/Cordoba.lean',
    'lean/geometry/Incidence.lean',
  ];

  it('matches absolute agent paths to the longest repository-relative suffix', () => {
    expect(
      resolveAvailableFilePath(
        '/data/clones/project/lean/geometry/Cordoba.lean',
        files,
      ),
    ).toBe('lean/geometry/Cordoba.lean');
  });

  it('accepts exact relative paths and normalizes path separators', () => {
    expect(resolveAvailableFilePath('./lean/geometry/Incidence.lean', files)).toBe(
      'lean/geometry/Incidence.lean',
    );
    expect(resolveAvailableFilePath('lean\\geometry\\Incidence.lean', files)).toBe(
      'lean/geometry/Incidence.lean',
    );
  });

  it('rejects basename-only and unavailable matches', () => {
    expect(resolveAvailableFilePath('/tmp/Incidence.lean', files)).toBeNull();
    expect(
      resolveAvailableFilePath('/tmp/Cordoba.lean', [
        'lean/geometry/Cordoba.lean',
        'lean/topology/Cordoba.lean',
      ]),
    ).toBeNull();
    expect(resolveAvailableFilePath('/tmp/Unknown.lean', files)).toBeNull();
  });

  it('does not confuse a dependency file with a same-named workspace file', () => {
    expect(
      resolveAvailableFilePath(
        '/repo/.lake/packages/mathlib/Mathlib/Order/Basic.lean',
        ['lean/project/Basic.lean'],
      ),
    ).toBeNull();
  });
});
