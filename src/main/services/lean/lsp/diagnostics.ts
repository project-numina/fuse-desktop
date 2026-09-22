/** Reduction of Lean's diagnostic and file-progress notifications into document state. */

import type { DocumentState, DocumentStore } from './documents';
import { DiagnosticSeverity, effectiveRange, type DiagnosticReport, type LspDiagnostic, type Position, type Range } from './models';
import type { JSONValue } from './errors';

/**
 * Lean stopped before elaboration because imports are stale. Deliberately
 * narrower than the similarly worded watchdog notice: the header failure is
 * an error spanning from the file start saying imports *must* be rebuilt;
 * the sticky notice says they *should* be and accompanies a valid elaboration.
 */
export function isStaleImportHeaderError(diagnostic: LspDiagnostic): boolean {
  const normalized = diagnostic.message.split(/\s+/).filter(Boolean).join(' ').toLowerCase();
  return (
    diagnostic.severity === DiagnosticSeverity.Error
    && diagnostic.range.start.line === 0
    && diagnostic.range.start.character === 0
    && normalized.includes('imports are out of date')
    && normalized.includes('must be rebuilt')
    && normalized.includes('restart file')
  );
}

/** A finished report that contains an elaboration verdict (no stale-import header). */
export function diagnosticReportIsAuthoritative(report: DiagnosticReport): boolean {
  return report.complete && !report.diagnostics.some(isStaleImportHeaderError);
}

function isRecord(value: unknown): value is Record<string, JSONValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parsePosition(value: unknown): Position | null {
  if (!isRecord(value)) return null;
  const { line, character } = value;
  if (typeof line !== 'number' || typeof character !== 'number' || !Number.isInteger(line) || !Number.isInteger(character)) return null;
  if (line < 0 || character < 0) return null;
  return { line, character };
}

export function parseRange(value: unknown): Range | null {
  if (!isRecord(value)) return null;
  const start = parsePosition(value.start);
  const end = parsePosition(value.end);
  if (!start || !end) return null;
  return { start, end };
}

/** Parse the stable subset of an LSP diagnostic. */
export function parseDiagnostic(value: unknown): LspDiagnostic | null {
  if (!isRecord(value)) return null;
  const range = parseRange(value.range);
  const message = value.message;
  if (!range || typeof message !== 'string') return null;
  const rawSeverity = value.severity;
  const severity =
    typeof rawSeverity === 'number' && Number.isInteger(rawSeverity) && rawSeverity >= 1 && rawSeverity <= 4 ? (rawSeverity as DiagnosticSeverity) : null;
  const source = value.source;
  return { range, fullRange: parseRange(value.fullRange), message, severity, source: typeof source === 'string' ? source : null };
}

function comparePositions(a: Position, b: Position): number {
  return a.line !== b.line ? a.line - b.line : a.character - b.character;
}

/** Closed-interval overlap of two LSP ranges. */
export function rangesIntersect(first: Range, second: Range): boolean {
  return comparePositions(first.start, second.end) <= 0 && comparePositions(second.start, first.end) <= 0;
}

/** Applies Lean notifications to document state in ingress order. */
export class DiagnosticTracker {
  constructor(private readonly documents: DocumentStore) {}

  reduce(method: string, params: JSONValue | undefined): void {
    if (method === 'textDocument/publishDiagnostics') this.publish(params);
    else if (method === '$/lean/fileProgress') this.progress(params);
  }

  private publish(params: JSONValue | undefined): void {
    if (!isRecord(params)) return;
    const uri = params.uri;
    if (typeof uri !== 'string') return;
    const state = this.documents.getUri(uri);
    if (!state || DiagnosticTracker.stale(params.version, state)) return;
    const values = params.diagnostics;
    if (!Array.isArray(values)) return;
    const version = params.version;
    state.diagnosticsVersion = typeof version === 'number' ? version : state.version;
    state.diagnostics = values.map(parseDiagnostic).filter((d): d is LspDiagnostic => d !== null);
    state.touch();
  }

  private progress(params: JSONValue | undefined): void {
    if (!isRecord(params)) return;
    const identifier = params.textDocument;
    if (!isRecord(identifier)) return;
    const uri = identifier.uri;
    if (typeof uri !== 'string') return;
    const state = this.documents.getUri(uri);
    const version = identifier.version;
    if (!state || DiagnosticTracker.stale(version, state)) return;
    const values = params.processing;
    if (!Array.isArray(values)) return;
    state.progressVersion = typeof version === 'number' ? version : state.version;
    state.processingRanges = values.map((item) => (isRecord(item) ? parseRange(item.range) : null)).filter((r): r is Range => r !== null);
    state.processing = values.length > 0;
    state.touch();
  }

  private static stale(version: JSONValue | undefined, state: DocumentState): boolean {
    return typeof version === 'number' && version !== state.version;
  }

  /** Record a completed waitForDiagnostics response. */
  static markWaitComplete(state: DocumentState): void {
    state.waitRequestComplete = true;
    if (state.diagnosticsVersion === null) state.diagnosticsVersion = state.version;
    state.processing = false;
    state.processingRanges = [];
    state.touch();
  }

  /** Build an immutable report for the current document version. */
  static report(state: DocumentState, requestedRange: Range | null, timedOut: boolean): DiagnosticReport {
    let diagnostics = state.diagnostics;
    if (requestedRange !== null) diagnostics = diagnostics.filter((item) => rangesIntersect(effectiveRange(item), requestedRange));
    const rangeComplete = requestedRange !== null && !state.processingRanges.some((item) => rangesIntersect(item, requestedRange));
    const versionObserved = state.diagnosticsVersion === state.version || state.progressVersion === state.version;
    const complete =
      requestedRange === null
        ? state.waitRequestComplete && !state.processing && state.diagnosticsVersion === state.version
        : rangeComplete && versionObserved && (state.waitRequestComplete || state.progressVersion === state.version);
    return {
      documentVersion: state.version,
      diagnostics: [...diagnostics],
      complete: complete && !timedOut,
      timedOut,
      processingRanges: [...state.processingRanges],
      hasErrors: diagnostics.some((item) => item.severity === DiagnosticSeverity.Error),
    };
  }
}

/** Optional one-indexed inclusive lines → LSP range (undefined when both absent). */
export function lineRange(startLine?: number | null, endLine?: number | null): Range | undefined {
  if ((startLine === null || startLine === undefined) && (endLine === null || endLine === undefined)) return undefined;
  const start = startLine !== null && startLine !== undefined ? startLine - 1 : 0;
  const end = endLine !== null && endLine !== undefined ? endLine - 1 : 2 ** 31 - 1;
  return { start: { line: start, character: 0 }, end: { line: end, character: 2 ** 31 - 1 } };
}

/** Flatten LSP hover `contents` (string, MarkedString, MarkupContent or arrays) into one markdown string. */
export function hoverContentsMarkdown(contents: unknown): string | null {
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) {
    const parts = contents.map(hoverContentsMarkdown).filter((part): part is string => !!part);
    return parts.length ? parts.join('\n\n') : null;
  }
  if (isRecord(contents)) {
    const value = contents.value;
    if (typeof value !== 'string') return null;
    const language = contents.language;
    return typeof language === 'string' && language ? `\`\`\`${language}\n${value}\n\`\`\`` : value;
  }
  return null;
}
