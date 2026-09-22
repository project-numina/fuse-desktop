/**
 * Cross-process exclusion for pipelines that mutate a project's `.lake` tree.
 *
 * Node has no `flock`, so the lock is an exclusively created file
 * `.lake/.fuse-project-build.lock` holding `{"pid", "created_at"}`. A lock
 * whose owner PID is gone, or that is older than any build could legitimately
 * take, is treated as stale and replaced. Any other process that wants to
 * cooperate (the MCP server, a CLI) follows the same protocol.
 */

import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { AsyncLock, sleep, throwIfAborted } from './async';

export const PROJECT_BUILD_LOCK_FILE = join('.lake', '.fuse-project-build.lock');
const LOCK_POLL_INTERVAL_MS = 50;
/** Beyond the longest bounded pipeline (build + cache get + update + grace). */
const LOCK_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

export class LeanProjectBuildBusyError extends Error {
  constructor() {
    super('Another Lean build is already preparing this project; retry after it finishes.');
    this.name = 'LeanProjectBuildBusyError';
  }
}

interface LockPayload {
  pid: number;
  created_at: string;
}

function readLock(path: string): LockPayload | null {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockPayload>;
    if (typeof value.pid !== 'number' || typeof value.created_at !== 'string') return null;
    return { pid: value.pid, created_at: value.created_at };
  } catch {
    return null;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function lockIsStale(path: string, now: number): boolean {
  const payload = readLock(path);
  if (payload === null) return true;
  if (payload.pid !== process.pid && !processAlive(payload.pid)) return true;
  const created = Date.parse(payload.created_at);
  return Number.isFinite(created) && now - created > LOCK_STALE_AFTER_MS;
}

/** Try once to create the lock file; true on success. */
function tryAcquire(path: string): boolean {
  mkdirSync(join(path, '..'), { recursive: true });
  let fd: number;
  try {
    fd = openSync(path, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
  try {
    writeSync(fd, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }));
  } finally {
    closeSync(fd);
  }
  return true;
}

// Same-process callers serialize on a mutex first so they never spin on the
// file against their own PID (which the staleness check treats as alive).
const inProcessLocks = new Map<string, AsyncLock>();

function inProcessLock(projectRoot: string): AsyncLock {
  let lock = inProcessLocks.get(projectRoot);
  if (!lock) {
    lock = new AsyncLock();
    inProcessLocks.set(projectRoot, lock);
  }
  return lock;
}

export interface ProjectLockOptions {
  /** Poll until free (default) or fail fast with `LeanProjectBuildBusyError`. */
  wait?: boolean;
  signal?: AbortSignal;
}

/** Hold the project build lock around `fn`. */
export async function withProjectBuildLock<T>(projectRoot: string, fn: () => Promise<T>, options: ProjectLockOptions = {}): Promise<T> {
  const wait = options.wait ?? true;
  const mutex = inProcessLock(projectRoot);
  if (!wait && mutex.locked) throw new LeanProjectBuildBusyError();
  return mutex.withLock(async () => {
    const path = join(projectRoot, PROJECT_BUILD_LOCK_FILE);
    throwIfAborted(options.signal);
    for (;;) {
      if (tryAcquire(path)) break;
      if (lockIsStale(path, Date.now())) {
        try {
          unlinkSync(path);
        } catch {
          // Someone else removed it first.
        }
        continue;
      }
      if (!wait) throw new LeanProjectBuildBusyError();
      await sleep(LOCK_POLL_INTERVAL_MS, options.signal);
    }
    try {
      return await fn();
    } finally {
      try {
        unlinkSync(path);
      } catch {
        // Already removed.
      }
    }
  }, options.signal);
}
