/**
 * In-flight build progress and its fan-out to the blueprint event room.
 *
 * `BuildState` accumulates the `(phase, message)` steps of one build so a
 * client that connects mid-build gets a `build_snapshot` replay instead of a
 * blank dot. `BuildCoordinator` coalesces concurrent build requests (join a
 * queued build, at most one follow-up while one runs) and owns the
 * "build in progress" flag every Lean query fails fast on — with a staleness
 * clock so a wedged flag self-heals. `SnapshotWatcher` polls the snapshot
 * file's mtime so writes by another process (the MCP server) still reach the
 * file-tree badges as `build_errors_updated`.
 */

import { AsyncLock } from '../async';
import type { FileCounts } from './snapshot';
import { readSnapshot, repoRelativeCounts, snapshotCounts, snapshotMtime } from './snapshot';

/** Phases that indicate the build finished (success or no-op). */
const BUILD_DONE_PHASES = new Set(['complete', 'up_to_date']);

export interface BuildStep {
  seq: number;
  phase: string;
  message: string;
  ts: number;
}

export interface BuildSnapshotPayload {
  status: 'running' | 'done' | 'error';
  steps: Array<{ phase: string; message: string }>;
}

export class BuildState {
  status: 'running' | 'done' | 'error' = 'running';
  readonly steps: BuildStep[] = [];

  apply(step: BuildStep): void {
    this.steps.push(step);
    if (BUILD_DONE_PHASES.has(step.phase)) this.status = 'done';
    else if (step.phase === 'failed') this.status = 'error';
  }

  snapshot(): BuildSnapshotPayload {
    return { status: this.status, steps: this.steps.map((step) => ({ phase: step.phase, message: step.message })) };
  }
}

export type BuildPublisher = (event: 'build_status', data: { phase: string; message: string }) => void;

/**
 * The single emit point of one build: applies each step to the shared state
 * and publishes `build_status`. The state registry entry is installed on
 * the first step (never in the constructor, so a bus waiting for a lock
 * cannot overwrite a peer's live state) and evicted on a terminal step so
 * late subscribers fall back to the persisted stamp.
 */
export class BuildBus {
  readonly state = new BuildState();
  private seq = 0;

  constructor(
    private readonly roomKey: string,
    private readonly registry: Map<string, BuildState>,
    private readonly publish: BuildPublisher,
  ) {}

  emit(phase: string, message: string): void {
    this.seq += 1;
    const step: BuildStep = { seq: this.seq, phase, message, ts: Date.now() };
    this.state.apply(step);
    this.registry.set(this.roomKey, this.state);
    this.publish('build_status', { phase, message });
    if (this.state.status !== 'running' && this.registry.get(this.roomKey) === this.state) {
      this.registry.delete(this.roomKey);
    }
  }
}

interface QueuedBuild<T, R> {
  request: R;
  started: boolean;
  promise: Promise<T> | null;
}

export interface BuildCoordinatorOptions<R> {
  lock?: AsyncLock;
  staleAfterMs: () => number;
  clock?: () => number;
  /** Combine a joining request into the queued one (default: boolean OR, the `clean` flag). */
  merge?: (queued: R, incoming: R) => R;
  onChange?: (coordinator: BuildCoordinator<unknown, unknown>) => void;
}

/** Cancellation-safe coalescing of build requests for one project. */
export class BuildCoordinator<T, R = boolean> {
  readonly lock: AsyncLock;
  inProgress = false;
  activeCount = 0;
  startedAt: number | null = null;
  queued: QueuedBuild<T, R> | null = null;
  private readonly staleAfterMs: () => number;
  private readonly clock: () => number;
  private readonly merge: (queued: R, incoming: R) => R;
  private readonly onChange?: (coordinator: BuildCoordinator<unknown, unknown>) => void;

  constructor(options: BuildCoordinatorOptions<R>) {
    this.lock = options.lock ?? new AsyncLock();
    this.staleAfterMs = options.staleAfterMs;
    this.clock = options.clock ?? (() => Date.now());
    this.merge = options.merge ?? ((queued, incoming) => ((queued as unknown as boolean) || (incoming as unknown as boolean)) as unknown as R);
    this.onChange = options.onChange;
  }

