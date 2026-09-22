import { statfs } from 'node:fs/promises';
import type { LeanSetupStatus, LeanSetupTask } from '@shared/lean-setup';
import { HttpError } from '../../store/registry';
import type { OpenProject } from '../types';
import { AsyncLock } from './async';
import { hasLakefile } from './build/snapshot';
import { isInside, resolveLenient } from './paths';
import type { LeanService } from './service';

/** Disk capacity only: never recursively measure .lake or download to estimate size. */
export async function storageAt(path: string): Promise<LeanSetupStatus['projects'][number]['storage']> {
  try {
    const disk = await statfs(path);
    return { availableBytes: disk.bavail * disk.bsize, totalBytes: disk.blocks * disk.bsize };
  } catch {
    return null;
  }
}

/** User-approved setup, one entire download/build pipeline at a time. */
export class LeanSetupService {
  private readonly queue = new AsyncLock();
  private readonly tasks = new Map<string, { state: LeanSetupTask; controller: AbortController; done: Promise<void> }>();
  private closed = false;

  constructor(private readonly lean: LeanService) {}

  private root(project: OpenProject): string {
    const root = resolveLenient(project.projectRoot);
    if (!isInside(resolveLenient(project.repository.path), root)) throw new HttpError(422, 'Lean project must be inside the repository.');
    return root;
  }

  async status(project: OpenProject): Promise<LeanSetupStatus> {
    const { repository } = project;
    const root = this.root(project);
    return {
      repositoryId: repository.id,
      dismissed: repository.lean_setup_dismissed ?? false,
      threads: this.lean.settings.leanNumThreads,
      projects: hasLakefile(root) ? [{ directory: project.projectSubdir, ready: this.lean.lspReady(root), storage: await storageAt(root) }] : [],
      task: this.tasks.get(root)?.state ?? null,
    };
  }

  async start(project: OpenProject): Promise<void> {
    if (this.closed) throw new HttpError(409, 'Fuse is shutting down');
    const projectRoot = this.root(project);
    const directory = project.projectSubdir;
    const previous = this.tasks.get(projectRoot);
    if (previous && ['queued', 'running'].includes(previous.state.status)) return;
    if (!hasLakefile(projectRoot)) throw new HttpError(422, 'This Lean project no longer has a lakefile.');
    const state: LeanSetupTask = { directory, status: 'queued', message: 'Waiting for another Lean setup to finish…', steps: [] };
    const controller = new AbortController();
    const done = this.queue.withLock(async () => {
      state.status = 'running';
      state.message = 'Setting up Lean…';
      const outcome = await this.lean.startBuild(project, {
        reason: 'manual', signal: controller.signal,
        onProgress: (_phase, message) => {
          state.message = message;
          state.steps = [...state.steps.slice(-99), message];
        },
      });
      if (controller.signal.aborted) {
        state.status = 'cancelled';
        state.message = 'Setup cancelled. Downloaded files are kept for next time.';
      } else if (outcome.status === 'ok' || outcome.status === 'up_to_date') {
        state.status = 'ready';
        state.message = 'Lean setup complete.';
      } else {
        state.status = 'failed';
        state.message = outcome.error ?? 'The build reported errors. Review the Lean diagnostics, then retry.';
      }
    }, controller.signal).catch((error: unknown) => {
      state.status = controller.signal.aborted ? 'cancelled' : 'failed';
      state.message = controller.signal.aborted ? 'Setup cancelled.' : (error instanceof Error ? error.message : 'Setup failed.');
    });
    this.tasks.set(projectRoot, { state, controller, done });
  }

  cancel(project: OpenProject): void {
    this.tasks.get(this.root(project))?.controller.abort();
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    for (const task of this.tasks.values()) task.controller.abort();
    await Promise.all([...this.tasks.values()].map((task) => task.done));
  }
}
