import { beforeEach, describe, expect, it, vi } from 'vitest';
const request = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/core', () => ({ request }));
import { fetchLean4Tags } from '@/lib/api/system';

describe('system API paths', () => {
  beforeEach(() => request.mockReset().mockResolvedValue([]));
  it('loads the Lean-version list', async () => {
    await fetchLean4Tags();
    expect(request.mock.calls).toEqual([['/lean-versions']]);
  });
});
