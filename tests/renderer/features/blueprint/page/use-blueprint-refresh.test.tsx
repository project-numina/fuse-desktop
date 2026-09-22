import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchBlueprint: vi.fn(),
  eventOptions: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/api', () => ({ fetchBlueprint: mocks.fetchBlueprint }));
vi.mock('@/features/blueprint/hooks/use-collaboration', () => ({
  useCollaboration: () => ({ connected: false, synced: false }),
}));
vi.mock('@/features/blueprint/hooks/events', () => ({
  useBlueprintEvents: (options: Record<string, unknown>) => {
    mocks.eventOptions = options;
    return { buildErrors: {}, ocrStatus: null, applyOcrPhase: vi.fn() };
  },
}));

import { useBlueprintRefresh } from '@/features/blueprint/page/use-blueprint-refresh';

it('refreshes the blueprint and exposes branch event callbacks', async () => {
  const next = { id: 'fermat', name: 'Updated' };
  mocks.fetchBlueprint.mockResolvedValue(next);
  const setBlueprint = vi.fn();
  const loader = {
    blueprint: null,
    blueprintRef: { current: null },
    setBlueprint,
    runtimeTag: null,
  } as never;
  const editing = {
    pendingSave: false,
    pendingSaveRef: { current: false },
    refreshAfterPendingSaveRef: { current: false },
    syncSourceFromActiveChapter: vi.fn(async () => true),
    markBlueprintSynced: vi.fn(),
    initializeBlueprint: vi.fn(),
  };
  const { result } = renderHook(() => useBlueprintRefresh({
    route: { owner: 'acme', repo: 'mathlib', blueprintId: 'fermat' },
    loader,
    modeRouting: { modeRef: { current: 'home' } } as never,
    editing: editing as never,
    files: { loadOpenFile: vi.fn() } as never,
    sources: { loadSources: vi.fn(), selectedSourceIdRef: { current: '' } } as never,
  }));

  await act(async () => result.current.refreshBlueprintContent());
  expect(mocks.fetchBlueprint).toHaveBeenCalledWith('acme', 'mathlib', 'fermat');
  expect(setBlueprint).toHaveBeenCalledWith(next);
  expect(editing.markBlueprintSynced).toHaveBeenCalled();

  const callbacks = mocks.eventOptions?.callbacks as {
    onBranchStatus: (status: unknown) => void;
  };
  act(() => callbacks.onBranchStatus({ ahead: 1 }));
  expect(setBlueprint).toHaveBeenLastCalledWith(expect.any(Function));
});
