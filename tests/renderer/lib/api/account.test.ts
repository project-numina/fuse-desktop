import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/core', () => ({ request }));

import { fetchCurrentUser } from '@/lib/api/account';

describe('account API paths', () => {
  beforeEach(() => request.mockReset().mockResolvedValue({}));

  it('reads the local user from the auth endpoint', async () => {
    await fetchCurrentUser();
    expect(request.mock.calls).toEqual([['/auth/me']]);
  });
});
