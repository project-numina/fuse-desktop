import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSON_FILE_DEBOUNCE_MS, JsonFile } from '@main/store/json-file';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fuse-json-file-'));
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

describe('JsonFile', () => {
  it('debounces writes and lands them atomically', () => {
    vi.useFakeTimers();
    const path = join(dir, 'nested', 'doc.json');
    const file = new JsonFile<{ v: number }>(path, () => ({ v: 0 }));
    file.set({ v: 1 });
    file.update((value) => {
      value.v = 2;
    });
    expect(existsSync(path)).toBe(false);
    vi.advanceTimersByTime(JSON_FILE_DEBOUNCE_MS);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ v: 2 });
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it('flushSync after a scheduled write keeps the newest value (no lost update)', async () => {
    const path = join(dir, 'doc.json');
    const file = new JsonFile<{ v: number; pad: string }>(path, () => ({ v: 0, pad: '' }));
    // A large first document followed shortly by a small update and a
    // synchronous flush: the sequence that used to let the older write win.
    file.set({ v: 1, pad: 'x'.repeat(4 * 1024 * 1024) });
    await new Promise((resolve) => setTimeout(resolve, JSON_FILE_DEBOUNCE_MS + 3));
    file.set({ v: 2, pad: '' });
    file.flushSync();
    await file.settled();
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ v: 2, pad: '' });
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it('settled() writes pending changes immediately', async () => {
    const path = join(dir, 'doc.json');
    const file = new JsonFile<{ v: number }>(path, () => ({ v: 0 }));
    file.set({ v: 5 });
    await file.settled();
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ v: 5 });
  });

  it('flushSync is a no-op when nothing changed and reloads with migration', () => {
    const path = join(dir, 'doc.json');
    const file = new JsonFile<{ v: number }>(path, () => ({ v: 0 }));
    file.flushSync();
    expect(existsSync(path)).toBe(false);
    file.set({ v: 3 });
    file.flushSync();
    const reloaded = new JsonFile<{ v: number; migrated: boolean }>(
      path,
      () => ({ v: 0, migrated: false }),
      (raw) => ({ ...(raw as { v: number }), migrated: true }),
    );
    expect(reloaded.get()).toEqual({ v: 3, migrated: true });
  });

  it('keeps the document dirty and does not throw when the write fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The parent "directory" is a file, so mkdir/write must fail.
    const blocker = join(dir, 'blocker');
    const inner = new JsonFile<{ v: number }>(blocker, () => ({ v: 0 }));
    inner.set({ v: 1 });
    inner.flushSync();
    const file = new JsonFile<{ v: number }>(join(blocker, 'doc.json'), () => ({ v: 0 }));
    file.set({ v: 1 });
    expect(() => file.flushSync()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
