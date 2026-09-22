/**
 * Dashboard store. Prefetches the repository list before navigation and layers
 * weekly commit activity in from a background fetch.
 *
 * becomes a module-level immutable store exposed to React via
 * `useSyncExternalStore` (matching `state/app-error.tsx`). `resetDashboardState`
 * is the imperative reset the auth provider calls on user change / sign-out.
 *
 * that is the entirety of `stores/dashboard.ts`. The authenticated home view
 */

import { useSyncExternalStore } from 'react';
import {
  fetchRepositories,
  fetchRepositoryActivity,
  fetchRepositoryBackgroundSessions,
} from '@/lib/api';

function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}

export interface Repository {
  background_sessions: Array<{
    id: string;
    blueprint_name: string;
    title?: string | null;
    tier: 'active' | 'waiting_for_review' | 'completed';
    updated_at?: string | null;
    background_updates: string[];
    roadblocks: string[];
  }>;
  id: number;
  owner: string;
  name: string;
  description?: string | null;
  updated_at?: string | null;
  visibility: string;
  weekly_commits: number[];
  /**
   * Absolute folder path. Optional: the list validator does not require it,
   * so the dashboard works whether or not the local backend includes it.
   */
  path?: string | null;
}

export type DashboardRepositoryMetadata = Pick<
  Repository,
  'id' | 'owner' | 'name' | 'description' | 'updated_at' | 'visibility' | 'path'
>;