  private changed(): void {
    this.onChange?.(this as BuildCoordinator<unknown, unknown>);
  }

  /** Whether a non-stale build is running or waiting for the lock. */
  blocking(): boolean {
    if (!this.inProgress) return false;
    if (this.startedAt === null) {
      this.startedAt = this.clock();
      return true;
    }
    const elapsed = this.clock() - this.startedAt;
    if (elapsed > this.staleAfterMs()) {
      console.warn(`[lean] build flag stuck for ${Math.round(elapsed / 1000)}s; clearing it`);
      this.inProgress = false;
      this.activeCount = 0;
      this.startedAt = null;
      this.changed();
      return false;
    }
    return true;
  }

  private markStarted(): void {
    if (this.activeCount <= 0) this.startedAt = this.clock();
    this.activeCount += 1;
    this.inProgress = true;
    this.changed();
  }

  private markFinished(): void {
    if (this.activeCount <= 0) {
      this.activeCount = 0;
      this.inProgress = false;
      this.startedAt = null;
      this.changed();
      return;
    }
    this.activeCount -= 1;
    this.inProgress = this.activeCount > 0;
    if (!this.inProgress) this.startedAt = null;
    this.changed();
  }

  /**
   * Join a queued (not yet started) build or schedule at most one follow-up
   * behind the running one. Every caller shares the same promise; a caller
   * going away never cancels the build.
   */
  request(incoming: R, runLocked: (request: R) => Promise<T>): Promise<T> {
    let queued = this.queued;
    if (queued !== null && !queued.started && queued.promise !== null) {
      queued.request = this.merge(queued.request, incoming);
    } else {
      const fresh: QueuedBuild<T, R> = { request: incoming, started: false, promise: null };
      queued = fresh;
      this.markStarted();
      fresh.promise = this.run(fresh, runLocked);
      // Swallow rejections on the shared promise; each awaiting caller
      // observes them through its own `await`.
      fresh.promise.catch(() => {});
      this.queued = fresh;
      this.changed();
    }
    return queued.promise as Promise<T>;
  }

  private async run(queued: QueuedBuild<T, R>, runLocked: (request: R) => Promise<T>): Promise<T> {
    try {
      return await this.lock.withLock(async () => {
        queued.started = true;
        if (this.queued === queued) {
          this.queued = null;
          this.changed();
        }
        this.startedAt = this.clock();
        return runLocked(queued.request);
      });
    } finally {
      if (this.queued === queued) {
        this.queued = null;
        this.changed();
      }
      this.markFinished();
    }
  }
}

export type SnapshotPublisher = (event: 'build_errors_updated', data: { files: Record<string, FileCounts> }) => void;

/**
 * Notices out-of-process rewrites of `.lake/.build-errors.json` by polling
 * its mtime while someone is listening, and publishes the fresh counts.
 */
export class SnapshotWatcher {
  private timer: NodeJS.Timeout | null = null;
  private lastMtime: number | null;

  constructor(
    private readonly projectRoot: string,
    private readonly projectSubdir: string,
    private readonly publish: SnapshotPublisher,
    private readonly hasListeners: () => boolean,
    private readonly pollMs = 3_000,
  ) {
    this.lastMtime = snapshotMtime(projectRoot);
  }

  currentCounts(): Record<string, FileCounts> {
    return repoRelativeCounts(snapshotCounts(readSnapshot(this.projectRoot)), this.projectSubdir);
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.poll(), this.pollMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Our own writes already published counts; skip the redundant poll event. */
  noteExternalPublish(): void {
    this.lastMtime = snapshotMtime(this.projectRoot);
  }

  poll(): void {
    if (!this.hasListeners()) return;
    const mtime = snapshotMtime(this.projectRoot);
    if (mtime === null || mtime === this.lastMtime) return;
    this.lastMtime = mtime;
    this.publish('build_errors_updated', { files: this.currentCounts() });
  }
}
