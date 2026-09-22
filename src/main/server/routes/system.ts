/**
 * `/api/*` system routes: health, the maintenance banner (never shown),
 * push configuration (disabled) and the Lean release list used by the
 * "New project" version picker.
 */

import { Hono } from 'hono';
import type { DeploymentStatus, Lean4Tag } from '@shared/api-types';
import type { AppContext } from '../context';
import { PUSH_CONFIG } from './auth';

export const IDLE_DEPLOYMENT: DeploymentStatus = {
  phase: 'idle',
  show_banner: false,
  pending_ref: null,
  active_agent_jobs: 0,
  stale_after_minutes: 0,
  next_force_window_at: null,
  force_window_ends_at: null,
  force_restart_policy: null,
  message: null,
};

const LEAN_TAGS_URL = 'https://api.github.com/repos/leanprover/lean4/tags?per_page=100';
const LEAN_TAGS_TTL_MS = 3600_000;

let leanTagsCache: { at: number; tags: Lean4Tag[] } | null = null;

/**
 * Lean release tags from GitHub (public, unauthenticated), cached for an
 * hour; stale cache or ``[]`` when offline so the picker falls back to the
 * Mathlib default.
 */
export async function fetchLean4Tags(fetchImpl: typeof fetch = fetch): Promise<Lean4Tag[]> {
  if (leanTagsCache && Date.now() - leanTagsCache.at < LEAN_TAGS_TTL_MS) return leanTagsCache.tags;
  try {
    const response = await fetchImpl(LEAN_TAGS_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return leanTagsCache?.tags ?? [];
    const payload = (await response.json()) as unknown;
    const tags: Lean4Tag[] = Array.isArray(payload)
      ? payload.filter((entry): entry is { name: string } => typeof (entry as { name?: unknown })?.name === 'string').map((entry) => ({ name: entry.name }))
      : [];
    leanTagsCache = { at: Date.now(), tags };
    return tags;
  } catch {
    return leanTagsCache?.tags ?? [];
  }
}

export function systemRoutes(ctx: AppContext): Hono {
  const app = new Hono();
  app.get('/health', (c) => c.json({ status: 'ok', repositories: ctx.registry.listRepositories().length }));
  app.get('/deployment/status', (c) => c.json(IDLE_DEPLOYMENT));
  app.get('/push/config', (c) => c.json(PUSH_CONFIG));
  app.get('/lean-versions', async (c) => c.json(await fetchLean4Tags()));
  return app;
}
