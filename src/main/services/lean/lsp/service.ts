/**
 * Lifecycle policy around one project's `LeanLSPClient` — lazy start,
 * restart on death, idle document sweeps, the build-in-progress fail-fast —
 * plus the line/column conventions of the Infoview queries: 1-indexed editor
 * coordinates in, LSP positions out.
 *
 * Columns arrive from CodeMirror as `pos - line.from + 1`, already a UTF-16
 * code-unit offset (JS strings), so `column - 1` is the LSP character with
 * no re-encoding.
 */

import { join } from 'node:path';
import { AsyncLock } from '../async';
import {
  lspSnapshotDiagnostics,
  mergeFailedDependencies,
  replaceSingleFile,
  sourceContentHash,
  type Snapshot,
} from '../build/snapshot';
import { LeanLSPClient } from './client';
import { diagnosticReportIsAuthoritative, lineRange } from './diagnostics';
import { LeanProcessExited, LSPTransportClosed } from './errors';
import type { DocumentSymbol, LspDiagnostic, Range } from './models';
import { isInside, resolveLenient, resolveWorkspaceAlias, toPosix } from '../paths';
import { DEFAULT_LEAN_SETTINGS, type LeanBuildSettings } from '../settings';

/** A user-visible tool failure (the message is what agents and the API see). */
export class LeanToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LeanToolError';
  }
}

export const BUILD_IN_PROGRESS_MESSAGE = 'A full project build is in progress; Lean queries are paused until it finishes.';

export interface GoalQuery {
  lineContext: string;
  goals?: string[];
  goalsBefore?: string[];
  goalsAfter?: string[];
}

export interface TermGoalQuery {
  lineContext: string;
  expectedType: string | null;
}

export interface HoverQuery {
  contents: string | null;
  sourceRange: Range | null;
}

export interface DiagnosticMessage {
  severity: string;
  message: string;
  line: number;
  column: number;
  end_line: number | null;
  end_column: number | null;
}

export interface DiagnosticsResult {
  /** `complete` and no errors. */
  success: boolean;
  /** Authoritative: protocol-complete and free of the stale-import header. */
  complete: boolean;
  items: DiagnosticMessage[];
  failed_dependencies: string[];
}