interface RepositoryListPayload {
  repositories: Repository[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function isBackgroundSession(
  value: unknown,
): value is Repository['background_sessions'][number] {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.blueprint_name === 'string'
    && isNullableString(value.title)
    && (value.tier === 'active'
      || value.tier === 'waiting_for_review'
      || value.tier === 'completed')
    && isNullableString(value.updated_at)
    && Array.isArray(value.background_updates)
    && value.background_updates.every((entry) => typeof entry === 'string')
    && Array.isArray(value.roadblocks)
    && value.roadblocks.every((entry) => typeof entry === 'string');
}

function isRepository(value: unknown): value is Repository {
  if (!isRecord(value)) return false;
  return typeof value.id === 'number'
    && typeof value.owner === 'string'
    && typeof value.name === 'string'
    && isNullableString(value.description)
    && isNullableString(value.updated_at)
    && isNullableString(value.path)
    && (value.visibility === 'public' || value.visibility === 'private')
    && Array.isArray(value.weekly_commits)
    && value.weekly_commits.every((count) => Number.isInteger(count) && count >= 0)
    && Array.isArray(value.background_sessions)
    && value.background_sessions.every(isBackgroundSession);
}

function parseRepositoryList(value: unknown): RepositoryListPayload | null {
  if (!isRecord(value) || !Array.isArray(value.repositories)) return null;
  return value.repositories.every(isRepository)
    ? { repositories: value.repositories }
    : null;
}

function parseRepositoryActivity(value: unknown): Repository[] | null {
  return Array.isArray(value) && value.every(isRepository) ? value : null;
}

function parseBackgroundSessions(
  value: unknown,
): Record<string, Repository['background_sessions']> | null {
  if (!isRecord(value)) return null;
  for (const sessions of Object.values(value)) {
    if (!Array.isArray(sessions) || !sessions.every(isBackgroundSession)) return null;
  }
  return value as Record<string, Repository['background_sessions']>;
}

interface DashboardState {
  repositories: Repository[];
  error: string | null;
  loading: boolean;
}

const REPOSITORY_LIST_FRESHNESS_MS = 30_000;

let state: DashboardState = {
  repositories: [],
  error: null,
  loading: true,
};
let loadInFlight: Promise<void> | null = null;
let activityLoadInFlight: Promise<void> | null = null;
let backgroundRefreshInFlight: Promise<void> | null = null;
let hasLoaded = false;
let hasLoadedActivity = false;
let repositoryListLoadedAt = 0;
let repositoryListVersion = 0;
let stateGeneration = 0;

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

function getSnapshot(): DashboardState {
  return state;
}

function setState(patch: Partial<DashboardState>): void {
  state = { ...state, ...patch };
  emitChange();
}

/** Clears the dashboard store (called on user change / sign-out). */
export function resetDashboardState(): void {
  stateGeneration += 1;
  loadInFlight = null;
  activityLoadInFlight = null;
  backgroundRefreshInFlight = null;
  hasLoaded = false;
  hasLoadedActivity = false;
  repositoryListLoadedAt = 0;
  repositoryListVersion = 0;
  state = { repositories: [], error: null, loading: true };
  emitChange();
}

/**
 * Return only metadata guaranteed by the initial dashboard list response.
 * Activity and background-session fields are intentionally excluded because
 * their best-effort background refresh may not have completed before a click.
 */
export function getDashboardRepository(
  owner: string,
  repository: string,
): DashboardRepositoryMetadata | null {
  const normalizedOwner = owner.toLowerCase();
  const normalizedRepository = repository.toLowerCase();
  const candidate = state.repositories.find(
    (candidate) =>
      candidate.owner.toLowerCase() === normalizedOwner &&
      candidate.name.toLowerCase() === normalizedRepository,
  );
  if (!candidate) return null;
  const { id, name, description, updated_at, visibility, path } = candidate;
  return { id, owner: candidate.owner, name, description, updated_at, visibility, path };
}

/**
 * Fetches the repository list with a short in-memory freshness window.
 * Returning to the dashboard paints fresh cached data immediately; once stale,
 * it refreshes without putting the visible list back into a loading state.
 * Auth changes call resetDashboardState. The backend returns every registered
 * folder (lakefile discovery is deferred to workspace creation).
 */
function load(options: { force?: boolean } = {}): Promise<void> {
  if (loadInFlight) {
    return options.force
      ? loadInFlight.then(() => load(options))
      : loadInFlight;
  }
  if (
    !options.force &&
    hasLoaded
    && Date.now() - repositoryListLoadedAt < REPOSITORY_LIST_FRESHNESS_MS
  ) {
    return Promise.resolve();
  }
  const generation = stateGeneration;
  const isInitialLoad = !hasLoaded;
  if (isInitialLoad) setState({ loading: true });
  loadInFlight = (async () => {
    try {
      const payload = parseRepositoryList(await fetchRepositories());
      if (!payload) throw new Error('Invalid repository list response.');
      if (generation !== stateGeneration) return;
      hasLoaded = true;
      hasLoadedActivity = false;
      repositoryListVersion += 1;
      repositoryListLoadedAt = Date.now();
      const previousRepositoriesById = new Map(
        state.repositories.map((repository) => [repository.id, repository]),
      );
      const repositories = payload.repositories.map((repository) => {
        const previous = previousRepositoriesById.get(repository.id);
        return previous
          ? {
              ...repository,
              weekly_commits: previous.weekly_commits,
              background_sessions: previous.background_sessions,
            }
          : repository;
      });
      setState({ repositories, error: null, loading: false });
    } catch (fetchError) {
      if (generation !== stateGeneration) return;
      if (!isInitialLoad) return;
      setState({
        error: errorMessage(fetchError, 'Failed to load repositories.'),
        loading: false,
      });
    } finally {
      if (generation === stateGeneration) loadInFlight = null;
    }
  })();
  return loadInFlight;
}

/** Fetches weekly commit activity in the background and updates the store. */
function loadActivityInBackground(): void {
  if (activityLoadInFlight || hasLoadedActivity) return;
  const generation = stateGeneration;
  const repositoryVersion = repositoryListVersion;
  activityLoadInFlight = fetchRepositoryActivity()
    .then((activityData) => {
      // A logout/user change resets this module-level store. Never let a
      // request started for the previous account decorate the next account's
      // repository rows after that reset.
      if (generation !== stateGeneration || repositoryVersion !== repositoryListVersion) return;
      const activityRepositories = parseRepositoryActivity(activityData);
      if (!activityRepositories) return;
      hasLoadedActivity = true;
      const activityByIdentifier: Record<number, number[]> = {};
      for (const repository of activityRepositories) {
        activityByIdentifier[repository.id] = repository.weekly_commits;
      }
      const nextRepositories = state.repositories.map((repository) => {
        const weeklyCommits = activityByIdentifier[repository.id];
        return weeklyCommits ? { ...repository, weekly_commits: weeklyCommits } : repository;
      });
      setState({ repositories: nextRepositories });
    })
    .catch(() => {
      // Activity is best-effort; swallow errors silently.
    })
    .finally(() => {
      if (generation !== stateGeneration) return;
      activityLoadInFlight = null;
      // A list refresh may have arrived while this activity request was running.
      if (repositoryVersion !== repositoryListVersion) loadActivityInBackground();
    });
}

/** Refresh active background cards without replacing the visible repository list. */
function refreshBackgroundSessions(): Promise<void> {
  if (backgroundRefreshInFlight) return backgroundRefreshInFlight;
  const generation = stateGeneration;
  backgroundRefreshInFlight = (async () => {
    try {
      const payload = parseBackgroundSessions(
        await fetchRepositoryBackgroundSessions(),
      );
      if (!payload) return;
      if (generation !== stateGeneration) return;
      setState({
        repositories: state.repositories.map((repository) => ({
          ...repository,
          background_sessions:
            payload[`${repository.owner}/${repository.name}`] ?? [],
        })),
      });
    } catch {
      // Polling is best-effort; retain the last cards and keep the page usable.
    } finally {
      if (generation === stateGeneration) backgroundRefreshInFlight = null;
    }
  })();
  return backgroundRefreshInFlight;
}

/**
 * Imperative refresh for callers outside React — the desktop shell registers
 * folders from the native menu and a window drop, and the list must pick the
 * new row up even when no dashboard is mounted to call `load` itself.
 */
export function reloadDashboardRepositories(): Promise<void> {
  return load({ force: true });
}

/**
 * React surface. `state` is reactive; `load` and `loadActivityInBackground`
 * are stable module-level functions.
 */
export function useDashboard() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { state: snapshot, load, loadActivityInBackground, refreshBackgroundSessions };
}
