import { mkdirSync, mkdtempSync, renameSync, rmSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlueprintWatcher } from '@main/services/blueprint-watcher';

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, watch: vi.fn(actual.watch) };
});

let root: string;
let watchers: BlueprintWatcher[] = [];

function write(relative: string, content: string): void {
  const target = join(root, ...relative.split('/'));
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

function waitFor<T>(probe: () => T | undefined, timeoutMs = 3000): Promise<T> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      const value = probe();
      if (value !== undefined) {
        resolve(value);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error('timed out waiting for the watcher'));
        return;
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}

function settle(ms = 400): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function start(options: { forcePolling?: boolean } = {}): { watcher: BlueprintWatcher; batches: string[][] } {
  const batches: string[][] = [];
  const watcher = new BlueprintWatcher({
    clonePath: root,
    debounceMs: 50,
    pollIntervalMs: 50,
    forcePolling: options.forcePolling,
    onChange: (changed) => {
      batches.push(changed);
    },
  });
  watchers.push(watcher);
  return { watcher, batches };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fuse-watch-'));
  write('blueprint/src/content.tex', '\\input{chapters/one}\n');
  write('blueprint/src/chapters/one.tex', '\\section{One}\n');
});

afterEach(() => {
  for (const watcher of watchers) watcher.stop();
  watchers = [];
  vi.mocked(watch).mockReset();
  rmSync(root, { recursive: true, force: true });
});

describe.each<[string, { forcePolling?: boolean }]>([
  ['fs.watch', {}],
  ['polling fallback', { forcePolling: true }],
])('BlueprintWatcher (%s)', (_label, mode) => {
  it('reports a watched file whose content changed', async () => {
    const { watcher, batches } = start(mode);
    watcher.setFiles(['blueprint/src/content.tex', 'blueprint/src/chapters/one.tex']);
    watcher.start();
    expect(watcher.isPolling).toBe(mode.forcePolling === true);
    write('blueprint/src/chapters/one.tex', '\\section{One}\nEdited.\n');
    const changed = await waitFor(() => batches[0]);
    expect(changed).toEqual(['blueprint/src/chapters/one.tex']);
  });

  it('ignores writes that leave the content unchanged and writes it was told about', async () => {
    const { watcher, batches } = start(mode);
    watcher.setFiles(['blueprint/src/content.tex']);
    watcher.start();
    // Same bytes: a no-op save must not surface as an edit.
    write('blueprint/src/content.tex', '\\input{chapters/one}\n');
    await settle();
    expect(batches).toEqual([]);
    // Our own write: suppressed by content hash even though the bytes differ.
    watcher.noteOwnWrite('blueprint/src/content.tex', '\\input{chapters/one}\n% saved by the editor\n');
    write('blueprint/src/content.tex', '\\input{chapters/one}\n% saved by the editor\n');
    await settle();
    expect(batches).toEqual([]);
    // A later external edit is still reported.
    write('blueprint/src/content.tex', '\\input{chapters/one}\n% external\n');
    const changed = await waitFor(() => batches[0]);
    expect(changed).toEqual(['blueprint/src/content.tex']);
  });

  it('follows the include chain when setFiles adds a new chapter', async () => {
    const { watcher, batches } = start(mode);
    watcher.setFiles(['blueprint/src/content.tex']);
    watcher.start();
    write('blueprint/src/chapters/two.tex', '\\section{Two}\n');
    watcher.setFiles(['blueprint/src/content.tex', 'blueprint/src/chapters/two.tex']);
    expect(watcher.watchedFiles).toEqual(['blueprint/src/content.tex', 'blueprint/src/chapters/two.tex']);
    // The baseline is taken at setFiles time, so only later edits count.
    await settle();
    expect(batches).toEqual([]);
    write('blueprint/src/chapters/two.tex', '\\section{Two}\nMore.\n');
    const changed = await waitFor(() => batches[0]);
    expect(changed).toEqual(['blueprint/src/chapters/two.tex']);
  });

  it('reports an external revert to content the app once wrote', async () => {
    const { watcher, batches } = start(mode);
    watcher.setFiles(['blueprint/src/content.tex']);
    watcher.start();
    const ours = '\\input{chapters/one}\n% saved by the editor\n';
    write('blueprint/src/content.tex', ours);
    watcher.noteOwnWrite('blueprint/src/content.tex', ours);
    await settle();
    expect(batches).toEqual([]);
    write('blueprint/src/content.tex', '\\input{chapters/one}\n% external\n');
    await waitFor(() => batches[0]);
    // `git checkout -- file` / an editor undo restores our text: that is an
    // external edit too, so the own-write marker must not outlive the change.
    write('blueprint/src/content.tex', ours);
    await waitFor(() => batches[1]);
    expect(batches).toEqual([['blueprint/src/content.tex'], ['blueprint/src/content.tex']]);
  });

  it('reports a watched file that is created after it was registered as missing', async () => {
    const { watcher, batches } = start(mode);
    watcher.setFiles(['blueprint/src/content.tex', 'blueprint/src/chapters/newchap.tex']);
    watcher.start();
    await settle();
    expect(batches).toEqual([]);
    write('blueprint/src/chapters/newchap.tex', '\\section{New}\n');
    const changed = await waitFor(() => batches[0]);
    expect(changed).toEqual(['blueprint/src/chapters/newchap.tex']);
    // A later edit of the now-existing file is reported as usual.
    write('blueprint/src/chapters/newchap.tex', '\\section{New}\nMore.\n');
    await waitFor(() => batches[1]);
    expect(batches[1]).toEqual(['blueprint/src/chapters/newchap.tex']);
  });

  it('reports a missing file whose directory does not exist yet', async () => {
    const { watcher, batches } = start(mode);
    watcher.setFiles(['blueprint/src/content.tex', 'blueprint/src/appendix/extra.tex']);
    watcher.start();
    await settle();
    expect(batches).toEqual([]);
    write('blueprint/src/appendix/extra.tex', '\\section{Extra}\n');
    const changed = await waitFor(() => batches[0]);
    expect(changed).toEqual(['blueprint/src/appendix/extra.tex']);
    write('blueprint/src/appendix/extra.tex', '\\section{Extra}\nMore.\n');
    await waitFor(() => batches[1]);
    expect(batches[1]).toEqual(['blueprint/src/appendix/extra.tex']);
  });

  it('reports a watched file that is deleted and one that is recreated', async () => {
    const { watcher, batches } = start(mode);
    watcher.setFiles(['blueprint/src/chapters/one.tex']);
    watcher.start();
    rmSync(join(root, 'blueprint', 'src', 'chapters', 'one.tex'));
    await waitFor(() => batches[0]);
    write('blueprint/src/chapters/one.tex', '\\section{One}\nBack.\n');
    await waitFor(() => batches[1]);
    expect(batches).toEqual([['blueprint/src/chapters/one.tex'], ['blueprint/src/chapters/one.tex']]);
  });

  it('sees an atomic replace (temp file + rename) of a watched file', async () => {
    const { watcher, batches } = start(mode);
    watcher.setFiles(['blueprint/src/chapters/one.tex']);
    watcher.start();
    write('blueprint/src/chapters/one.tex.tmp', '\\section{One}\nReplaced.\n');
    renameSync(join(root, 'blueprint', 'src', 'chapters', 'one.tex.tmp'), join(root, 'blueprint', 'src', 'chapters', 'one.tex'));
    const changed = await waitFor(() => batches[0]);
    expect(changed).toEqual(['blueprint/src/chapters/one.tex']);
  });
});

