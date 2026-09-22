import { describe, expect, it, vi } from 'vitest';

import { createInfoviewSaveMachine } from '@/features/blueprint/hooks/infoview/save-machine';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('infoview save machine', () => {
  it('serializes writes and does not restore a superseded failure', async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const save = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const machine = createInfoviewSaveMachine({
      save,
      refresh: vi.fn(),
      getCurrentFilePath: () => 'A.lean',
      onPendingChange: () => undefined,
      isDisposed: () => false,
    });

    machine.saveAndRefresh('older');
    const olderFlush = machine.flushPendingSave(false);
    machine.saveAndRefresh('newer');
    const newerFlush = machine.flushPendingSave(false);
    expect(save).toHaveBeenCalledTimes(1);

    first.reject(new Error('failed'));
    await expect(olderFlush).resolves.toBe(false);
    expect(save).toHaveBeenCalledTimes(2);
    second.resolve();
    await expect(newerFlush).resolves.toBe(true);
    expect(machine.getPendingSaveContent('A.lean')).toBeUndefined();
    expect(machine.flushPendingSave(false)).toBeNull();
  });

  it('keeps a failed latest write queued for retry', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('failed')).mockResolvedValue(undefined);
    const machine = createInfoviewSaveMachine({
      save,
      refresh: vi.fn(),
      getCurrentFilePath: () => 'A.lean',
      onPendingChange: () => undefined,
      isDisposed: () => false,
    });

    machine.saveAndRefresh('draft');
    await expect(machine.flushPendingSave(false)).resolves.toBe(false);
    expect(machine.getPendingSaveContent('A.lean')).toBe('draft');
    await expect(machine.flushPendingSave(false)).resolves.toBe(true);
    expect(machine.getPendingSaveContent('A.lean')).toBeUndefined();
  });
});
