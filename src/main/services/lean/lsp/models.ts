/** Public result types of the Lean LSP client (zero-indexed UTF-16 positions). */

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4,
}

export interface LspDiagnostic {
  range: Range;
  message: string;
  severity: DiagnosticSeverity | null;
  /** Lean extension; preferred over `range` when present. */
  fullRange: Range | null;
  source: string | null;
}

/** Prefer Lean's semantic full range when available. */
export function effectiveRange(diagnostic: LspDiagnostic): Range {
  return diagnostic.fullRange ?? diagnostic.range;
}

export interface DiagnosticReport {
  documentVersion: number;
  diagnostics: LspDiagnostic[];
  /**
   * Whether Lean finished publishing diagnostics for the requested range.
   * Protocol completion, not necessarily an elaboration verdict: an
   * imports-out-of-date header error is complete but non-authoritative.
   */
  complete: boolean;
  timedOut: boolean;
  processingRanges: Range[];
  hasErrors: boolean;
}

export interface OpenDocument {
  path: string;
  uri: string;
  content: string;
  version: number;
}

export interface GoalResult {
  rendered: string;
  goals: string[];
}

export interface TermGoalResult {
  goal: string;
  range: Range;
}

export interface HoverResult {
  contents: string;
  range: Range | null;
}

export interface DocumentSymbol {
  name: string;
  kind: number;
  range: Range;
  selectionRange: Range;
  detail: string | null;
  children: DocumentSymbol[];
}

export type DependencyBuildMode = 'never' | 'once' | 'always';

export function positionsEqual(a: Position, b: Position): boolean {
  return a.line === b.line && a.character === b.character;
}
