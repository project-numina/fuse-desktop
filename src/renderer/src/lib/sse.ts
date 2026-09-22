/**
 * Shared Server-Sent Events primitives used by the chat store, the
 * blueprint event hook, and the blueprint page helpers.
 *
 * Holds the single ``parseSseEventData`` implementation (previously
 * duplicated byte-for-byte across modules) and ``makeBackoff``, the
 * exponential reconnect-delay schedule both SSE consumers reimplemented
 * with matching constants.
 */

/**
 * Parse the JSON body of an SSE ``MessageEvent``.
 *
 * Returns an empty object for an empty body (a bare event with no data),
 * the parsed object on success, and ``null`` when the body is malformed
 * or not a plain object — callers treat ``null`` as "ignore this event".
 */
export function parseSseEventData<
  T extends Record<string, unknown> = Record<string, unknown>,
>(event: Event): T | null {
  const rawData = (event as MessageEvent).data;
  if (!rawData) return {} as T;
  try {
    const parsed = JSON.parse(rawData) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

export interface BackoffOptions {
  /** Starting delay in milliseconds (also the value after ``reset()``). */
  initialMs: number;
  /** Upper bound the delay is clamped to as it grows. */
  maxMs: number;
  /** Growth factor applied after each ``next()`` call. Defaults to 2. */
  factor?: number;
}

export interface Backoff {
  /**
   * Returns the current delay (ms), then advances the internal delay
   * toward ``maxMs`` for the next call. The first call returns
   * ``initialMs``.
   */
  next(): number;
  /** Reads the current delay without advancing it. */
  peek(): number;
  /** Resets the schedule back to ``initialMs``. */
  reset(): void;
}

/**
 * Build an exponential-backoff schedule for SSE reconnect timing.
 *
 * Encapsulates the "start at ``initialMs``, double up to ``maxMs``,
 * reset on a clean connection" pattern shared by the chat and blueprint
 * event streams.
 */
export function makeBackoff(options: BackoffOptions): Backoff {
  const { initialMs, maxMs, factor = 2 } = options;
  let delayMs = initialMs;
  return {
    next(): number {
      const current = delayMs;
      delayMs = Math.min(delayMs * factor, maxMs);
      return current;
    },
    peek(): number {
      return delayMs;
    },
    reset(): void {
      delayMs = initialMs;
    },
  };
}
