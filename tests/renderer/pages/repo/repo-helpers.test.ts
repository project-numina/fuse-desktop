import { beforeEach, describe, expect, it } from 'vitest';

import {
  activeBlueprints,
  blueprintPath,
  completedNuminaPullRequests,
  readPendingBlueprintDeletes,
  writePendingBlueprintDeletes,
} from '@/pages/repo/repo-helpers';

describe('repository page helpers', () => {
  beforeEach(() => sessionStorage.clear());

  it('round-trips pending deletes only for their repository', () => {
    writePendingBlueprintDeletes(new Set(['bp-1']), 'numina', 'fuse');

    expect(readPendingBlueprintDeletes('numina', 'fuse')).toEqual(['bp-1']);
    expect(readPendingBlueprintDeletes('numina', 'other')).toEqual([]);
    writePendingBlueprintDeletes(new Set(), 'numina', 'fuse');
    expect(sessionStorage.getItem('pendingBlueprintDelete')).toBeNull();
  });

  it('derives active and completed rows from PR state', () => {
    const blueprints = [
      { id: 'older', name: 'Older', updated_at: '2025-01-01T00:00:00Z' },
      { id: 'newer', name: 'Newer', updated_at: '2026-01-01T00:00:00Z' },
      { id: 'merged', name: 'Merged' },
    ];
    const pullRequests = [
      { number: 1, title: 'Done', branch: 'numina/merged', status: 'merged' },
      { number: 2, title: 'External', branch: 'feature', status: 'merged' },
    ];

    expect(activeBlueprints(blueprints, pullRequests, new Set()).map((item) => item.id))
      .toEqual(['newer', 'older']);
    expect(completedNuminaPullRequests(pullRequests).map((item) => item.number))
      .toEqual([1]);
    expect(blueprintPath('numina', 'fuse', 'newer'))
      .toBe('/repo/numina/fuse/blueprint/newer');
  });
});
