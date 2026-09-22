import { beforeEach, describe, expect, it } from 'vitest';
import { FALLBACK_LEAN_VERSIONS, installedLeanVersions, listLeanVersions, resetLeanVersionCache } from '@main/services/lean/versions';

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
}

describe('listLeanVersions', () => {
  beforeEach(() => resetLeanVersionCache());

  it('returns GitHub release tags and caches them', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(JSON.stringify([{ tag_name: 'v4.25.0' }, { name: 'ignored' }, { tag_name: 'v4.24.0' }, 5]));
    }) as unknown as typeof fetch;
    expect(await listLeanVersions({ fetchImpl })).toEqual([{ name: 'v4.25.0' }, { name: 'ignored' }, { name: 'v4.24.0' }]);
    expect(await listLeanVersions({ fetchImpl })).toHaveLength(3);
    expect(calls).toBe(1);
  });

  it('serves the stale cache when GitHub fails', async () => {
    await listLeanVersions({ fetchImpl: fakeFetch(200, [{ tag_name: 'v4.25.0' }]), cacheTtlMs: 0 });
    const failing = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await listLeanVersions({ fetchImpl: failing, cacheTtlMs: 0 })).toEqual([{ name: 'v4.25.0' }]);
  });

  it('falls back to installed toolchains plus the static list offline', async () => {
    const tags = await listLeanVersions({ fetchImpl: fakeFetch(503, {}), installed: async () => [{ name: 'v4.33.1' }, { name: 'v4.25.0' }] });
    expect(tags[0]).toEqual({ name: 'v4.33.1' });
    expect(tags.filter((tag) => tag.name === 'v4.25.0')).toHaveLength(1);
    expect(tags.length).toBe(FALLBACK_LEAN_VERSIONS.length + 1);
  });

  it('parses elan toolchain list output', async () => {
    const tags = await installedLeanVersions(async () => ({ exitCode: 0, output: 'leanprover/lean4:v4.25.0\nleanprover/lean4:stable\nleanprover/lean4:v4.32.0-rc1 (default)\nleanprover/lean4-nightly:nightly-2025-05-22\n' }));
    expect(tags).toEqual([{ name: 'v4.25.0' }, { name: 'v4.32.0-rc1' }]);
    expect(await installedLeanVersions(async () => ({ exitCode: 1, output: '' }))).toEqual([]);
  });
});
