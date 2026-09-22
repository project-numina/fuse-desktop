import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { disablePushNotifications, usePushNotifications } from '@/hooks/use-push-notifications';

describe('usePushNotifications (desktop stub)', () => {
  it('reports push as unsupported and unavailable so toggles stay hidden', async () => {
    const { result } = renderHook(() => usePushNotifications());
    expect(result.current.supported).toBe(false);
    expect(result.current.state).toEqual({
      permission: 'unsupported',
      available: false,
      subscribed: false,
      loaded: true,
      busy: false,
      error: null,
    });
    await act(() => result.current.refresh());
    expect(result.current.state.loaded).toBe(true);
  });

  it('never enables and never fails when disabling', async () => {
    const { result } = renderHook(() => usePushNotifications());
    await expect(result.current.enable()).resolves.toBe(false);
    await expect(result.current.disable()).resolves.toBeUndefined();
    await expect(disablePushNotifications()).resolves.toBeUndefined();
    expect(result.current.state.subscribed).toBe(false);
    expect(result.current.state.error).toBeNull();
  });
});