describe('BlueprintWatcher lifecycle', () => {
  it('recovers missed native events without scanning unrelated files or duplicating updates', async () => {
    // Simulate a native watcher that attaches successfully but drops events.
    const silent = Object.assign(new EventEmitter(), {
      close: vi.fn(), ref: vi.fn(), unref: vi.fn(),
    }) as FSWatcher;
    vi.mocked(watch).mockReturnValue(silent);
    const { watcher, batches } = start();
    watcher.setFiles(['blueprint/src/content.tex']);
    watcher.start();
    expect(watcher.isPolling).toBe(false);
    write('blueprint/src/content.tex', 'changed during native watcher startup\n');
    write('unrelated/file.tex', 'not part of the blueprint\n');
    await waitFor(() => batches[0]);
    expect(batches).toEqual([['blueprint/src/content.tex']]);
    await settle(150);
    expect(batches).toHaveLength(1);
    watcher.stop();
    write('blueprint/src/content.tex', 'changed after stop\n');
    await settle(150);
    expect(batches).toHaveLength(1);
    expect(silent.close).toHaveBeenCalledOnce();
  });

  it('stops reporting after stop() and can force a check', async () => {
    const { watcher, batches } = start();
    watcher.setFiles(['blueprint/src/content.tex']);
    watcher.start();
    watcher.stop();
    expect(watcher.isRunning).toBe(false);
    write('blueprint/src/content.tex', 'changed\n');
    await settle();
    expect(batches).toEqual([]);
    watcher.start();
    await watcher.checkNow();
    expect(batches).toEqual([['blueprint/src/content.tex']]);
  });
});
