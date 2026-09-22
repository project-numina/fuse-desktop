import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sleep } from '@main/services/lean/async';
import { BuildBus, BuildCoordinator, BuildState, SnapshotWatcher } from '@main/services/lean/build/events';
import { replaceAll } from '@main/services/lean/build/snapshot';

describe('BuildState', () => {
  it('tracks terminal phases', () => {
    const state = new BuildState();
    state.apply({ seq: 1, phase: 'building', message: 'Building Lean project...', ts: 0 });
    expect(state.snapshot()).toEqual({ status: 'running', steps: [{ phase: 'building', message: 'Building Lean project...' }] });
    state.apply({ seq: 2, phase: 'complete', message: 'Build complete', ts: 0 });
    expect(state.status).toBe('done');
    const failed = new BuildState();
    failed.apply({ seq: 1, phase: 'failed', message: 'x', ts: 0 });
    expect(failed.status).toBe('error');
    const upToDate = new BuildState();
    upToDate.apply({ seq: 1, phase: 'up_to_date', message: 'Build up to date', ts: 0 });
    expect(upToDate.status).toBe('done');
  });
});

describe('BuildBus', () => {
  it('publishes build_status, installs the state on first emit and evicts it when terminal', () => {
    const registry = new Map<string, BuildState>();
    const published: Array<{ phase: string; message: string }> = [];
    const bus = new BuildBus('o/r/b', registry, (_event, data) => published.push(data));
    expect(registry.has('o/r/b')).toBe(false);
    bus.emit('building', 'Building Lean project...');
    expect(registry.get('o/r/b')).toBe(bus.state);
    bus.emit('complete', 'Build complete');
    expect(registry.has('o/r/b')).toBe(false);
    expect(published).toEqual([
      { phase: 'building', message: 'Building Lean project...' },
      { phase: 'complete', message: 'Build complete' },
    ]);
    expect(bus.state.steps.map((step) => step.seq)).toEqual([1, 2]);
  });

  it('does not evict a peer bus state', () => {
    const registry = new Map<string, BuildState>();
    const peer = new BuildState();
    registry.set('o/r/b', peer);
    const bus = new BuildBus('o/r/b', registry, () => {});
    bus.emit('failed', 'x');
    expect(registry.has('o/r/b')).toBe(false);
    registry.set('o/r/b', peer);
    const stale = new BuildBus('o/r/b', registry, () => {});
    stale.emit('building', 'x');
    expect(registry.get('o/r/b')).toBe(stale.state);
  });
});

describe('BuildCoordinator', () => {
  it('joins a queued build and schedules one follow-up while running', async () => {
    const coordinator = new BuildCoordinator<string>({ staleAfterMs: () => 60_000 });
    const runs: boolean[] = [];
    let releaseFirst!: () => void;
    const runLocked = async (clean: boolean): Promise<string> => {
      runs.push(clean);
      if (runs.length === 1) await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      return `run-${runs.length}`;
    };
    const first = coordinator.request(false, runLocked);
    const joined = coordinator.request(true, runLocked);
    await sleep(0);
    expect(coordinator.blocking()).toBe(true);
    // Arrives while the first build runs: shares one follow-up.
    const followUpA = coordinator.request(false, runLocked);
    const followUpB = coordinator.request(true, runLocked);
    releaseFirst();
    expect(await first).toBe('run-1');
    expect(await joined).toBe('run-1');
    expect(await followUpA).toBe('run-2');
    expect(await followUpB).toBe('run-2');
    expect(runs).toEqual([true, true]);
    expect(coordinator.blocking()).toBe(false);
    expect(coordinator.activeCount).toBe(0);
  });

  it('propagates failures to every joined caller and clears the flag', async () => {
    const coordinator = new BuildCoordinator<string>({ staleAfterMs: () => 60_000 });
    const failing = async (): Promise<string> => {
      await sleep(5);
      throw new Error('boom');
    };
    const a = coordinator.request(false, failing);
    const b = coordinator.request(false, failing);
    await expect(a).rejects.toThrow('boom');
    await expect(b).rejects.toThrow('boom');
    expect(coordinator.inProgress).toBe(false);
  });

  it('self-heals a stuck flag after the stale window', () => {
    let now = 0;
    const coordinator = new BuildCoordinator<string>({ staleAfterMs: () => 1_000, clock: () => now });
    coordinator.inProgress = true;
    coordinator.activeCount = 1;
    coordinator.startedAt = 0;
    now = 500;
    expect(coordinator.blocking()).toBe(true);
    now = 1_500;
    expect(coordinator.blocking()).toBe(false);
    expect(coordinator.activeCount).toBe(0);
  });

  it('merges requests with a custom merge function', async () => {
    const coordinator = new BuildCoordinator<string, { target: string | null }>({
      staleAfterMs: () => 60_000,
      merge: (queued, incoming) => (queued.target === incoming.target ? queued : { target: null }),
    });
    const seen: Array<string | null> = [];
    const run = async (request: { target: string | null }): Promise<string> => {
      seen.push(request.target);
      await sleep(1);
      return 'ok';
    };
    const a = coordinator.request({ target: 'Foo' }, run);
    const b = coordinator.request({ target: 'Bar' }, run);
    await Promise.all([a, b]);
    expect(seen).toEqual([null]);
  });
});

describe('SnapshotWatcher', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fuse-watch-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it('publishes repo-relative counts when the snapshot mtime changes and listeners exist', () => {
    const published: unknown[] = [];
    let listeners = true;
    const watcher = new SnapshotWatcher(root, 'lean', (_event, data) => published.push(data), () => listeners, 1_000);
    watcher.poll();
    expect(published).toEqual([]);
    replaceAll(root, [{ file: 'Foo.lean', line: 1, column: 1, severity: 'error', message: 'x' }]);
    watcher.poll();
    expect(published).toEqual([{ files: { 'lean/Foo.lean': { errors: 1, warnings: 0 } } }]);
    watcher.poll();
    expect(published).toHaveLength(1);
    listeners = false;
    replaceAll(root, [{ file: 'Foo.lean', line: 1, column: 1, severity: 'warning', message: 'x' }]);
    watcher.poll();
    expect(published).toHaveLength(1);
    listeners = true;
    watcher.noteExternalPublish();
    watcher.poll();
    expect(published).toHaveLength(1);
  });

  it('polls on an interval while started', () => {
    vi.useFakeTimers();
    const published: unknown[] = [];
    const watcher = new SnapshotWatcher(root, '', (_event, data) => published.push(data), () => true, 1_000);
    watcher.start();
    replaceAll(root, [{ file: 'Foo.lean', line: 1, column: 1, severity: 'error', message: 'x' }]);
    vi.advanceTimersByTime(1_100);
    expect(published).toHaveLength(1);
    watcher.stop();
    replaceAll(root, [{ file: 'Bar.lean', line: 1, column: 1, severity: 'error', message: 'x' }]);
    vi.advanceTimersByTime(5_000);
    expect(published).toHaveLength(1);
  });
});
