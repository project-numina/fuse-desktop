/**
 * One correct session with one `lake serve` process: process lifecycle,
 * initialize handshake, document open/sync/close with LRU eviction and
 * pinning, the diagnostics wait loop, and the position queries the Infoview
 * needs (`$/lean/plainGoal`, `$/lean/plainTermGoal`, `textDocument/hover`).
 */

import type { ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { AbortError, AsyncLock, sleep } from '../async';
import { DiagnosticTracker } from './diagnostics';
import { DocumentStore, type DocumentState } from './documents';
import { LeanInitializationError, LeanProcessError, LeanProcessExited, LSPRequestTimeout, LSPTransportClosed, type JSONValue } from './errors';
import { MISSING_PARAMS } from './framing';
import type { DependencyBuildMode, DiagnosticReport, DocumentSymbol, GoalResult, HoverResult, OpenDocument, Position, Range, TermGoalResult } from './models';
import { LspTransport } from './transport';
import {
  handleServerRequest,
  initializeCapabilities,
  initializeParams,
  normalizeLspText,
  parseDocumentSymbols,
  parseGoalResult,
  parseHoverResult,
  parseTermGoalResult,
  positionParams,
} from './client-protocol';
import { isDirectory } from '../build/snapshot';
import { killProcessGroupNow, leanProcessEnv, spawnLeanTool, terminateProcessGroup } from '../process';
import { DEFAULT_LEAN_SETTINGS, type LeanBuildSettings } from '../settings';

export interface LeanLSPConfig {
  projectRoot: string;
  maxOpenDocuments?: number;
  requestTimeoutMs?: number;
  initializationTimeoutMs?: number;
  diagnosticsTimeoutMs?: number;
  diagnosticsInactivityTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  reportDelayMs?: number;
  stderrTailBytes?: number;
  settings?: LeanBuildSettings;
  /** Test seam: spawn something other than `lake serve`. */
  spawn?: (projectRoot: string, args: string[], env: NodeJS.ProcessEnv) => ChildProcess;
}

type ResolvedConfig = Required<Omit<LeanLSPConfig, 'spawn'>> & { spawn?: LeanLSPConfig['spawn'] };

export class LeanLSPClient {
  readonly config: ResolvedConfig;
  private readonly documents: DocumentStore;
  private readonly tracker: DiagnosticTracker;
  private transport: LspTransport | null = null;
  private child: ChildProcess | null = null;
  private exitCode: number | null = null;
  private exited = false;
  private readonly stderrChunks: Buffer[] = [];
  private stderrLength = 0;
  private readonly startLock = new AsyncLock();
  // Serializes open/close/evict so the server always sees a consistent
  // sequence of didOpen/didChange/didClose per document.
  private readonly documentLock = new AsyncLock();
  private started = false;
  private closing = false;
  private closePromise: Promise<void> | null = null;
  private capabilitiesValue: Record<string, JSONValue> = {};
  private readonly exitListeners = new Set<(error: LeanProcessExited) => void>();
  private unpinWaiters: Array<() => void> = [];

  constructor(config: LeanLSPConfig) {
    const settings = config.settings ?? DEFAULT_LEAN_SETTINGS;
    this.config = {
      projectRoot: config.projectRoot,
      maxOpenDocuments: config.maxOpenDocuments ?? settings.lspMaxOpenedFiles,
      requestTimeoutMs: config.requestTimeoutMs ?? 120_000,
      initializationTimeoutMs: config.initializationTimeoutMs ?? 60_000,
      diagnosticsTimeoutMs: config.diagnosticsTimeoutMs ?? 300_000,
      diagnosticsInactivityTimeoutMs: config.diagnosticsInactivityTimeoutMs ?? settings.lspInactivityTimeoutMs,
      shutdownTimeoutMs: config.shutdownTimeoutMs ?? 5_000,
      reportDelayMs: config.reportDelayMs ?? 0,
      stderrTailBytes: config.stderrTailBytes ?? 65_536,
      settings,
      spawn: config.spawn,
    };
    if (this.config.maxOpenDocuments < 1) throw new Error('maxOpenDocuments must be positive');
    this.documents = new DocumentStore(this.config.projectRoot, this.config.maxOpenDocuments);
    this.tracker = new DiagnosticTracker(this.documents);
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  /** The `lake serve` exit code, or null while running (or not started). */
  get returncode(): number | null {
    return this.exited ? (this.exitCode ?? -1) : null;
  }

  get capabilities(): Record<string, JSONValue> {
    return { ...this.capabilitiesValue };
  }

  get openDocuments(): OpenDocument[] {
    return this.documents.snapshots();
  }

  get stderrTail(): string {
    return Buffer.concat(this.stderrChunks).toString('utf8');
  }

  onExit(listener: (error: LeanProcessExited) => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  /** Start, initialize and announce the client. */
  async start(): Promise<void> {
    await this.startLock.withLock(async () => {
      if (this.closing) throw new LSPTransportClosed('Lean LSP client is closing');
      if (this.started) return;
      const root = this.config.projectRoot;
      if (!isDirectory(root)) throw new LeanProcessError(`Lean project root does not exist: ${root}`);
      const args = ['serve', '--', `-Dserver.reportDelayMs=${this.config.reportDelayMs}`];
      const env = leanProcessEnv(this.config.settings);
      let child: ChildProcess;
      try {
        child = this.config.spawn ? this.config.spawn(root, args, env) : spawnLeanTool('lake', args, { cwd: root, env });
      } catch (error) {
        throw new LeanProcessError(`failed to start lake serve: ${(error as Error).message}`);
      }
      if (!child.stdin || !child.stdout) throw new LeanProcessError('lake serve started without stdio pipes');
      this.child = child;
      child.stderr?.on('data', (chunk: Buffer) => this.appendStderr(chunk));
      child.once('exit', (code, signalName) => {
        this.exited = true;
        this.exitCode = code ?? (signalName ? 128 : -1);
        this.onProcessExit();
      });
      child.once('error', (error) => {
        if (!this.exited) {
          this.exited = true;
          this.exitCode = -1;
          this.appendStderr(Buffer.from(String(error.message)));
          this.onProcessExit();
        }
      });
      const transport = new LspTransport(child.stdin, child.stdout, {
        requestTimeoutMs: this.config.requestTimeoutMs,
        notificationReducer: (method, params) => this.tracker.reduce(method, params),
        requestHandler: (method) => handleServerRequest(method),
      });
      this.transport = transport;
      transport.start();
      try {
        const result = await transport.request('initialize', initializeParams(this.config.projectRoot), { timeoutMs: this.config.initializationTimeoutMs });
        this.capabilitiesValue = initializeCapabilities(result);
        await transport.notify('initialized', {});
      } catch (error) {
        await this.cleanupFailedStart();
        if (error instanceof LeanProcessExited) throw error;
        throw new LeanInitializationError(`Lean LSP initialization failed: ${(error as Error).message}`);
      }
      this.started = true;
    });
  }

  /**
   * Synchronous kill for app exit: `before-quit` does not wait for the
   * graceful close, and a detached `lake serve` would otherwise outlive Fuse.
   */
  killNow(): void {
    this.closing = true;
    if (this.child !== null && !this.exited) killProcessGroupNow(this.child, 'SIGTERM');
  }

  /** Gracefully close the session and its whole process tree. */
  close(): Promise<void> {
    if (this.closePromise === null) {
      this.closing = true;
      this.closePromise = this.closeImpl();
    }
    return this.closePromise;
  }

  /** Send a raw JSON-RPC request. */
  async request<T = JSONValue>(method: string, params: JSONValue = null, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
    await this.start();
    if (this.closing) throw new LSPTransportClosed('Lean LSP client is closing');
    return this.requireTransport().request<T>(method, params, options);
  }

  /** Open, synchronize (full-text didChange) or force-reopen a document. */
  async openDocument(path: string, options: { text?: string; force?: boolean; dependencyBuildMode?: DependencyBuildMode } = {}): Promise<OpenDocument> {
    await this.start();
    if (this.closing) throw new LSPTransportClosed('Lean LSP client is closing');
    const mode = options.dependencyBuildMode ?? 'never';
    if (!['never', 'once', 'always'].includes(mode)) throw new Error('invalid dependencyBuildMode');
    const [resolved, uri] = this.documents.resolve(path);
    const content = normalizeLspText(options.text ?? readFileSync(resolved, 'utf8'));
    return this.documentLock.withLock(async () => {
      const state = await this.openDocumentLocked(resolved, uri, content, options.force ?? false, mode);
      return state.snapshot();
    });
  }

  async closeDocument(path: string): Promise<void> {
    await this.documentLock.withLock(async () => {
      let state: DocumentState;
      try {
        state = this.documents.get(path, false);
      } catch {
        return;
      }
      await this.waitUntilUnpinned(state);
      await this.sendDidClose(state);
      this.documents.removeUri(state.uri);
    });
  }

  /** Force a close/open cycle (Restart File) that rebuilds stale imports once. */
  async reloadDocument(path: string, dependencyBuildMode: DependencyBuildMode = 'once'): Promise<void> {
    await this.openDocument(path, { force: true, dependencyBuildMode });
  }

  /** Lease a document so LRU and idle eviction cannot close it while `fn` runs. */
  async pinDocument<T>(path: string, fn: (document: OpenDocument) => Promise<T>): Promise<T> {
    await this.start();
    if (this.closing) throw new LSPTransportClosed('Lean LSP client is closing');
    const [resolved, uri] = this.documents.resolve(path);
    const content = normalizeLspText(readFileSync(resolved, 'utf8'));
    const state = await this.documentLock.withLock(async () => {
      const opened = await this.openDocumentLocked(resolved, uri, content, false, 'never');
      opened.pinCount += 1;
      return opened;
    });
    try {
      return await fn(state.snapshot());
    } finally {
      const current = this.documents.getUri(state.uri);
      if (current !== null && current.generation === state.generation) {
        current.pinCount -= 1;
        current.touch();
      }
      this.notifyUnpinned();
    }
  }

  async documentContent(path: string): Promise<string> {
    return (await this.openDocument(path)).content;
  }

  /** Close unpinned documents idle for longer than `idleMs`; returns their paths. */
  async closeIdleDocuments(idleMs: number): Promise<string[]> {
    if (idleMs < 0) throw new Error('idleMs cannot be negative');
    const cutoff = Date.now() - idleMs;
    const closed: string[] = [];
    await this.documentLock.withLock(async () => {
      for (const state of this.documents.all()) {
        if (state.pinCount !== 0 || state.lastActivity >= cutoff) continue;
        await this.sendDidClose(state);
        this.documents.removeUri(state.uri);
        closed.push(state.path);
      }
    });
    return closed;
  }

  /**
   * Wait for protocol-complete diagnostics or return a timed-out report.
   * A complete report can still carry the imports-out-of-date header; use
   * `diagnosticReportIsAuthoritative` for a source verdict.
   */
  diagnostics(path: string, options: { range?: Range; inactivityTimeoutMs?: number; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<DiagnosticReport> {
    return this.pinDocument(path, async (document) => {
      const state = this.documents.getUri(document.uri);
      if (!state) throw new LSPTransportClosed('document was closed during the diagnostics wait');
      return this.waitForDiagnostics(
        state,
        options.range ?? null,
        options.inactivityTimeoutMs ?? this.config.diagnosticsInactivityTimeoutMs,
        options.timeoutMs ?? this.config.diagnosticsTimeoutMs,
        options.signal,
      );
    });
  }

  /** The tactic state at a zero-indexed LSP position. */
  async goal(path: string, position: Position, signal?: AbortSignal): Promise<GoalResult | null> {
    const result = await this.pinDocument(path, (document) => this.request('$/lean/plainGoal', positionParams(document, position), { signal }));
    return parseGoalResult(result);
  }

  /** The expected term type at a position. */
  async termGoal(path: string, position: Position, signal?: AbortSignal): Promise<TermGoalResult | null> {
    const result = await this.pinDocument(path, (document) => this.request('$/lean/plainTermGoal', positionParams(document, position), { signal }));
    return parseTermGoalResult(result);
  }

  /** Normalized hover markdown, or null when Lean has nothing to show. */
  async hover(path: string, position: Position, signal?: AbortSignal): Promise<HoverResult | null> {
    const result = await this.pinDocument(path, (document) => this.request('textDocument/hover', positionParams(document, position), { signal }));
    return parseHoverResult(result);
  }

  async documentSymbols(path: string, signal?: AbortSignal): Promise<DocumentSymbol[]> {
    const result = await this.pinDocument(path, (document) => this.request('textDocument/documentSymbol', { textDocument: { uri: document.uri } }, { signal }));
    return parseDocumentSymbols(result);
  }

  private async waitForDiagnostics(state: DocumentState, requestedRange: Range | null, inactivityMs: number, absoluteMs: number, signal?: AbortSignal): Promise<DiagnosticReport> {
    const transport = this.requireTransport();
    const controller = new AbortController();
    const onOuterAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onOuterAbort, { once: true });
    let waitDone = false;
    let waitError: unknown = null;
    const waitRequest = transport
      .request('textDocument/waitForDiagnostics', { uri: state.uri, version: state.version }, { timeoutMs: absoluteMs, signal: controller.signal })
      .then(
        () => {
          waitDone = true;
        },
        (error: unknown) => {
          waitDone = true;
          waitError = error;
        },
      );
    const deadline = Date.now() + absoluteMs;
    try {
      for (;;) {
        if (signal?.aborted) throw new AbortError();
        const report = DiagnosticTracker.report(state, requestedRange, false);
        if (report.complete) return report;
        if (waitDone) {
          if (waitError instanceof LSPRequestTimeout) return DiagnosticTracker.report(state, requestedRange, true);
          if (waitError) throw waitError;
          DiagnosticTracker.markWaitComplete(state);
          return DiagnosticTracker.report(state, requestedRange, false);
        }
        const now = Date.now();
        const waitTime = Math.min(deadline - now, inactivityMs - (now - state.lastActivity));
        if (waitTime <= 0) return DiagnosticTracker.report(state, requestedRange, true);
        const outcome = await Promise.race([
          state.waitForChange().then(() => 'changed' as const),
          waitRequest.then(() => 'request' as const),
          sleep(waitTime, signal).then(() => 'timeout' as const),
        ]);
        if (outcome === 'timeout') return DiagnosticTracker.report(state, requestedRange, true);
      }
    } finally {
      signal?.removeEventListener('abort', onOuterAbort);
      if (!waitDone) controller.abort();
    }
  }

  private async evictFor(incomingUri: string): Promise<void> {
    while (!this.documents.getUri(incomingUri) && this.documents.size >= this.config.maxOpenDocuments) {
      const candidate = this.documents.evictionCandidate(incomingUri);
      if (candidate === null) {
        // Everything is pinned; wait for a lease to end.
        await new Promise<void>((resolve) => this.unpinWaiters.push(resolve));
        continue;
      }
      await this.sendDidClose(candidate);
      this.documents.removeUri(candidate.uri);
    }
  }

  private async openDocumentLocked(resolved: string, uri: string, content: string, force: boolean, mode: DependencyBuildMode): Promise<DocumentState> {
    const existing = this.documents.getUri(uri, true);
    if (existing !== null && !force) {
      if (existing.content !== content) {
        const version = this.documents.nextVersion(existing);
        existing.resetForVersion(content, version);
        await this.requireTransport().notify('textDocument/didChange', {
          textDocument: { uri, version },
          contentChanges: [{ text: content }],
        });
      }
      return existing;
    }
    if (existing !== null) {
      await this.waitUntilUnpinned(existing);
      await this.sendDidClose(existing);
      this.documents.removeUri(uri);
    }
    await this.evictFor(uri);
    const state = this.documents.add(resolved, uri, content);
    try {
      await this.requireTransport().notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'lean4', version: state.version, text: content },
        dependencyBuildMode: mode,
      });
    } catch (error) {
      this.documents.removeUri(uri);
      throw error;
    }
    return state;
  }

  private async waitUntilUnpinned(state: DocumentState): Promise<void> {
    while (state.pinCount > 0) {
      await new Promise<void>((resolve) => this.unpinWaiters.push(resolve));
    }
  }

  private notifyUnpinned(): void {
    const waiters = this.unpinWaiters;
    this.unpinWaiters = [];
    for (const wake of waiters) wake();
  }

  private async sendDidClose(state: DocumentState): Promise<void> {
    const transport = this.transport;
    if (transport !== null && !transport.closed) {
      await transport.notify('textDocument/didClose', { textDocument: { uri: state.uri } });
    }
  }

  private onProcessExit(): void {
    if (this.closing) return;
    const error = new LeanProcessExited(this.exitCode, this.stderrTail);
    this.transport?.abort(error);
    this.documents.clear();
    this.notifyUnpinned();
    for (const listener of this.exitListeners) {
      try {
        listener(error);
      } catch {
        // Listener failures must not break process bookkeeping.
      }
    }
  }

  private appendStderr(chunk: Buffer): void {
    this.stderrChunks.push(chunk);
    this.stderrLength += chunk.length;
    while (this.stderrLength > this.config.stderrTailBytes && this.stderrChunks.length > 0) {
      const overflow = this.stderrLength - this.config.stderrTailBytes;
      const first = this.stderrChunks[0];
      if (first.length <= overflow) {
        this.stderrChunks.shift();
        this.stderrLength -= first.length;
      } else {
        this.stderrChunks[0] = first.subarray(overflow);
        this.stderrLength -= overflow;
      }
    }
  }

  private async closeImpl(): Promise<void> {
    const transport = this.transport;
    if (transport !== null && !transport.closed) {
      try {
        await transport.request('shutdown', MISSING_PARAMS, { timeoutMs: this.config.shutdownTimeoutMs });
      } catch {
        // The server may already be gone.
      }
      try {
        await transport.notify('exit');
      } catch {
        // Same.
      }
    }
    const child = this.child;
    if (child !== null && !this.exited) {
      const exitedInTime = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), this.config.shutdownTimeoutMs);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve(true);
        });
        if (this.exited) {
          clearTimeout(timer);
          resolve(true);
        }
      });
      if (!exitedInTime) await terminateProcessGroup(child, 'shutdown', this.config.shutdownTimeoutMs);
    }
    if (transport !== null) await transport.close();
    this.documents.clear();
    this.notifyUnpinned();
    this.started = false;
  }

  private async cleanupFailedStart(): Promise<void> {
    this.closing = true;
    if (this.transport !== null) await this.transport.close();
    if (this.child !== null && !this.exited) await terminateProcessGroup(this.child, 'shutdown', this.config.shutdownTimeoutMs);
  }

  private requireTransport(): LspTransport {
    if (this.transport === null) throw new LSPTransportClosed('Lean LSP client is not started');
    return this.transport;
  }

}
