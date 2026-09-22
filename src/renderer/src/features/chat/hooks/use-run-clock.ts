import { useSyncExternalStore } from 'react';

/**
 * One clock for every running agent in the transcript.
 *
 * A transcript can hold dozens of agent cards, so each one owning a
 * `setInterval` would mean dozens of timers redrawing dozens of cards a
 * second. There is a single interval here instead, started by the first card
 * that needs it and cleared once the last one settles or unmounts, and only
 * the cards subscribed to it re-render on a tick. Nothing running means no
 * timer at all, which is the steady state of a finished conversation.
 */

const TICK_INTERVAL_MS = 1000;

const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;
let tickedAt = Date.now();

function tick(): void {
  tickedAt = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (intervalId === null) {
    // The stored reading is as old as the last tick, so a clock restarted
    // after an idle stretch would hand its first subscriber a stale elapsed
    // time, and a negative one against a start stamped just now.
    tickedAt = Date.now();
    intervalId = setInterval(tick, TICK_INTERVAL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0 || intervalId === null) return;
    clearInterval(intervalId);
    intervalId = null;
  };
}

function subscribeIdle(): () => void {
  return () => {};
}

function getTick(): number {
  return tickedAt;
}

function getIdleTick(): number {
  return 0;
}

/**
 * Return a reading that advances about once a second while `running`.
 *
 * A component that is not running gets a constant and never re-renders for a
 * tick, so a settled card costs nothing once its duration stops moving.
 *
 * @param running Whether this caller still needs the clock.
 * @return {number} Epoch milliseconds of the latest tick, or `0` when idle.
 */
export function useRunClock(running: boolean): number {
  return useSyncExternalStore(
    running ? subscribe : subscribeIdle,
    running ? getTick : getIdleTick,
  );
}
