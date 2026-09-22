/**
 * `LeanService`: the one Lean integration singleton (`ctx.services.lean`).
 * It owns, per project root, the coalesced build queue with its
 * build-status stream, the snapshot watcher behind the file-tree badges, and
 * the language server the Infoview and the agents share.
 *
 * Every method takes an `OpenProject`; files in requests are repo-relative
 * (as the frontend addresses them) and are converted to project-relative
 * snapshot keys here.
 */

import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type {
  BlueprintBuildStatus,
  BuildErrorCounts,
  BuildSnapshotEvent,
  DiagnosticRequest,
  DiagnosticResponse,
  FileSaveRequest,
  GoalRequest,
  GoalResponse,
  HoverRequest,
  HoverResponse,
  OkResponse,
  ReloadFileRequest,
} from '@shared/api-types';
import type { AppContext } from '../../server/context';
import { HttpError } from '../../server/errors';
import { roomKeyFor, type OpenProject } from '../types';
import { AbortError, isAbortError } from './async';
import { BuildBus, BuildCoordinator, SnapshotWatcher, type BuildState } from './build/events';
import { depsReady, hasLakefile, isDirectory, readSnapshot, repoRelativeCounts, snapshotCounts, type Snapshot } from './build/snapshot';
import { buildFailed, type BuildOutput } from './diagnostics';
import { persistedBuildStatus, readPackageRevisions, runModuleBuild, runProjectBuildIfNeeded, type BuildPhase } from './build';
import { leanPreparingError, leanServiceError } from './errors';
import { loogleRemote, type LoogleResults } from './loogle';
import { LeanToolError, type GoalQuery, type LeanLSPServiceOptions } from './lsp/service';
import { resolveExistingFileUnderClone, resolveFileUnderClone, resolveLenient, snapshotKey, workspaceExecutionContext } from './paths';
import { LeanProjectRegistry } from './registry';
import { buildStaleAfterMs, leanSettingsFromEnv, type LeanBuildSettings } from './settings';

export const MAX_LEAN_FILE_BYTES = 2 * 1024 * 1024;
/** Outer budget on one live diagnostics request (the LSP wait caps at 300 s). */
const DIAGNOSTICS_CALL_TIMEOUT_MS = 320_000;

export interface BuildOutcome {
  status: 'ok' | 'errors' | 'up_to_date' | 'failed';
  output: BuildOutput | null;
  /** Infrastructure failure text (toolchain, timeout, lakefile), else null. */
  error: string | null;
}

export interface StartBuildOptions {
  /** 'session' emits the preparing phase and the session-runner failure copy. */
  reason?: string;
  /** A dotted module name for `lake build <target>`; omitted = full project. */
  target?: string;
  signal?: AbortSignal;
  onProgress?: (phase: BuildPhase, message: string) => void;
}

interface BuildRequest {
  target: string | null;
}

interface ProjectRuntime {
  projectRoot: string;
  coordinator: BuildCoordinator<BuildOutcome, BuildRequest>;
  watcher: SnapshotWatcher;
  activeState: BuildState | null;
  /** Aborts in-flight builds on shutdown. */
  controllers: Set<AbortController>;
  /** A build stopped a wanted language server and nothing has restarted it yet. */
  restartPending: boolean;
}

export interface LeanServiceOptions {
  settings?: LeanBuildSettings;
  /** Test seam for language-server client construction (see `LeanLSPServiceOptions`). */
  createClient?: LeanLSPServiceOptions['createClient'];
}

function hasTacticGoals(result: GoalQuery): boolean {
  return Boolean(result.goals?.length || result.goalsBefore?.length || result.goalsAfter?.length);
}

