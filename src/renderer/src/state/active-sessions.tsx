/**
 * Active sessions store. Powers the Active sessions page, which lists the
 * current user's live sessions and lets them cancel ones from other
 * tabs/blueprints when they hit the per-user session cap.
 *
 * becomes a module-level immutable store exposed to React via
 * `useSyncExternalStore` (matching `state/app-error.tsx`), so the same state is
 * shared across every subscriber. `cancelRequestedIds` tracks sessions the user
 * has already pressed Cancel on so we can show a "Cancel requested…" state until
 * the next refresh confirms the session has left the active list.
 */

import { useSyncExternalStore } from 'react';
import {
  ApiError,
  cancelSession as cancelSessionRequest,
  fetchActiveSessions,
  type ActiveSessionSummary,
} from '@/lib/api';

function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}

type ActiveSessionsReason = 'manual' | 'cap_hit';

interface ActiveSessionsState {
  loading: boolean;
  sessions: ActiveSessionSummary[];
  activeCount: number;
  maxActive: number;
  error: string | null;
  cancelRequestedIds: Set<string>;
  reason: ActiveSessionsReason;
}

let state: ActiveSessionsState = {
  loading: false,
  sessions: [],
  activeCount: 0,
  maxActive: 0,
  error: null,
  cancelRequestedIds: new Set<string>(),
  reason: 'manual',
};

const listeners = new Set<() => void>();

function emitChange(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ActiveSessionsState {
  return state;
}

function setState(patch: Partial<ActiveSessionsState>): void {
  state = { ...state, ...patch };
  emitChange();
}

/**
 * Clears the active-sessions store back to its initial state. Called by the
 * auth provider on user change / sign-out so a shared browser never shows the
 * previous user's sessions.
 */
export function resetActiveSessionsState(): void {
  state = {
    loading: false,
    sessions: [],
    activeCount: 0,
    maxActive: 0,
    error: null,
    cancelRequestedIds: new Set<string>(),
    reason: 'manual',
  };
  emitChange();
}

async function refresh(): Promise<void> {
  setState({ loading: true, error: null });
  try {
    const response = await fetchActiveSessions();
    const stillPresent = new Set(
      response.sessions.map((entry) => entry.session_id),
    );
    const nextRequested = new Set<string>();
    for (const id of state.cancelRequestedIds) {
      if (stillPresent.has(id)) nextRequested.add(id);
    }
    setState({
      sessions: response.sessions,
      activeCount: response.active_count,
      maxActive: response.max_active_sessions,
      cancelRequestedIds: nextRequested,
    });
  } catch (error) {
    setState({ error: errorMessage(error, 'Could not load active sessions.') });
  } finally {
    setState({ loading: false });
  }
}

/** Records why the page is being shown (manual visit vs. cap-hit redirect). */
function setReason(reason: ActiveSessionsReason): void {
  setState({ reason });
}

async function cancelOne(sessionId: string): Promise<void> {
  const requested = new Set(state.cancelRequestedIds);
  requested.add(sessionId);
  setState({ cancelRequestedIds: requested, error: null });
  try {
    await cancelSessionRequest(sessionId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      // Already gone; refresh will drop it from the list.
    } else {
      const rollback = new Set(state.cancelRequestedIds);
      rollback.delete(sessionId);
      setState({
        cancelRequestedIds: rollback,
        error: errorMessage(error, 'Could not cancel that session.'),
      });
      return;
    }
  }
  await refresh();
}

/**
 * React surface. `state` is reactive; `setReason`, `refresh`, and `cancelOne`
 * are stable module-level functions.
 */
export function useActiveSessions() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { state: snapshot, setReason, refresh, cancelOne };
}