const DIAGNOSTIC_SEVERITY: Record<number, string> = { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' };
/** Lake build stderr relayed by Lean as a synthetic (1,1) diagnostic. */
export const BUILD_ERROR_FILE_PATTERN = /^(?:error|warning):\s*([^\s:]+\.lean):\d+:\d+:/im;

export function isBuildStderr(message: string): boolean {
  return message.includes('lake setup-file') || BUILD_ERROR_FILE_PATTERN.test(message);
}

/** Distinct `.lean` paths named in lake build stderr, sorted. */
export function extractFailedDependencyPaths(message: string): string[] {
  const found = new Set<string>();
  // A fresh global instance per call: a shared one would carry lastIndex state.
  for (const match of message.matchAll(new RegExp(BUILD_ERROR_FILE_PATTERN.source, 'gim'))) found.add(match[1]);
  return [...found].sort();
}

/** Split lake-stderr noise out of raw LSP diagnostics and 1-index the rest. */
export function processDiagnostics(raw: LspDiagnostic[], buildSuccess: boolean, complete = true): DiagnosticsResult {
  const items: DiagnosticMessage[] = [];
  let failedDependencies: string[] = [];
  for (const diagnostic of raw) {
    const range = diagnostic.fullRange ?? diagnostic.range;
    const severityInt = diagnostic.severity ?? 1;
    const line = range.start.line + 1;
    const column = range.start.character + 1;
    if (line === 1 && column === 1 && isBuildStderr(diagnostic.message)) {
      failedDependencies = extractFailedDependencyPaths(diagnostic.message);
      continue;
    }
    items.push({
      severity: DIAGNOSTIC_SEVERITY[severityInt] ?? `unknown(${severityInt})`,
      message: diagnostic.message,
      line,
      column,
      end_line: range.end.line + 1,
      end_column: range.end.character + 1,
    });
  }
  return { success: buildSuccess, complete, items, failed_dependencies: failedDependencies };
}

function nameIsSuffix(candidate: string, target: string): boolean {
  const candidateSegments = candidate.split('.');
  const targetSegments = target.split('.');
  if (targetSegments.length >= candidateSegments.length) return false;
  return candidateSegments.slice(-targetSegments.length).join('.') === targetSegments.join('.');
}

export interface SymbolLike {
  name: string;
  children?: SymbolLike[];
}

function findExactSymbol<T extends SymbolLike>(symbols: T[], target: string, prefix = ''): T | null {
  for (const symbol of symbols) {
    const qualified = prefix ? `${prefix}${symbol.name}` : symbol.name;
    if (qualified === target) return symbol;
    const children = (symbol.children ?? []) as T[];
    if (children.length) {
      const match = findExactSymbol(children, target, `${qualified}.`);
      if (match) return match;
    }
  }
  return null;
}

function collectSuffixSymbols<T extends SymbolLike>(symbols: T[], target: string, prefix = ''): T[] {
  const matches: T[] = [];
  for (const symbol of symbols) {
    const qualified = prefix ? `${prefix}${symbol.name}` : symbol.name;
    if (nameIsSuffix(qualified, target) || nameIsSuffix(symbol.name, target)) matches.push(symbol);
    const children = (symbol.children ?? []) as T[];
    if (children.length) matches.push(...collectSuffixSymbols(children, target, `${qualified}.`));
  }
  return matches;
}

/**
 * Find a document symbol by qualified or leaf name. Exact qualified matches
 * win; otherwise exactly one segment-suffix match is accepted, and an
 * ambiguous lookup returns null rather than guessing.
 */
export function searchSymbols<T extends SymbolLike>(symbols: T[], target: string): T | null {
  const exact = findExactSymbol(symbols, target);
  if (exact) return exact;
  const suffix = collectSuffixSymbols(symbols, target);
  return suffix.length === 1 ? suffix[0] : null;
}

export function isDeadClientError(error: unknown): boolean {
  if (error instanceof LeanProcessExited || error instanceof LSPTransportClosed) return true;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED';
}

/** Python's `str.splitlines()` on `\n`-normalized text (no trailing empty line). */
export function splitLines(content: string): string[] {
  const lines = content.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export interface LeanLSPServiceOptions {
  projectRoot: string;
  repositoryRoot: string;
  settings?: LeanBuildSettings;
  /** Queries fail fast with `BUILD_IN_PROGRESS_MESSAGE` while this returns true. */
  buildBlocking?: () => boolean;
  /** Refused (thrown) before a client is created; throw the readiness error. */
  requireReady?: () => void;
  /** Test seam for client construction. */
  createClient?: () => Promise<LeanLSPClient>;
}

export class LeanLSPService {
  readonly projectRoot: string;
  readonly repositoryRoot: string;
  readonly settings: LeanBuildSettings;
  readonly clientLock = new AsyncLock();
  client: LeanLSPClient | null = null;
  /** Clients being created, plus restarts requested but not yet through the lock. */
  private startsPending = 0;
  private readonly buildBlocking: () => boolean;
  private readonly requireReady: () => void;
  private readonly createClient: () => Promise<LeanLSPClient>;
  private sweeper: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(options: LeanLSPServiceOptions) {
    this.projectRoot = resolveLenient(options.projectRoot);
    this.repositoryRoot = resolveLenient(options.repositoryRoot);
    this.settings = options.settings ?? DEFAULT_LEAN_SETTINGS;
    this.buildBlocking = options.buildBlocking ?? (() => false);
    this.requireReady = options.requireReady ?? (() => {});
    this.createClient =
      options.createClient
      ?? (async () => {
        const client = new LeanLSPClient({ projectRoot: this.projectRoot, settings: this.settings });
        await client.start();
        return client;
      });
  }

  get clientExited(): boolean {
    return this.client !== null && this.client.returncode !== null;
  }

  /**
   * Whether a server is live, being started, or about to be restarted —
   * i.e. someone wants one, so a build that tears it down should bring it
   * back. `client` alone stays null for the whole `lake serve` handshake.
   */
  get clientActive(): boolean {
    return this.client !== null || this.startsPending > 0;
  }

  /** Start the idle document sweeper (every min(30 s, max(1 s, ttl/2))). */
  start(): void {
    const ttl = this.settings.lspFileIdleTtlMs;
    if (ttl > 0 && this.sweeper === null) {
      const interval = Math.min(30_000, Math.max(1_000, ttl / 2));
      this.sweeper = setInterval(() => void this.sweepIdleFilesOnce(), interval);
      this.sweeper.unref?.();
    }
  }

  /** Synchronous shutdown fast path (see `LeanLSPClient.killNow`). */
  killNow(): void {
    this.closed = true;
    if (this.sweeper !== null) clearInterval(this.sweeper);
    this.sweeper = null;
    this.client?.killNow();
  }

  /** Stop background work and terminate the client. */
  async close(): Promise<void> {
    this.closed = true;
    if (this.sweeper !== null) clearInterval(this.sweeper);
    this.sweeper = null;
    await this.clientLock.withLock(async () => {
      const client = this.client;
      this.client = null;
      if (client) await client.close();
    });
  }

  async terminateClient(): Promise<void> {
    await this.clientLock.withLock(async () => {
      const client = this.client;
      this.client = null;
      if (client) await client.close();
    });
  }

  /**
   * Bring the server back after a build. Counts as active from the call
   * (synchronously) until the new client is up, so a build starting
   * meanwhile knows to restart it in turn; and once through the lock a
   * build that began in the meantime wins — starting a server under it
   * would read half-written oleans, and that build restarts it itself.
   */
  async restartClient(): Promise<void> {
    this.startsPending += 1;
    try {
      await this.terminateClient();
      await this.clientLock.withLock(async () => {
        if (this.buildBlocking()) return;
        await this.ensureClientLocked();
      });
    } finally {
      this.startsPending -= 1;
    }
  }

  private async ensureClientLocked(): Promise<LeanLSPClient> {
    if (this.closed) throw new LSPTransportClosed('Lean LSP service is closed');
    if (this.clientExited) {
      const dead = this.client;
      this.client = null;
      console.warn(`[lean] lake serve for ${this.projectRoot} exited with code ${dead?.returncode}; recreating`);
      await dead?.close();
    }
    if (this.client === null) {
      this.requireReady();
      this.startsPending += 1;
      try {
        this.client = await this.createClient();
      } finally {
        this.startsPending -= 1;
      }
    }
    return this.client;
  }

  /**
   * Run `fn` with a live client, holding the lifecycle lock only for the
   * (short) prepare phase; long requests go through `runCall` instead.
   */
  async acquireClient<T>(fn: (client: LeanLSPClient) => Promise<T>): Promise<T> {
    if (this.buildBlocking()) throw new LeanToolError(BUILD_IN_PROGRESS_MESSAGE);
    return this.clientLock.withLock(async () => {
      const client = await this.ensureClientLocked();
      try {
        return await fn(client);
      } catch (error) {
        if ((isDeadClientError(error) || client.returncode !== null) && this.client === client) {
          this.client = null;
          await client.close();
        }
        throw error;
      }
    });
  }

  /** Await an unlocked request and discard the client if it turns out dead. */
  async runCall<T>(client: LeanLSPClient, call: Promise<T>): Promise<T> {
    try {
      return await call;
    } catch (error) {
      if (isDeadClientError(error) || client.returncode !== null) {
        if (this.buildBlocking()) throw new LeanToolError(BUILD_IN_PROGRESS_MESSAGE);
        await this.clientLock.withLock(async () => {
          if (this.client === client) {
            this.client = null;
            await client.close();
          }
        });
      }
      throw error;
    }
  }

  async sweepIdleFilesOnce(): Promise<string[]> {
    return this.clientLock.withLock(async () => {
      const client = this.client;
      if (client === null) return [];
      try {
        return await client.closeIdleDocuments(this.settings.lspFileIdleTtlMs);
      } catch (error) {
        if (isDeadClientError(error) || client.returncode !== null) {
          if (this.client === client) this.client = null;
          await client.close();
        }
        return [];
      }
    });
  }

  /**
   * Convert an agent-supplied path to a project-relative one: absolute paths
   * (or the `/workspace` alias) must resolve inside the project; relative
   * paths are taken as project-relative as-is.
   */
  resolveRelativePath(filePath: string): string {
    const posix = filePath.replace(/\\/g, '/');
    const absolute = posix.startsWith('/') || /^[A-Za-z]:\//.test(posix);
    if (!absolute) return filePath;
    let resolved: string;
    try {
      resolved = resolveWorkspaceAlias(filePath, this.repositoryRoot);
    } catch {
      throw new LeanToolError(`File '${filePath}' is outside the assigned Lean project.`);
    }
    if (!isInside(this.projectRoot, resolved) || resolved === this.projectRoot) {
      throw new LeanToolError(`File '${filePath}' is outside the assigned Lean project.`);
    }
    return toPosix(resolved.slice(this.projectRoot.length + 1));
  }

  private async preparedDocument(path: string, mode: 'never' | 'once' = 'never'): Promise<[LeanLSPClient, string[]]> {
    return this.acquireClient(async (client) => {
      await client.openDocument(path, { dependencyBuildMode: mode });
      const content = await client.documentContent(path);
      return [client, splitLines(content)];
    });
  }

  private static requireLine(line: number, lines: string[]): string {
    if (line < 1 || line > lines.length) throw new LeanToolError(`Line ${line} out of range (file has ${lines.length} lines)`);
    return lines[line - 1];
  }

  private static character(context: string, column: number): number {
    // `text[:cp]` in the hosted service clamps past-the-end columns to the
    // line length; keep that so a stale cursor still yields the line's goals.
    return Math.max(0, Math.min(column, context.length));
  }

  async goal(path: string, line: number, column?: number | null, signal?: AbortSignal): Promise<GoalQuery> {
    const [client, lines] = await this.preparedDocument(path);
    const context = LeanLSPService.requireLine(line, lines);
    if (column === null || column === undefined) {
      const startMatch = /\S/.exec(context);
      const start = startMatch ? startMatch.index : 0;
      const before = await this.runCall(client, client.goal(path, { line: line - 1, character: start }, signal));
      const after = await this.runCall(client, client.goal(path, { line: line - 1, character: context.length }, signal));
      return { lineContext: context, goalsBefore: before?.goals ?? [], goalsAfter: after?.goals ?? [] };
    }
    const result = await this.runCall(client, client.goal(path, { line: line - 1, character: LeanLSPService.character(context, column - 1) }, signal));
    return { lineContext: context, goals: result?.goals ?? [] };
  }

  async termGoal(path: string, line: number, column?: number | null, signal?: AbortSignal): Promise<TermGoalQuery> {
    const [client, lines] = await this.preparedDocument(path);
    const context = LeanLSPService.requireLine(line, lines);
    const character = column === null || column === undefined ? context.length : LeanLSPService.character(context, column - 1);
    const result = await this.runCall(client, client.termGoal(path, { line: line - 1, character }, signal));
    let expected = result?.goal ?? null;
    if (expected) expected = expected.replace('```lean\n', '').replace('\n```', '');
    return { lineContext: context, expectedType: expected };
  }

  async hover(path: string, line: number, column: number, signal?: AbortSignal): Promise<HoverQuery> {
    const [client, lines] = await this.preparedDocument(path);
    const context = LeanLSPService.requireLine(line, lines);
    const result = await this.runCall(client, client.hover(path, { line: line - 1, character: LeanLSPService.character(context, column - 1) }, signal));
    if (result === null) return { contents: null, sourceRange: null };
    return { contents: result.contents, sourceRange: result.range };
  }

  async documentSymbols(path: string, signal?: AbortSignal): Promise<DocumentSymbol[]> {
    const client = await this.acquireClient(async (c) => {
      await c.openDocument(path);
      return c;
    });
    return this.runCall(client, client.documentSymbols(path, signal));
  }

  async reloadFile(path: string): Promise<void> {
    await this.acquireClient(async (client) => {
      await client.reloadDocument(path, 'once');
    });
  }

  private async declarationRange(client: LeanLSPClient, path: string, declarationName: string, signal?: AbortSignal): Promise<[number, number] | null> {
    let symbols: DocumentSymbol[];
    try {
      await client.openDocument(path);
      symbols = await client.documentSymbols(path, signal);
    } catch (error) {
      console.warn(`[lean] document_symbols failed for ${path}: ${(error as Error).message}`);
      return null;
    }
    if (!symbols.length) return null;
    const match = searchSymbols(symbols, declarationName);
    if (!match) return null;
    return [match.range.start.line + 1, match.range.end.line + 1];
  }

  /**
   * Compiler diagnostics for a file, optionally narrowed to a line range or
   * one declaration. Only authoritative full-file results replace the
   * snapshot entry; a provisional result can still merge failed imports.
   * `onSnapshot` receives the rewritten snapshot for publishing.
   */
  async diagnostics(
    path: string,
    options: { startLine?: number | null; endLine?: number | null; declarationName?: string | null; signal?: AbortSignal; onSnapshot?: (snapshot: Snapshot) => void } = {},
  ): Promise<DiagnosticsResult> {
    const absolute = join(this.projectRoot, path);
    const observedHash = sourceContentHash(absolute);
    let effectiveStart = options.startLine ?? null;
    let effectiveEnd = options.endLine ?? null;
    const client = await this.acquireClient(async (c) => {
      await c.openDocument(path);
      if (options.declarationName) {
        const range = await this.declarationRange(c, path, options.declarationName, options.signal);
        if (range === null) throw new LeanToolError(`Declaration '${options.declarationName}' not found in file.`);
        [effectiveStart, effectiveEnd] = range;
      }
      return c;
    });
    const requestedRange = lineRange(effectiveStart, effectiveEnd);
    const report = await this.runCall(
      client,
      client.diagnostics(path, { range: requestedRange, inactivityTimeoutMs: this.settings.lspInactivityTimeoutMs, signal: options.signal }),
    );
    const authoritative = diagnosticReportIsAuthoritative(report);
    const result = processDiagnostics(report.diagnostics, report.complete && !report.hasErrors, authoritative);

    const fullFileQuery = options.startLine == null && options.endLine == null && !options.declarationName;
    if (fullFileQuery && (result.complete || result.failed_dependencies.length)) {
      const contentHashes = observedHash !== null && sourceContentHash(absolute) === observedHash ? { [path]: observedHash } : {};
      const snapshot = this.mirrorDiagnosticsToSnapshot(path, result, contentHashes);
      if (snapshot) options.onSnapshot?.(snapshot);
    }
    return result;
  }

  private mirrorDiagnosticsToSnapshot(relPath: string, result: DiagnosticsResult, contentHashes: Record<string, string>): Snapshot | null {
    try {
      if (!result.complete) {
        const hash = contentHashes[relPath];
        if (result.failed_dependencies.length && hash !== undefined) {
          return mergeFailedDependencies(this.projectRoot, relPath, result.failed_dependencies, hash);
        }
        return null;
      }
      return replaceSingleFile(this.projectRoot, relPath, lspSnapshotDiagnostics(relPath, result.items, result.failed_dependencies), contentHashes);
    } catch (error) {
      console.warn(`[lean] failed to mirror diagnostics for ${relPath} into the snapshot: ${(error as Error).message}`);
      return null;
    }
  }
}
