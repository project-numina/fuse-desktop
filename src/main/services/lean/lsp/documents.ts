/**
 * Open-document state, versioning, pinning and LRU selection for one
 * `lake serve` session. Versions are per-URI counters that survive a
 * close/reopen so the server never sees a version go backwards.
 */

import { pathToFileURL } from 'node:url';
import { isAbsolute, join } from 'node:path';
import { deferred, type Deferred } from '../async';
import { DocumentNotOpen } from './errors';
import type { LspDiagnostic, OpenDocument, Range } from './models';
import { isInside, resolveLenient } from '../paths';

export class DocumentState {
  diagnosticsVersion: number | null = null;
  diagnostics: LspDiagnostic[] = [];
  processingRanges: Range[] = [];
  processing = true;
  waitRequestComplete = false;
  progressVersion: number | null = null;
  lastActivity = Date.now();
  pinCount = 0;
  private changed: Deferred<void> = deferred();

  constructor(
    readonly path: string,
    readonly uri: string,
    public content: string,
    public version: number,
    readonly generation: number,
  ) {}

  /** Replace content and clear all version-specific state. */
  resetForVersion(content: string, version: number): void {
    this.content = content;
    this.version = version;
    this.diagnosticsVersion = null;
    this.diagnostics = [];
    this.processingRanges = [];
    this.processing = true;
    this.waitRequestComplete = false;
    this.progressVersion = null;
    this.touch();
  }

  /** Record activity and wake state waiters. */
  touch(): void {
    this.lastActivity = Date.now();
    const previous = this.changed;
    this.changed = deferred();
    previous.resolve();
  }

  /** Resolves on the next `touch()`. */
  waitForChange(): Promise<void> {
    return this.changed.promise;
  }

  snapshot(): OpenDocument {
    return { path: this.path, uri: this.uri, content: this.content, version: this.version };
  }
}

/** Canonical-URI document registry with true LRU ordering (Map insertion order). */
export class DocumentStore {
  private readonly states = new Map<string, DocumentState>();
  private readonly versions = new Map<string, number>();
  private readonly generations = new Map<string, number>();

  constructor(
    readonly projectRoot: string,
    readonly maxDocuments: number,
  ) {
    this.projectRoot = resolveLenient(projectRoot);
  }

  /** Resolve a caller path (relative to the project root) into `[absolute, uri]`. */
  resolve(path: string): [string, string] {
    const candidate = isAbsolute(path) ? path : join(this.projectRoot, path);
    const resolved = resolveLenient(candidate);
    if (!isInside(this.projectRoot, resolved)) throw new Error(`document is outside project root: ${path}`);
    return [resolved, pathToFileURL(resolved).href];
  }

  get(path: string, touch = true): DocumentState {
    const [, uri] = this.resolve(path);
    const state = this.states.get(uri);
    if (!state) throw new DocumentNotOpen(path);
    if (touch) this.touchUri(uri, state);
    return state;
  }

  getUri(uri: string, touch = false): DocumentState | null {
    const state = this.states.get(uri) ?? null;
    if (state && touch) this.touchUri(uri, state);
    return state;
  }

  private touchUri(uri: string, state: DocumentState): void {
    this.states.delete(uri);
    this.states.set(uri, state);
    state.touch();
  }

  /** Add a new generation with a monotonically increasing version. */
  add(path: string, uri: string, content: string): DocumentState {
    const version = (this.versions.get(uri) ?? -1) + 1;
    const generation = (this.generations.get(uri) ?? -1) + 1;
    this.versions.set(uri, version);
    this.generations.set(uri, generation);
    const state = new DocumentState(path, uri, content, version, generation);
    this.states.delete(uri);
    this.states.set(uri, state);
    return state;
  }

  nextVersion(state: DocumentState): number {
    const version = (this.versions.get(state.uri) ?? state.version) + 1;
    this.versions.set(state.uri, version);
    return version;
  }

  /** The least-recent unpinned document when at capacity, else null. */
  evictionCandidate(incomingUri: string): DocumentState | null {
    if (this.states.has(incomingUri) || this.states.size < this.maxDocuments) return null;
    for (const state of this.states.values()) {
      if (state.pinCount === 0) return state;
    }
    return null;
  }

  removeUri(uri: string): DocumentState | null {
    const state = this.states.get(uri) ?? null;
    this.states.delete(uri);
    return state;
  }

  /** Forget session state, waking anyone waiting on a document. */
  clear(): void {
    for (const state of this.states.values()) state.touch();
    this.states.clear();
  }

  snapshots(): OpenDocument[] {
    return [...this.states.values()].map((state) => state.snapshot());
  }

  all(): DocumentState[] {
    return [...this.states.values()];
  }

  get size(): number {
    return this.states.size;
  }
}
