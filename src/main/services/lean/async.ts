/**
 * Small async primitives the Lean modules share: a FIFO mutex, sleeps that
 * honour AbortSignals, and the AbortError shape the frontend's fetch
 * abort produces (so both ends agree on what "cancelled" looks like).
 */

export class AbortError extends Error {
  constructor(message = 'The operation was aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AbortError();
}

/** FIFO mutex. `withLock` runs `fn` once every earlier holder has released. */
export class AsyncLock {
  private tail: Promise<void> = Promise.resolve();
  private holders = 0;

  get locked(): boolean {
    return this.holders > 0;
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    if (signal) {
      let onAbort: (() => void) | null = null;
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(new AbortError());
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      });
      try {
        await Promise.race([previous, aborted]);
      } catch (error) {
        // Keep the chain intact: our slot must pass through once the
        // previous holder releases, or every later waiter would hang.
        void previous.then(release);
        throw error;
      } finally {
        if (onAbort) signal.removeEventListener('abort', onAbort);
      }
    } else {
      await previous;
    }
    this.holders += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holders -= 1;
      release();
    };
  }

  async withLock<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/** Counting semaphore; a limit of 0 or less means unbounded. */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.limit <= 0) return () => {};
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.waiters.shift()?.();
    };
  }
}

/** Resolves after `ms`; rejects with AbortError if the signal fires first. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new AbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** A promise plus its resolvers, for event-style waiting. */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Format seconds the way Python's `:g` does (`120`, `0.25`, `1.5`). */
export function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  if (Number.isInteger(seconds)) return String(seconds);
  return String(Number.parseFloat(seconds.toPrecision(6)));
}
