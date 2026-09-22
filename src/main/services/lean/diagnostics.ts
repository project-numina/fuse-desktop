/**
 * Parser for `lake build` output, shared by the build pipeline and the
 * module builds agents trigger. Lake prints per-file diagnostics, progress
 * lines and trailers on one stream; this turns them into a structured
 * `BuildOutput` and never treats a non-zero exit as exceptional — compile
 * errors are normal output that callers persist into the snapshot.
 */

import type { ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { AbortError, Semaphore } from './async';
import { normalizeDiagnosticFile } from './paths';
import { LakeTimeoutError, leanProcessEnv, spawnLeanTool, terminateProcessGroup } from './process';
import type { LeanBuildSettings } from './settings';

export interface Diagnostic {
  /** Project-relative POSIX path. */
  file: string;
  /** 1-indexed. */
  line: number;
  /** 1-indexed. */
  column: number;
  /** "error" | "warning" ("info" is parsed then dropped at flush). */
  severity: string;
  /** May be multi-line; capped at MAX_DIAGNOSTIC_CHARS. */
  message: string;
}

export interface BuildOutput {
  diagnostics: Diagnostic[];
  /** `error: ...` lines without a file:line:col location. */
  unscopedErrors: string[];
  exitCode: number;
  filesCompleted: number;
  filesTotal: number;
  /** `[N/M] <target>` of the latest progress line. */
  message: string;
  /** Modules lake reported building (`[N/M] Building Foo.Bar`). */
  builtModules: string[];
}

export function newBuildOutput(): BuildOutput {
  return { diagnostics: [], unscopedErrors: [], exitCode: 0, filesCompleted: 0, filesTotal: 0, message: '', builtModules: [] };
}

export function errorsOf(output: BuildOutput): Diagnostic[] {
  return output.diagnostics.filter((d) => d.severity === 'error');
}

export function warningsOf(output: BuildOutput): Diagnostic[] {
  return output.diagnostics.filter((d) => d.severity === 'warning');
}

/** Whether Lake reported an unsuccessful project build. */
export function buildFailed(output: BuildOutput): boolean {
  return output.exitCode !== 0 || errorsOf(output).length > 0 || output.unscopedErrors.length > 0;
}

export const DIAGNOSTIC_HEADER = /^(?<file>(?:[A-Za-z]:)?[^:\r\n]+\.lean):(?<line>\d+):(?<column>\d+):\s*(?<severity>error|warning|info):\s*(?<message>.*)$/;
export const DIAGNOSTIC_PREFIXED = /^(?<severity>error|warning|info):\s*(?<file>(?:[A-Za-z]:)?[^:\r\n]+\.lean):(?<line>\d+):(?<column>\d+):\s*(?<message>.*)$/;
/**
 * `[N/M] <target>`. Lake ≥ 4.9 prefixes the line with a status glyph
 * (`✔ [3/5] Built Foo`, `✖ [3/5] Building Foo`); the optional glyph keeps the
 * older bare form matching as well.
 */
export const PROGRESS_LINE = /^\s*(?:[✔✖⚠ℹ!]\s*)?\[(?<current>\d+)\/(?<total>\d+)\]\s+(?<target>.+)$/u;
export const UNSCOPED_ERROR = /^error:\s*(?<message>.+)$/;
/**
 * `Building Foo.Bar` (older Lake) or `Built Foo.Bar (12ms)` (newer Lake):
 * the modules a run actually touched, used to scope module-build snapshots.
 */
export const BUILT_MODULE_LINE = /^(?:Building|Built)\s+(?<module>[A-Za-z_][A-Za-z0-9_']*(?:\.[A-Za-z_][A-Za-z0-9_']*)*)\s*(?:\([^)]*\))?\s*$/;
export const MAX_DIAGNOSTIC_CHARS = 4000;

/** Lake's failure summary lines are never diagnostics or continuation text. */
export function isLakeTrailerLine(line: string): boolean {
  return (
    line.startsWith('error: build failed')
    || line.startsWith('warning: build:')
    || line.startsWith('error: Lean exited with code')
    || line.startsWith('error: external command')
  );
}

// Older Lake says "builds", newer Lake says "targets"; both introduce the
// `- Module` list that must not be glued onto the preceding diagnostic.
const FAILURE_LIST_HEADERS = new Set(['Some required builds logged failures:', 'Some required targets logged failures:']);

export interface AccumulatorOptions {
  clonePath?: string;
  onProgress?: (output: BuildOutput) => void;
}

/** Stateful parser collecting multi-line diagnostics from lake output. */
export class DiagnosticAccumulator {
  private pending: Diagnostic | null = null;
  private pendingChunks: string[] = [];
  private droppingLakeFailureList = false;

  constructor(
    private readonly output: BuildOutput,
    private readonly options: AccumulatorOptions = {},
  ) {}

