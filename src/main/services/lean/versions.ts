/**
 * The Lean release list behind the New Project version picker: GitHub's
 * release tags, cached for an hour, with the toolchains elan already has
 * installed (plus a short static list) as the offline fallback.
 */

import type { Lean4Tag } from '@shared/api-types';
import { elanHome, leanProcessEnv, runToolCollect } from './process';
import { DEFAULT_LEAN_SETTINGS } from './settings';

const LEAN4_RELEASES_URL = 'https://api.github.com/repos/leanprover/lean4/releases?per_page=100';
const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Known releases so the picker is never empty on a fresh offline machine. */
export const FALLBACK_LEAN_VERSIONS: Lean4Tag[] = ['v4.25.0', 'v4.24.0', 'v4.23.0', 'v4.22.0', 'v4.21.0', 'v4.20.0'].map((name) => ({ name }));

let cache: { tags: Lean4Tag[]; fetchedAt: number } | null = null;

export function resetLeanVersionCache(): void {
  cache = null;
}

function parseReleases(payload: unknown): Lean4Tag[] {
  if (!Array.isArray(payload)) return [];
  const tags: Lean4Tag[] = [];
  for (const entry of payload) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const name = typeof record.tag_name === 'string' ? record.tag_name : typeof record.name === 'string' ? record.name : null;
    if (name) tags.push({ name });
  }
  return tags;
}

/** `elan toolchain list` → the `vX.Y.Z` tags of installed leanprover/lean4 toolchains. */
export async function installedLeanVersions(runElan?: (args: string[]) => Promise<{ exitCode: number | null; output: string }>): Promise<Lean4Tag[]> {
  const run =
    runElan
    ?? ((args: string[]) => runToolCollect('elan', args, { cwd: elanHome(), env: leanProcessEnv(DEFAULT_LEAN_SETTINGS), timeoutMs: REQUEST_TIMEOUT_MS }));
  try {
    const { exitCode, output } = await run(['toolchain', 'list']);
    if (exitCode !== 0) return [];
    const names = new Set<string>();
    for (const line of output.split(/\r?\n/)) {
      const match = /^leanprover\/lean4:(v\d+\.\d+\.\d+(?:-rc\d+)?)/.exec(line.trim());
      if (match) names.add(match[1]);
    }
    return [...names].map((name) => ({ name }));
  } catch {
    return [];
  }
}

function compareVersionsDesc(a: Lean4Tag, b: Lean4Tag): number {
  const parse = (name: string): number[] => {
    const match = /^v(\d+)\.(\d+)\.(\d+)(?:-rc(\d+))?/.exec(name);
    if (!match) return [0, 0, 0, 0];
    // A final release sorts above its release candidates.
    return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ? Number(match[4]) : Number.MAX_SAFE_INTEGER];
  };
  const [pa, pb] = [parse(a.name), parse(b.name)];
  for (let i = 0; i < 4; i += 1) {
    if (pa[i] !== pb[i]) return pb[i] - pa[i];
  }
  return 0;
}

export interface ListLeanVersionsOptions {
  fetchImpl?: typeof fetch;
  cacheTtlMs?: number;
  installed?: () => Promise<Lean4Tag[]>;
  now?: () => number;
}

/** GitHub releases (cached 1 h) → stale cache → installed toolchains + static list. */
export async function listLeanVersions(options: ListLeanVersionsOptions = {}): Promise<Lean4Tag[]> {
  const now = options.now ?? (() => Date.now());
  const ttl = options.cacheTtlMs ?? CACHE_TTL_MS;
  if (cache && now() - cache.fetchedAt < ttl) return cache.tags;
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(LEAN4_RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'fuse-desktop' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) {
      const tags = parseReleases(await response.json());
      if (tags.length) {
        cache = { tags, fetchedAt: now() };
        return tags;
      }
    } else {
      console.warn(`[lean] GitHub returned ${response.status} when listing Lean releases`);
    }
  } catch (error) {
    console.warn(`[lean] could not reach GitHub to list Lean releases: ${(error as Error).message}`);
  }
  if (cache) return cache.tags;
  const installed = await (options.installed ?? installedLeanVersions)();
  const merged = new Map<string, Lean4Tag>();
  for (const tag of [...installed, ...FALLBACK_LEAN_VERSIONS]) merged.set(tag.name, tag);
  return [...merged.values()].sort(compareVersionsDesc);
}
