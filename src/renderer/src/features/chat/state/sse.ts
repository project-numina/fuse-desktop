/**
 * Server-Sent Events parsing helpers and stream timing constants for the
 * chat store.
 */

import { parseSseEventData } from '@/lib/sse';

// Re-exported for chat consumers alongside the shared implementation.
export { parseSseEventData };

export function objectPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export const EVENTSOURCE_RECONNECT_GRACE_MS = 5000;
export const CLOSED_STREAM_RECONNECT_INITIAL_MS = 500;
export const CLOSED_STREAM_RECONNECT_MAX_MS = 5000;
// Browsers cap concurrent HTTP/1.1 connections per origin (commonly 6) and
// every open SSE stream holds one for its whole lifetime. Hidden tabs
// therefore release their stream after a short debounce and ping the
// session keepalive endpoint instead; each ping grants a hidden-tab
// lease on the backend that outlasts throttled background timers.
export const HIDDEN_STREAM_DISCONNECT_DELAY_MS = 5000;
export const HIDDEN_SESSION_KEEPALIVE_INTERVAL_MS = 15000;
// Safety net for a visible tab whose stream silently died without the browser
// declaring it CLOSED — e.g. wedged in CONNECTING behind a stalled proxy, an
// OPEN connection a proxy is buffering, or a resume that a missed
// visibilitychange never triggered. The poller re-checks liveness on this
// cadence and rebuilds the stream when needed.
export const STREAM_LIVENESS_POLL_INTERVAL_MS = 10000;
// How long a visible stream may go without ANY activity (event or heartbeat)
// before the poller treats it as dead and forces a rebuild. The server sends a
// heartbeat every sse_heartbeat_interval (15s), so a healthy stream refreshes
// this well within the window; three missed heartbeats means it is gone.
export const STREAM_STALL_MS = 45000;