  feedLine(line: string): void {
    const progress = PROGRESS_LINE.exec(line);
    if (progress?.groups) {
      this.flush();
      this.droppingLakeFailureList = false;
      this.output.filesCompleted = Number.parseInt(progress.groups.current, 10);
      this.output.filesTotal = Number.parseInt(progress.groups.total, 10);
      const target = progress.groups.target.trim();
      this.output.message = `[${this.output.filesCompleted}/${this.output.filesTotal}] ${target}`;
      const built = BUILT_MODULE_LINE.exec(target);
      if (built?.groups) this.output.builtModules.push(built.groups.module);
      this.options.onProgress?.(this.output);
      return;
    }

    const header = DIAGNOSTIC_HEADER.exec(line) ?? DIAGNOSTIC_PREFIXED.exec(line);
    if (header?.groups) {
      this.flush();
      this.droppingLakeFailureList = false;
      this.pending = {
        file: normalizeDiagnosticFile(header.groups.file, this.options.clonePath),
        line: Number.parseInt(header.groups.line, 10),
        column: Number.parseInt(header.groups.column, 10),
        severity: header.groups.severity,
        message: header.groups.message.trim(),
      };
      this.pendingChunks = [];
      return;
    }

    const unscoped = UNSCOPED_ERROR.exec(line);
    if (unscoped?.groups && !isLakeTrailerLine(line)) {
      this.flush();
      this.droppingLakeFailureList = false;
      this.output.unscopedErrors.push(unscoped.groups.message.trim());
      return;
    }

    // Continuation line for the in-progress diagnostic. Drop empty lines and
    // lake's failure-list trailer so a multi-line type mismatch stays
    // attached to its diagnostic without dragging in the noise.
    if (this.pending === null) return;
    const stripped = line.replace(/\s+$/, '');
    if (!stripped) return;
    if (isLakeTrailerLine(stripped)) return;
    if (FAILURE_LIST_HEADERS.has(stripped)) {
      this.droppingLakeFailureList = true;
      return;
    }
    if (this.droppingLakeFailureList && stripped.startsWith('- ')) return;
    this.droppingLakeFailureList = false;
    this.pendingChunks.push(stripped);
  }

  /** Finalize the in-progress diagnostic, if any. */
  flush(): void {
    if (this.pending === null) return;
    let diagnostic = this.pending;
    if (this.pendingChunks.length) {
      const extra = this.pendingChunks.join('\n');
      const full = diagnostic.message ? `${diagnostic.message}\n${extra}` : extra;
      diagnostic = { ...diagnostic, message: full.slice(0, MAX_DIAGNOSTIC_CHARS) };
    }
    if (diagnostic.severity !== 'info') this.output.diagnostics.push(diagnostic);
    this.pending = null;
    this.pendingChunks = [];
  }
}

export interface LakeRunResult {
  exitCode: number;
  output: BuildOutput;
}

export interface LakeRunOptions {
  settings: LeanBuildSettings;
  timeoutMs: number;
  onProgress?: (output: BuildOutput) => void;
  extraEnv?: Record<string, string>;
  signal?: AbortSignal;
  /** Called with the spawned process, for callers that need to observe or kill it. */
  onSpawn?: (child: ChildProcess) => void;
}

// One slot pool per process, sized lazily from the first caller's settings.
let buildSlots: Semaphore | null = null;
let buildSlotLimit = 0;

/** Bound concurrent `lake build`s to `maxConcurrentLeanBuilds` (0 = unbounded). */
export async function acquireBuildSlot(settings: LeanBuildSettings): Promise<() => void> {
  const limit = settings.maxConcurrentLeanBuilds > 0 ? settings.maxConcurrentLeanBuilds : 0;
  if (buildSlots === null || buildSlotLimit !== limit) {
    buildSlots = new Semaphore(limit);
    buildSlotLimit = limit;
  }
  return buildSlots.acquire();
}

/** Test hook: forget the shared slot pool. */
export function resetBuildSlots(): void {
  buildSlots = null;
  buildSlotLimit = 0;
}

/**
 * Run `lake <args>` streaming stdout and stderr through the parser line by
 * line. Rejects only on timeout (`LakeTimeoutError`), abort (`AbortError`)
 * or a spawn failure; a non-zero exit is returned as data.
 */
export async function runLakeWithDiagnostics(projectRoot: string, lakeArgs: readonly string[], options: LakeRunOptions): Promise<LakeRunResult> {
  const output = newBuildOutput();
  const accumulator = new DiagnosticAccumulator(output, { clonePath: projectRoot, onProgress: options.onProgress });
  if (options.signal?.aborted) throw new AbortError();

  const releaseSlot = await acquireBuildSlot(options.settings);
  try {
    if (options.signal?.aborted) throw new AbortError();
    const child = spawnLeanTool('lake', [...lakeArgs], {
      cwd: projectRoot,
      env: leanProcessEnv(options.settings, options.extraEnv),
    });
    options.onSpawn?.(child);
    child.stdin?.end();

    let timedOut = false;
    let aborted = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void terminateProcessGroup(child, 'timeout');
    }, options.timeoutMs);
    const onAbort = (): void => {
      aborted = true;
      void terminateProcessGroup(child, 'cancelled');
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    // Each stream gets its own line splitter so a diagnostic block (header
    // plus continuation lines) is never torn by a chunk from the other stream.
    const readers: Array<Promise<void>> = [];
    for (const stream of [child.stdout, child.stderr]) {
      if (!stream) continue;
      stream.setEncoding('utf8');
      const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
      readers.push(
        new Promise<void>((resolve) => {
          lines.on('line', (line) => accumulator.feedLine(line));
          lines.on('close', () => resolve());
        }),
      );
    }

    try {
      const exitCode = await new Promise<number>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signalName) => {
          resolve(code ?? (signalName ? 128 : 1));
        });
      });
      await Promise.all(readers);
      accumulator.flush();
      if (timedOut) throw new LakeTimeoutError(`lake ${lakeArgs.join(' ')} timed out after ${options.timeoutMs / 1000}s`);
      if (aborted) throw new AbortError();
      output.exitCode = exitCode;
      return { exitCode, output };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  } finally {
    releaseSlot();
  }
}
