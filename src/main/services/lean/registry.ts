/**
 * One `LeanLSPService` (and so one `lake serve`) per project root, started
 * lazily on the first query, stopped after a period with no window or agent
 * using it, capped in number with least-recently-used eviction, and all
 * killed on shutdown. Replaces the hosted backend's per-project MCP wrapper
 * manager: no ports, no health probes.
 */

import { AsyncLock } from './async';
import { LeanLSPService, type LeanLSPServiceOptions } from './lsp/service';
import type { LeanBuildSettings } from './settings';

interface Entry {
  service: LeanLSPService;
  refCount: number;
  lastUsed: number;
  idleTimer: NodeJS.Timeout | null;
}

export interface RegistryOptions {
  settings: LeanBuildSettings;
  /** Extra per-project options (build gating, readiness). */
  serviceOptions?: (projectRoot: string, repositoryRoot: string) => Partial<LeanLSPServiceOptions>;
}

export class LeanProjectRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly lock = new AsyncLock();
  private closed = false;

  constructor(private readonly options: RegistryOptions) {}

  /** The live service for a project, or null when none has been started. */
  peek(projectRoot: string): LeanLSPService | null {
    return this.entries.get(projectRoot)?.service ?? null;
  }

  get size(): number {
    return this.entries.size;
  }

  /** Get or start the project's service and hold a reference until `release`. */
  async acquire(projectRoot: string, repositoryRoot: string): Promise<LeanLSPService> {
    if (this.closed) throw new Error('Lean project registry is shut down');
    return this.lock.withLock(async () => {
      let entry = this.entries.get(projectRoot);
      if (!entry) {
        await this.evictIfCrowded();
        const service = new LeanLSPService({
          projectRoot,
          repositoryRoot,
          settings: this.options.settings,
          ...(this.options.serviceOptions?.(projectRoot, repositoryRoot) ?? {}),
        });
        service.start();
        entry = { service, refCount: 0, lastUsed: Date.now(), idleTimer: null };
        this.entries.set(projectRoot, entry);
      }
      if (entry.idleTimer !== null) clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
      entry.refCount += 1;
      entry.lastUsed = Date.now();
      return entry.service;
    });
  }

  release(projectRoot: string): void {
    const entry = this.entries.get(projectRoot);
    if (!entry) return;
    entry.refCount = Math.max(0, entry.refCount - 1);
    entry.lastUsed = Date.now();
    if (entry.refCount === 0 && entry.idleTimer === null) {
      entry.idleTimer = setTimeout(() => void this.stopIfIdle(projectRoot), this.options.settings.lspProjectIdleMs);
      entry.idleTimer.unref?.();
    }
  }

  /** Run `fn` with the project's service, releasing afterwards. */
  async withService<T>(projectRoot: string, repositoryRoot: string, fn: (service: LeanLSPService) => Promise<T>): Promise<T> {
    const service = await this.acquire(projectRoot, repositoryRoot);
    try {
      return await fn(service);
    } finally {
      this.release(projectRoot);
    }
  }

  private async stopIfIdle(projectRoot: string): Promise<void> {
    await this.lock.withLock(async () => {
      const entry = this.entries.get(projectRoot);
      if (!entry || entry.refCount > 0) return;
      this.entries.delete(projectRoot);
      await entry.service.close();
    });
  }

  /** Least-recently-used idle projects go first when over the cap. */
  private async evictIfCrowded(): Promise<void> {
    while (this.entries.size >= this.options.settings.lspMaxProjects) {
      const idle = [...this.entries.entries()].filter(([, entry]) => entry.refCount === 0).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      const victim = idle[0];
      if (!victim) return;
      const [root, entry] = victim;
      if (entry.idleTimer !== null) clearTimeout(entry.idleTimer);
      this.entries.delete(root);
      await entry.service.close();
    }
  }

  /** Terminate the project's server (before a build rewrites its oleans). */
  async terminate(projectRoot: string): Promise<void> {
    const entry = this.entries.get(projectRoot);
    if (entry) await entry.service.terminateClient();
  }

  /** Bring the server back after a successful build when someone was using it. */
  async restartAfterBuild(projectRoot: string): Promise<void> {
    const entry = this.entries.get(projectRoot);
    if (!entry) return;
    try {
      await entry.service.restartClient();
    } catch (error) {
      // An eager restart is only an optimization; the next query retries lazily.
      console.warn(`[lean] eager LSP restart failed for ${projectRoot}: ${(error as Error).message}`);
    }
  }

  /** Signal every server synchronously; `shutdown` then reaps what is left. */
  killAll(): void {
    this.closed = true;
    for (const entry of this.entries.values()) entry.service.killNow();
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    await this.lock.withLock(async () => {
      const entries = [...this.entries.values()];
      this.entries.clear();
      for (const entry of entries) {
        if (entry.idleTimer !== null) clearTimeout(entry.idleTimer);
      }
      await Promise.all(entries.map((entry) => entry.service.close().catch(() => {})));
    });
  }
}
