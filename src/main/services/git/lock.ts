/**
 * One FIFO mutex per repository folder. Every write pipeline (commit,
 * agent-turn and REST autocommits, sync, sync-main, the setup scaffold)
 * runs inside it so two pipelines never interleave their staging and
 * committing on the same `.git/index` — the desktop equivalent of the
 * web's per-workspace clone lock. Keys are realpaths, so two blueprints
 * sharing a folder (or a symlinked spelling of it) share the lock.
 */

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

interface QueuedLock {
  tail: Promise<void>;
  holders: number;
}

const locks = new Map<string, QueuedLock>();

/** Canonical key for a folder: its realpath, else the resolved spelling. */
export function repositoryLockKey(cwd: string): string {
  try {
    return realpathSync(cwd);
  } catch {
    return resolve(cwd);
  }
}

/** Run `fn` once every earlier holder of the folder's lock has released. */
export async function withRepositoryLock<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const key = repositoryLockKey(cwd);
  let lock = locks.get(key);
  if (!lock) {
    lock = { tail: Promise.resolve(), holders: 0 };
    locks.set(key, lock);
  }
  const previous = lock.tail;
  let release!: () => void;
  lock.tail = new Promise<void>((done) => {
    release = done;
  });
  lock.holders += 1;
  await previous;
  try {
    return await fn();
  } finally {
    lock.holders -= 1;
    release();
    if (lock.holders === 0 && locks.get(key) === lock) locks.delete(key);
  }
}

/** True while a write pipeline holds (or waits for) the folder's lock. */
export function repositoryLockBusy(cwd: string): boolean {
  return (locks.get(repositoryLockKey(cwd))?.holders ?? 0) > 0;
}
