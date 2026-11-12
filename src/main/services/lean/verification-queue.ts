import { AsyncLock, throwIfAborted } from './async';

/** Identical pending requests share work; newer file versions supersede queued work. */
export class VerificationQueue {
  private readonly lock = new AsyncLock();
  private readonly pending = new Map<string, Promise<unknown>>();

  exclusive<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.lock.withLock(work, signal);
  }

  run<T>(file: string, version: string, query: string, currentVersion: () => string, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    throwIfAborted(signal);
    const key = JSON.stringify([file, version, query]);
    // Cancellable callers own their request; cancelling one must not cancel another.
    const existing = !signal && this.pending.get(key);
    if (existing) return existing as Promise<T>;
    const result = this.lock.withLock(async () => {
      throwIfAborted(signal);
      if (currentVersion() !== version) {
        throw new Error('Lean verification request superseded by a newer file version; request diagnostics again.');
      }
      return work();
    }, signal);
    if (!signal) this.pending.set(key, result);
    void result.finally(() => {
      if (this.pending.get(key) === result) this.pending.delete(key);
    }).catch(() => {});
    return result;
  }
}
