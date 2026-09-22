import { act, render, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchBlueprint = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({ fetchBlueprint }));

import {
  resetBlueprintPageState,
  useBlueprintPage,
} from '@/features/blueprint/state/blueprint-page';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  act(() => resetBlueprintPageState());
});

describe('useBlueprintPage', () => {
  it('starts empty and exposes a stable load action', () => {
    const { result, rerender } = renderHook(() => useBlueprintPage());
    const initialLoad = result.current.load;

    expect(result.current.state).toEqual({ blueprint: null, error: null });
    rerender();
    expect(result.current.load).toBe(initialLoad);
  });

  it('publishes a successful blueprint response to every subscriber', async () => {
    const payload = { id: 'fermat', name: 'Fermat theorem' };
    fetchBlueprint.mockResolvedValueOnce(payload);
    const first = renderHook(() => useBlueprintPage());
    const second = renderHook(() => useBlueprintPage());

    await act(async () => {
      await first.result.current.load('acme', 'mathlib', 'fermat');
    });

    expect(fetchBlueprint).toHaveBeenCalledWith('acme', 'mathlib', 'fermat');
    expect(first.result.current.state).toEqual({ blueprint: payload, error: null });
    expect(second.result.current.state).toEqual({ blueprint: payload, error: null });
  });

  it('clears the previous result synchronously while a new load is pending', async () => {
    fetchBlueprint.mockResolvedValueOnce({ id: 'first' });
    const { result } = renderHook(() => useBlueprintPage());
    await act(async () => {
      await result.current.load('acme', 'mathlib', 'first');
    });
    expect(result.current.state.blueprint).toEqual({ id: 'first' });

    const pending = deferred<{ id: string }>();
    fetchBlueprint.mockReturnValueOnce(pending.promise);
    let loadPromise!: Promise<void>;
    act(() => {
      loadPromise = result.current.load('acme', 'mathlib', 'second');
    });

    expect(result.current.state).toEqual({ blueprint: null, error: null });

    pending.resolve({ id: 'second' });
    await act(async () => loadPromise);
    expect(result.current.state).toEqual({ blueprint: { id: 'second' }, error: null });
  });

  it.each([
    [new Error('Backend unavailable'), 'Backend unavailable'],
    ['Workspace missing', 'Workspace missing'],
    [{ status: 500 }, 'Failed to load blueprint.'],
    ['', 'Failed to load blueprint.'],
  ])('normalizes a rejected load into a user-facing error', async (failure, message) => {
    fetchBlueprint.mockRejectedValueOnce(failure);
    const { result } = renderHook(() => useBlueprintPage());

    await act(async () => {
      await result.current.load('acme', 'mathlib', 'fermat');
    });

    expect(result.current.state).toEqual({ blueprint: null, error: message });
  });

  it('resets loaded and errored state imperatively', async () => {
    fetchBlueprint.mockRejectedValueOnce(new Error('No clone'));
    const { result } = renderHook(() => useBlueprintPage());
    await act(async () => {
      await result.current.load('acme', 'mathlib', 'fermat');
    });
    expect(result.current.state.error).toBe('No clone');

    act(() => resetBlueprintPageState());

    expect(result.current.state).toEqual({ blueprint: null, error: null });
  });

  it('unsubscribes a consumer when it unmounts', async () => {
    const observed = vi.fn();
    let load!: ReturnType<typeof useBlueprintPage>['load'];

    function Consumer() {
      const page = useBlueprintPage();
      load = page.load;
      observed(page.state);
      return null;
    }

    const view = render(<Consumer />);
    const rendersBeforeUnmount = observed.mock.calls.length;
    view.unmount();
    fetchBlueprint.mockResolvedValueOnce({ id: 'after-unmount' });

    await act(async () => {
      await load('acme', 'mathlib', 'after-unmount');
    });

    expect(observed).toHaveBeenCalledTimes(rendersBeforeUnmount);
  });
});