function withTimeout<T>(promise: Promise<T>, ms: number, describe: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(describe()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Atomic write via a sibling temp file, fsync and rename. */
export function atomicWriteText(target: string, content: string): void {
  mkdirSync(dirname(target), { recursive: true });
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}.${Date.now().toString(36)}.tmp`);
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, content, null, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, target);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // Nothing to clean.
    }
    throw error;
  }
}

export class LeanService {
  readonly settings: LeanBuildSettings;
  private readonly registry: LeanProjectRegistry;
  private readonly runtimes = new Map<string, ProjectRuntime>();
  private readonly buildStates = new Map<string, BuildState>();
  private readonly shutdownController = new AbortController();
  private shuttingDown = false;

  constructor(
    private readonly ctx: AppContext,
    options: LeanServiceOptions = {},
  ) {
    this.settings = options.settings ?? leanSettingsFromEnv();
    this.registry = new LeanProjectRegistry({
      settings: this.settings,
      serviceOptions: (projectRoot) => ({
        buildBlocking: () => this.runtimes.get(projectRoot)?.coordinator.blocking() ?? false,
        requireReady: () => {
          if (!this.lspReady(projectRoot)) throw leanPreparingError();
        },
        ...(options.createClient ? { createClient: options.createClient } : {}),
      }),
    });
  }

  // ── Build status ─────────────────────────────────────────────────────────

  buildStatus(project: OpenProject): BlueprintBuildStatus {
    return persistedBuildStatus(this.projectRoot(project));
  }

  /** In-flight steps for a late subscriber, else `{done, []}` when a stamp exists, else null. */
  buildSnapshot(project: OpenProject): BuildSnapshotEvent | null {
    const runtime = this.runtime(project);
    runtime.watcher.start();
    const state = this.buildStates.get(project.roomKey) ?? runtime.activeState;
    if (state && state.steps.length) return state.snapshot();
    if (persistedBuildStatus(runtime.projectRoot).status === 'done') return { status: 'done', steps: [] };
    return null;
  }

  /** Repo-relative `{errors, warnings}` per file from the persisted snapshot. */
  errorCounts(project: OpenProject): BuildErrorCounts {
    const runtime = this.runtime(project);
    runtime.watcher.start();
    return runtime.watcher.currentCounts();
  }

  /** Whether a build for the project is running or queued. */
  buildInProgress(project: OpenProject): boolean {
    return this.runtimes.get(this.projectRoot(project))?.coordinator.blocking() ?? false;
  }

  /**
   * Build the project (or one module), coalescing concurrent callers: a
   * request arriving while one is queued joins it, one arriving while one
   * runs shares a single follow-up. Progress goes out as `build_status`.
   */
  startBuild(project: OpenProject, options: StartBuildOptions = {}): Promise<BuildOutcome> {
    if (this.shuttingDown) return Promise.resolve({ status: 'failed', output: null, error: 'Fuse is shutting down' });
    const runtime = this.runtime(project);
    const incoming: BuildRequest = { target: options.target ?? null };
    const build = runtime.coordinator.request(incoming, (request) => this.runBuild(project, runtime, request, options));
    // The eager LSP restart waits for the coordinator to clear the flag:
    // fired from inside the build it would see that build as still running.
    void build.then(
      () => this.restartServerIfIdle(runtime),
      () => {},
    );
    return build;
  }

  private async runBuild(project: OpenProject, runtime: ProjectRuntime, request: BuildRequest, options: StartBuildOptions): Promise<BuildOutcome> {
    const rooms = this.roomsFor(project);
    const bus = new BuildBus(project.roomKey, this.buildStates, (event, data) => {
      for (const key of rooms) this.ctx.blueprintRooms.get(key).publish(event, data);
    });
    runtime.activeState = bus.state;
    const reporter = (phase: BuildPhase, message: string): void => {
      bus.emit(phase, message);
      options.onProgress?.(phase, message);
    };
    const controller = new AbortController();
    runtime.controllers.add(controller);
    const forward = (): void => controller.abort();
    options.signal?.addEventListener('abort', forward, { once: true });
    this.shutdownController.signal.addEventListener('abort', forward, { once: true });
    const publish = (snapshot: Snapshot): void => this.publishSnapshot(project, snapshot);
    try {
      if (this.shutdownController.signal.aborted || options.signal?.aborted) throw new AbortError();
      const context = workspaceExecutionContext(project.clonePath, project.projectSubdir);
      // Oleans get rewritten underneath the server: stop it now, restart
      // after. "Had" covers a server still starting (or owed by the previous
      // build), not just one whose handshake has finished.
      const existing = this.registry.peek(runtime.projectRoot);
      const hadServer = runtime.restartPending || (existing !== null && existing.clientActive);
      runtime.restartPending = false;
      await this.registry.terminate(runtime.projectRoot);
      let output: BuildOutput | null;
      if (request.target) {
        output = await runModuleBuild(context, request.target, { settings: this.settings, reporter, signal: controller.signal, publish });
      } else {
        output = await runProjectBuildIfNeeded(context, {
          settings: this.settings,
          reporter,
          preparing: options.reason === 'session',
          signal: controller.signal,
          publish,
        });
      }
      const status: BuildOutcome['status'] = output === null ? 'up_to_date' : buildFailed(output) ? 'errors' : 'ok';
      if (hadServer && status !== 'errors') runtime.restartPending = true;
      return { status, output, error: null };
    } catch (error) {
      const message = isAbortError(error) ? 'Build cancelled' : (error as Error).message;
      console.warn(`[lean] build failed for ${runtime.projectRoot}: ${message}`);
      bus.emit(
        'failed',
        options.reason === 'session'
          ? 'Lean environment could not be prepared. The agent will continue without Lean tooling.'
          : 'Lean build failed. Check logs for details.',
      );
      return { status: 'failed', output: null, error: message };
    } finally {
      options.signal?.removeEventListener('abort', forward);
      this.shutdownController.signal.removeEventListener('abort', forward);
      runtime.controllers.delete(controller);
      if (runtime.activeState === bus.state) runtime.activeState = null;
    }
  }

  // ── Infoview ─────────────────────────────────────────────────────────────

  async goals(project: OpenProject, req: GoalRequest, signal?: AbortSignal): Promise<GoalResponse> {
    const absolute = resolveExistingFileUnderClone(project.clonePath, req.file_path);
    const runtime = await this.ensureLspReady(project);
    return this.registry.withService(runtime.projectRoot, project.clonePath, async (service) => {
      try {
        const relPath = service.resolveRelativePath(absolute);
        const result = await service.goal(relPath, req.line, req.column ?? null, signal);
        let expectedType: string | null = null;
        let lineContext: string | null = result.lineContext;
        if (!hasTacticGoals(result)) {
          // Term-mode position (inside `def X := …`): ask for the expected type.
          // Isolated so a term_goal failure never hides the goal response.
          try {
            const term = await service.termGoal(relPath, req.line, req.column ?? null, signal);
            expectedType = term.expectedType;
            if (!lineContext) lineContext = term.lineContext;
          } catch (error) {
            if (isAbortError(error)) throw error;
            console.debug(`[lean] lean_term_goal failed: ${(error as Error).message}`);
          }
        }
        return {
          line_context: lineContext,
          goals: result.goals ?? null,
          goals_before: result.goalsBefore ?? null,
          goals_after: result.goalsAfter ?? null,
          expected_type: expectedType,
        };
      } catch (error) {
        throw leanServiceError(error, 'lean_goal', absolute);
      }
    });
  }

  async hover(project: OpenProject, req: HoverRequest, signal?: AbortSignal): Promise<HoverResponse> {
    const absolute = resolveExistingFileUnderClone(project.clonePath, req.file_path);
    const runtime = await this.ensureLspReady(project);
    return this.registry.withService(runtime.projectRoot, project.clonePath, async (service) => {
      try {
        const result = await service.hover(service.resolveRelativePath(absolute), req.line, req.column, signal);
        if (result.contents === null) return { contents: null, start_line: null, start_column: null, end_line: null, end_column: null };
        const range = result.sourceRange;
        if (range === null) return { contents: result.contents, start_line: null, start_column: null, end_line: null, end_column: null };
        return {
          contents: result.contents,
          start_line: range.start.line + 1,
          start_column: range.start.character + 1,
          end_line: range.end.line + 1,
          end_column: range.end.character + 1,
        };
      } catch (error) {
        throw leanServiceError(error, 'lean_hover', absolute);
      }
    });
  }

  async reload(project: OpenProject, req: ReloadFileRequest): Promise<OkResponse> {
    const absolute = resolveExistingFileUnderClone(project.clonePath, req.file_path);
    const runtime = await this.ensureLspReady(project);
    return this.registry.withService(runtime.projectRoot, project.clonePath, async (service) => {
      try {
        await service.reloadFile(service.resolveRelativePath(absolute));
        return { ok: true as const };
      } catch (error) {
        throw leanServiceError(error, 'lean_reload_file', absolute);
      }
    });
  }

  async diagnostics(project: OpenProject, req: DiagnosticRequest, signal?: AbortSignal): Promise<DiagnosticResponse> {
    const absolute = resolveExistingFileUnderClone(project.clonePath, req.file_path);
    const runtime = await this.ensureLspReady(project);
    const relativePath = snapshotKey(project.clonePath, runtime.projectRoot, req.file_path);
    return this.registry.withService(runtime.projectRoot, project.clonePath, async (service) => {
      try {
        if (relativePath === null) throw new LeanToolError(`File '${req.file_path}' is outside the assigned Lean project.`);
        const result = await withTimeout(
          service.diagnostics(relativePath, {
            startLine: req.start_line ?? null,
            endLine: req.end_line ?? null,
            signal,
            onSnapshot: (snapshot) => this.publishSnapshot(project, snapshot),
          }),
          DIAGNOSTICS_CALL_TIMEOUT_MS,
          () => new Error(`lean_diagnostic_messages exceeded ${DIAGNOSTICS_CALL_TIMEOUT_MS / 1000}s`),
        );
        return {
          items: result.items.map((item) => ({
            severity: item.severity,
            message: item.message,
            line: item.line,
            column: item.column,
            end_line: item.end_line,
            end_column: item.end_column,
          })),
          complete: result.complete,
          failed_dependencies: result.failed_dependencies,
        };
      } catch (error) {
        throw leanServiceError(error, 'lean_diagnostic_messages', absolute);
      }
    });
  }

  /** The persisted snapshot only — no language server is started. */
  cachedDiagnostics(project: OpenProject, req: DiagnosticRequest): DiagnosticResponse {
    const projectRoot = this.projectRoot(project);
    const relativePath = snapshotKey(project.clonePath, projectRoot, req.file_path);
    let diagnostics = relativePath ? (readSnapshot(projectRoot)[relativePath] ?? []) : [];
    if (req.start_line !== null && req.start_line !== undefined) {
      const start = req.start_line;
      diagnostics = diagnostics.filter((d) => d.line >= start);
    }
    if (req.end_line !== null && req.end_line !== undefined) {
      const end = req.end_line;
      diagnostics = diagnostics.filter((d) => d.line <= end);
    }
    return {
      items: diagnostics.map((d) => ({ severity: d.severity, message: d.message, line: d.line, column: d.column, end_line: null, end_column: null })),
      complete: true,
      failed_dependencies: [],
    };
  }

  /**
   * Write the editor's content into the folder. The language server is not
   * told: the next query's open re-reads the file and sends a full-text
   * didChange when it differs.
   */
  async save(project: OpenProject, req: FileSaveRequest): Promise<OkResponse> {
    if (Buffer.byteLength(req.content, 'utf8') > MAX_LEAN_FILE_BYTES) {
      throw new HttpError(422, `content is larger than ${MAX_LEAN_FILE_BYTES} bytes`, 'validation_error');
    }
    const target = resolveFileUnderClone(project.clonePath, req.file_path);
    atomicWriteText(target, req.content);
    return { ok: true };
  }

  loogle(query: string, numResults = 8): Promise<LoogleResults> {
    return loogleRemote(query, numResults);
  }

  /** Stop every language server, abort running builds and stop the watchers. */
  async shutdown(): Promise<void> {
    // Everything before the first await runs synchronously, which is all
    // Electron's `before-quit` gives us: signal the servers and builds now.
    this.shuttingDown = true;
    this.shutdownController.abort();
    for (const runtime of this.runtimes.values()) {
      runtime.watcher.stop();
      for (const controller of runtime.controllers) controller.abort();
    }
    this.registry.killAll();
    await this.registry.shutdown();
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private projectRoot(project: OpenProject): string {
    return resolveLenient(project.projectRoot);
  }

  private runtime(project: OpenProject): ProjectRuntime {
    const projectRoot = this.projectRoot(project);
    let runtime = this.runtimes.get(projectRoot);
    if (!runtime) {
      const created: ProjectRuntime = {
        projectRoot,
        coordinator: new BuildCoordinator<BuildOutcome, BuildRequest>({
          staleAfterMs: () => buildStaleAfterMs(this.settings),
          // A full build subsumes a module build; two different modules also
          // collapse into one full build rather than dropping either.
          merge: (queued, incoming) => (queued.target !== null && queued.target === incoming.target ? queued : { target: null }),
        }),
        watcher: new SnapshotWatcher(
          projectRoot,
          project.projectSubdir,
          (event, data) => {
            for (const key of this.roomsFor(project)) this.ctx.blueprintRooms.get(key).publish(event, data);
          },
          () => this.roomsFor(project).some((key) => (this.ctx.blueprintRooms.peek(key)?.subscriberCount ?? 0) > 0),
        ),
        activeState: null,
        controllers: new Set(),
        restartPending: false,
      };
      this.runtimes.set(projectRoot, created);
      runtime = created;
    }
    return runtime;
  }

  /**
   * Eagerly bring back the server a finished build stopped — unless another
   * build is already running or queued, which restarts it when it completes.
   */
  private restartServerIfIdle(runtime: ProjectRuntime): void {
    if (!runtime.restartPending || this.shuttingDown || runtime.coordinator.blocking()) return;
    runtime.restartPending = false;
    void this.registry.restartAfterBuild(runtime.projectRoot);
  }

  /** Rooms of every blueprint sharing this Lean project (same folder and subdir). */
  private roomsFor(project: OpenProject): string[] {
    const keys = new Set<string>([project.roomKey]);
    try {
      for (const row of this.ctx.registry.listBlueprints(project.repository.id)) {
        if ((row.project_subdir ?? '') === project.projectSubdir) keys.add(roomKeyFor(project.repository, row.id));
      }
    } catch {
      // The registry is only a nicety here; the triggering room always gets the event.
    }
    return [...keys];
  }

  private publishSnapshot(project: OpenProject, snapshot: Snapshot): void {
    const runtime = this.runtime(project);
    const files = repoRelativeCounts(snapshotCounts(snapshot), project.projectSubdir);
    for (const key of this.roomsFor(project)) this.ctx.blueprintRooms.get(key).publish('build_errors_updated', { files });
    runtime.watcher.noteExternalPublish();
  }

  /**
   * The language server needs dependencies present and the project built at
   * least once (otherwise every file reports "imports are out of date"):
   * either our deps marker says a build ran, or the project was built
   * outside Fuse (`.lake/build` exists and every manifest package is
   * materialized under `.lake/packages`).
   */
  lspReady(projectRoot: string): boolean {
    if (!hasLakefile(projectRoot)) return false;
    if (depsReady(projectRoot)) return true;
    if (!isDirectory(join(projectRoot, '.lake', 'build'))) return false;
    let manifest: unknown;
    try {
      manifest = JSON.parse(readFileSync(join(projectRoot, 'lake-manifest.json'), 'utf8'));
    } catch {
      return false;
    }
    const packages = readPackageRevisions(projectRoot);
    if (packages === null) {
      const raw = manifest && typeof manifest === 'object' ? (manifest as Record<string, unknown>).packages : null;
      return Array.isArray(raw) && raw.length === 0;
    }
    return Object.keys(packages).every((name) => isDirectory(join(projectRoot, '.lake', 'packages', name)));
  }

  /** Queries use the existing environment; only an explicit build prepares dependencies. */
  private async ensureLspReady(project: OpenProject): Promise<ProjectRuntime> {
    const runtime = this.runtime(project);
    if (runtime.coordinator.blocking()) {
      throw leanServiceError(new LeanToolError('A full project build is in progress; Lean queries are paused until it finishes.'), 'lean_lsp_acquire');
    }
    if (!this.lspReady(runtime.projectRoot)) {
      throw leanPreparingError();
    }
    return runtime;
  }
}
