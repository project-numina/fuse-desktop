/**
 * Aggregates for the dashboard and the blueprint page: 52-week commit
 * activity, and per-file Lean line counts introduced by the branch.
 */

import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import type { FileDiffStats } from '@shared/api-types';
import { tryGit } from './run';
import { hasHead } from './status';

export const WEEKLY_COMMIT_BUCKETS = 52;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Monday 00:00 UTC of the ISO week containing ``at``. */
export function isoWeekStart(at: Date): Date {
  const day = at.getUTCDay(); // 0 = Sunday
  const offset = day === 0 ? 6 : day - 1;
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() - offset));
}

/** Bucket unix timestamps (seconds) into 52 ISO-week counts, oldest first. */
export function bucketWeeklyCommits(timestamps: readonly number[], now = new Date()): number[] {
  const buckets = new Array<number>(WEEKLY_COMMIT_BUCKETS).fill(0);
  const currentWeekStart = isoWeekStart(now).getTime();
  for (const seconds of timestamps) {
    const at = seconds * 1000;
    const weeksAgo = at >= currentWeekStart ? 0 : Math.floor((currentWeekStart - at) / WEEK_MS) + 1;
    const index = WEEKLY_COMMIT_BUCKETS - 1 - weeksAgo;
    if (index >= 0 && index < WEEKLY_COMMIT_BUCKETS) buckets[index] += 1;
  }
  return buckets;
}

/** Commits on ``HEAD`` per ISO week over the last 52 weeks; ``[]`` for a non-repo. */
export async function weeklyCommits(cwd: string): Promise<number[]> {
  if (!(await hasHead(cwd))) return [];
  const output = await tryGit(['log', '--since=52.weeks', '--format=%ct'], { cwd });
  if (output === null) return [];
  const timestamps = output
    .split(/\r?\n/)
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((value) => Number.isFinite(value));
  return bucketWeeklyCommits(timestamps);
}

/**
 * The ref the branch's Lean changes are compared against: ``origin/HEAD``
 * (and its short name), then ``origin/main``, ``main``, ``origin/master``,
 * ``master`` — the first that resolves.
 */
export async function defaultCompareRef(cwd: string): Promise<string | null> {
  const candidates: string[] = [];
  const headRef = (await tryGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd }))?.trim();
  if (headRef) {
    candidates.push(headRef);
    const short = headRef.startsWith('origin/') ? headRef.slice('origin/'.length) : headRef;
    if (short && short !== headRef) candidates.push(short);
  }
  for (const fallback of ['origin/main', 'main', 'origin/master', 'master']) {
    if (!candidates.includes(fallback)) candidates.push(fallback);
  }
  for (const candidate of candidates) {
    if ((await tryGit(['rev-parse', '--verify', candidate], { cwd })) !== null) return candidate;
  }
  return null;
}

function includeInferredLeanFile(path: string): boolean {
  return path.endsWith('.lean') && !basename(path).toLowerCase().startsWith('scratch');
}

/** Parse ``git diff --numstat`` output for included Lean files. */
export function parseLeanNumstat(output: string): Record<string, FileDiffStats> {
  const stats: Record<string, FileDiffStats> = {};
  for (const line of output.split(/\r?\n/)) {
    const parts = line.split('\t');
    if (parts.length < 3 || parts[0] === '-' || parts[1] === '-') continue;
    const added = Number.parseInt(parts[0], 10);
    const deleted = Number.parseInt(parts[1], 10);
    if (!Number.isInteger(added) || !Number.isInteger(deleted)) continue;
    const path = parts.slice(2).join('\t').trim();
    if (includeInferredLeanFile(path) && (added || deleted)) stats[path] = { added, deleted };
  }
  return stats;
}

async function untrackedLeanStats(cwd: string): Promise<Record<string, FileDiffStats>> {
  const output = await tryGit(['ls-files', '--others', '--exclude-standard', '--', '*.lean'], { cwd });
  if (output === null) return {};
  const stats: Record<string, FileDiffStats> = {};
  for (const raw of output.split(/\r?\n/)) {
    const path = raw.trim();
    if (!path || !includeInferredLeanFile(path)) continue;
    try {
      const content = await fs.readFile(join(cwd, path));
      let lines = 0;
      for (const byte of content) if (byte === 0x0a) lines += 1;
      if (content.length > 0 && content[content.length - 1] !== 0x0a) lines += 1;
      if (lines) stats[path] = { added: lines, deleted: 0 };
    } catch {
      continue;
    }
  }
  return stats;
}

/**
 * Per-file added/deleted Lean line counts introduced by the branch: the
 * diff against ``merge-base(ref, HEAD)`` plus staged/unstaged/untracked
 * edits. Files with no line-level change are omitted.
 */
export async function leanFileDiffStats(cwd: string, ref: string | null): Promise<Record<string, FileDiffStats>> {
  if (!ref) return {};
  const mergeBase = (await tryGit(['merge-base', ref, 'HEAD'], { cwd }))?.trim() || ref;
  const output = await tryGit(['diff', '--numstat', '--no-renames', mergeBase, '--', '*.lean'], { cwd });
  if (output === null) return {};
  return { ...parseLeanNumstat(output), ...(await untrackedLeanStats(cwd)) };
}
