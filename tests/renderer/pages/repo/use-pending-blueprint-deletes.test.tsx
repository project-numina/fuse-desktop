import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ deleteBlueprint: vi.fn() }));
vi.mock('@/lib/api', () => api);

import { usePendingBlueprintDeletes } from '@/pages/repo/use-pending-blueprint-deletes';

describe('usePendingBlueprintDeletes', () => {
  beforeEach(() => {
    sessionStorage.clear();
    api.deleteBlueprint.mockReset();
    api.deleteBlueprint.mockResolvedValue(null);
  });
  afterEach(() => vi.restoreAllMocks());

  it('persists staged deletes and flushes them with keepalive', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    const { result } = renderHook(() => usePendingBlueprintDeletes({
      owner: 'numina team',
      repository: 'fuse',
      reload: vi.fn(async () => {}),
    }));

    act(() => result.current.requestDelete('bp/1'));
    expect(result.current.pendingDeletes).toEqual(new Set(['bp/1']));
    act(() => result.current.flushCurrent());

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/repositories/numina%20team/fuse/blueprints/bp%2F1',
      { method: 'DELETE', credentials: 'include', keepalive: true },
    );
    expect(sessionStorage.getItem('pendingBlueprintDelete')).toBeNull();
  });

  it('removes an undone delete from the persisted set', () => {
    const { result } = renderHook(() => usePendingBlueprintDeletes({
      owner: 'numina',
      repository: 'fuse',
      reload: vi.fn(async () => {}),
    }));

    act(() => result.current.requestDelete('bp-1'));
    act(() => result.current.undoDelete('bp-1'));

    expect(result.current.pendingDeletes.size).toBe(0);
    expect(sessionStorage.getItem('pendingBlueprintDelete')).toBeNull();
  });

  it('recovers persisted deletes and reports failures after reloading', async () => {
    sessionStorage.setItem('pendingBlueprintDelete', JSON.stringify({
      owner: 'numina',
      repo: 'fuse',
      ids: ['bp-1'],
    }));
    api.deleteBlueprint.mockRejectedValueOnce(new Error('offline'));
    const reload = vi.fn(async () => {});
    const { result } = renderHook(() => usePendingBlueprintDeletes({
      owner: 'numina',
      repository: 'fuse',
      reload,
    }));

    await waitFor(() => expect(result.current.recoveringDeletes.size).toBe(0));
    expect(api.deleteBlueprint).toHaveBeenCalledWith('numina', 'fuse', 'bp-1');
    expect(reload).toHaveBeenCalledWith('numina', 'fuse', { force: true });
    expect(result.current.deleteError)
      .toBe('Could not delete pending blueprints. Try again from the list.');
  });
});
