/**
 * Repository page store. Prefetches repository data before navigation.
 *
 * becomes a module-level immutable store exposed to React via
 * `useSyncExternalStore` (matching `state/dashboard.tsx`). `resetRepositoryPageState`
 * is the imperative reset the auth provider calls on user change / sign-out.
 */

import { useSyncExternalStore } from 'react';
import { fetchRepository, fetchBlueprints, fetchPullRequests } from '@/lib/api';
import { getDashboardRepository } from '@/state/dashboard';

function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}

export interface RepositoryPageRepository {
  id: number;
  owner: string;
  name: string;
  description?: string | null;
  updated_at?: string | null;
  visibility: string;
  /** Absolute folder path when the backend includes it. */
  path?: string | null;
}

interface RepositoryPageState {
  repository: RepositoryPageRepository | null;
  blueprints: unknown[];
  pullRequests: unknown[];
  error: string | null;
}

let state: RepositoryPageState = {
  repository: null,
  blueprints: [],
  pullRequests: [],
  error: null,
};
let loadedRepositoryKey: string | null = null;
let inFlightLoad: { key: string; promise: Promise<void> } | null = null;
let loadGeneration = 0;

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

function getSnapshot(): RepositoryPageState {
  return state;
}

/** Clears the repository page store (called on user change / sign-out). */
export function resetRepositoryPageState(): void {
  loadGeneration += 1;
  loadedRepositoryKey = null;
  inFlightLoad = null;
  state = { repository: null, blueprints: [], pullRequests: [], error: null };
  emitChange();
}

/**
 * Fetches repository, blueprints, and PRs. Called by the route loader before
 * navigation.
 */
export async function loadRepositoryPage(
  owner: string,
  repo: string,
  options: { force?: boolean } = {},
): Promise<void> {
  const key = `${owner}/${repo}`;
  if (!options.force && loadedRepositoryKey === key && state.repository && !state.error) {
    return;
  }
  if (!options.force && inFlightLoad?.key === key) return inFlightLoad.promise;

  const generation = ++loadGeneration;
  loadedRepositoryKey = null;
  state = { repository: null, blueprints: [], pullRequests: [], error: null };
  emitChange();

  const promise = (async () => {
    try {
      const dashboardRepository = options.force
        ? null
        : getDashboardRepository(owner, repo);
      const [repositoryData, blueprintData, pullRequestData] = await Promise.all([
        dashboardRepository ?? fetchRepository(owner, repo),
        fetchBlueprints(owner, repo),
        fetchPullRequests(owner, repo),
      ]);
      if (generation !== loadGeneration) return;
      loadedRepositoryKey = key;
      state = {
        repository: repositoryData as RepositoryPageRepository,
        blueprints: blueprintData as unknown[],
        pullRequests: pullRequestData as unknown[],
        error: null,
      };
      emitChange();
    } catch (fetchError) {
      if (generation !== loadGeneration) return;
      state = { ...state, error: errorMessage(fetchError, 'Failed to load repository.') };
      emitChange();
    } finally {
      if (inFlightLoad?.key === key && generation === loadGeneration) {
        inFlightLoad = null;
      }
    }
  })();
  inFlightLoad = { key, promise };
  return promise;
}

/**
 * React surface. `state` is reactive; `load` is a stable module-level function.
 */
export function useRepositoryPage() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { state: snapshot, load: loadRepositoryPage };
}
