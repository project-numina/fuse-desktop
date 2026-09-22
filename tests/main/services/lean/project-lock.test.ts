import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sleep } from '@main/services/lean/async';
import { LeanProjectBuildBusyError, PROJECT_BUILD_LOCK_FILE, withProjectBuildLock } from '@main/services/lean/project-lock';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fuse-lock-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('withProjectBuildLock', () => {
  it('creates and removes the lock file around the callback', async () => {
    const path = join(root, PROJECT_BUILD_LOCK_FILE);
    const result = await withProjectBuildLock(root, async () => {
      expect(existsSync(path)).toBe(true);
      expect(JSON.parse(readFileSync(path, 'utf8')).pid).toBe(process.pid);
      return 42;
    });
    expect(result).toBe(42);
    expect(existsSync(path)).toBe(false);
  });

  it('fails fast without waiting when another holder is active', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = withProjectBuildLock(root, () => held);
    await sleep(10);
    await expect(withProjectBuildLock(root, async () => 'never', { wait: false })).rejects.toBeInstanceOf(LeanProjectBuildBusyError);
    release();
    await holder;
    expect(await withProjectBuildLock(root, async () => 'later', { wait: false })).toBe('later');
  });

  it('serializes waiting callers', async () => {
    const order: string[] = [];
    const first = withProjectBuildLock(root, async () => {
      order.push('first-start');
      await sleep(30);
      order.push('first-end');
    });
    await sleep(5);
    const second = withProjectBuildLock(root, async () => {
      order.push('second-start');
    });
    await Promise.all([first, second]);
    expect(order).toEqual(['first-start', 'first-end', 'second-start']);
  });

  it('replaces a stale lock left by a dead process', async () => {
    const path = join(root, PROJECT_BUILD_LOCK_FILE);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ pid: 2 ** 22 - 1, created_at: new Date().toISOString() }));
    expect(await withProjectBuildLock(root, async () => 'ok', { wait: false })).toBe('ok');
  });

  it('replaces a corrupt lock file', async () => {
    const path = join(root, PROJECT_BUILD_LOCK_FILE);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'garbage');
    expect(await withProjectBuildLock(root, async () => 'ok', { wait: false })).toBe('ok');
  });

  it('honours the abort signal while waiting', async () => {
    let release!: () => void;
    const holder = withProjectBuildLock(root, () => new Promise<void>((resolve) => {
      release = resolve;
    }));
    await sleep(5);
    const controller = new AbortController();
    const waiting = withProjectBuildLock(root, async () => 'never', { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    release();
    await holder;
  });
});
