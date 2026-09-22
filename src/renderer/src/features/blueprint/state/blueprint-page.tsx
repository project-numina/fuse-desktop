/**
 * Blueprint page store. Prefetches blueprint data before navigation.
 *
 * The module-level immutable store is exposed through `useSyncExternalStore`.
 * `resetBlueprintPageState` is the imperative reset used on user changes and
 * sign-out.
 */

import { useSyncExternalStore } from 'react';
import { fetchBlueprint } from '@/lib/api';

/** Convert an unknown failure into a user-facing message. */
function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}

interface BlueprintPageState {
  blueprint: unknown | null;
  error: string | null;
}

let state: BlueprintPageState = {
  blueprint: null,
  error: null,
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

function getSnapshot(): BlueprintPageState {
  return state;
}

/** Clears the blueprint page store (called on user change / sign-out). */
export function resetBlueprintPageState(): void {
  state = { blueprint: null, error: null };
  emitChange();
}

/**
 * Fetches blueprint data. Called by the route loader before navigation.
 */
async function load(owner: string, repo: string, blueprintId: string): Promise<void> {
  resetBlueprintPageState();
  try {
    const blueprint = await fetchBlueprint(owner, repo, blueprintId);
    state = { blueprint, error: null };
    emitChange();
  } catch (fetchError) {
    state = { ...state, error: errorMessage(fetchError, 'Failed to load blueprint.') };
    emitChange();
  }
}

/**
 * React surface. `state` is reactive; `load` is a stable module-level function.
 */
export function useBlueprintPage() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { state: snapshot, load };
}
