import { describe, expect, it } from 'vitest';

import {
  runtimeAffinedApiPath,
  runtimeRouteTag,
  setWorkspaceRuntimeTag,
} from '@/lib/runtime-routing';

describe('runtime routing (single local backend)', () => {
  it('never derives a release tag from a session id', () => {
    expect(runtimeRouteTag('A1B2C3D4-1234-4567-89ab-0123456789ab')).toBeNull();
    expect(runtimeRouteTag(null)).toBeNull();
    expect(runtimeRouteTag('session-42')).toBeNull();
  });

  it('leaves API paths untouched even after a tag is registered', () => {
    setWorkspaceRuntimeTag('o', 'r', 'b', 'a1b2c3d4');
    expect(runtimeAffinedApiPath('/repositories/o/r/blueprints/b')).toBe(
      '/repositories/o/r/blueprints/b',
    );
    expect(runtimeAffinedApiPath(
      '/repositories/owner%20name/repo/sources/import',
      { owner: 'owner name', repository: 'repo', blueprint: 'blueprint one' },
    )).toBe('/repositories/owner%20name/repo/sources/import');
    expect(runtimeAffinedApiPath('/sessions?x=1')).toBe('/sessions?x=1');
    setWorkspaceRuntimeTag('o', 'r', 'b', null);
  });
});
