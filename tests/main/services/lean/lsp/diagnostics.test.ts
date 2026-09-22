import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diagnosticReportIsAuthoritative, DiagnosticTracker, hoverContentsMarkdown, isStaleImportHeaderError, lineRange, parseDiagnostic, parsePosition, parseRange, rangesIntersect } from '@main/services/lean/lsp/diagnostics';
import { DocumentStore } from '@main/services/lean/lsp/documents';
import { DiagnosticSeverity, type DiagnosticReport, type LspDiagnostic } from '@main/services/lean/lsp/models';

function sourceRange(start = 0, end = 4) {
  return { start: { line: 0, character: start }, end: { line: 0, character: end } };
}

function diagnostic(message: string, severity: DiagnosticSeverity | null = DiagnosticSeverity.Error, line = 0): LspDiagnostic {
  return { range: { start: { line, character: 0 }, end: { line, character: 1 } }, message, severity, fullRange: null, source: null };
}

function report(diagnostics: LspDiagnostic[], complete = true): DiagnosticReport {
  return { documentVersion: 0, diagnostics, complete, timedOut: !complete, processingRanges: [], hasErrors: diagnostics.some((d) => d.severity === DiagnosticSeverity.Error) };
}

describe('parsers', () => {
  it('reject malformed values', () => {
    expect(parsePosition(null)).toBeNull();
    expect(parsePosition({ line: '0', character: 0 })).toBeNull();
    expect(parsePosition({ line: -1, character: 0 })).toBeNull();
    expect(parseRange([])).toBeNull();
    expect(parseRange({ start: {}, end: {} })).toBeNull();
    expect(parseDiagnostic('bad')).toBeNull();
    expect(parseDiagnostic({ range: sourceRange(), message: 2 })).toBeNull();
  });

  it('preserve the supported fields', () => {
    const parsed = parseDiagnostic({ range: sourceRange(), fullRange: sourceRange(1, 3), message: 'warning', severity: 2, source: 'lean' });
    expect(parsed?.severity).toBe(DiagnosticSeverity.Warning);
    expect(parsed?.source).toBe('lean');
    expect(parsed?.fullRange).toEqual(sourceRange(1, 3));
    const unknown = parseDiagnostic({ range: sourceRange(), message: 'unknown', severity: 99, source: 1 });
    expect(unknown?.severity).toBeNull();
    expect(unknown?.source).toBeNull();
  });
});

describe('stale import header', () => {
  it('makes a report non-authoritative', () => {
    const header = diagnostic('Lean worker: Imports are out of date and must be rebuilt;\nuse the "Restart File" command in your editor.');
    expect(isStaleImportHeaderError(header)).toBe(true);
    expect(diagnosticReportIsAuthoritative(report([header]))).toBe(false);
  });

  it.each([
    diagnostic('Imports are out of date and should be rebuilt; use the "Restart File" command in your editor.', DiagnosticSeverity.Information),
    diagnostic('Imports are out of date and must be rebuilt; use the "Restart File" command in your editor.', DiagnosticSeverity.Information),
    diagnostic('Imports are out of date and must be rebuilt; use the "Restart File" command in your editor.', DiagnosticSeverity.Error, 1),
    diagnostic("unknown module prefix 'MissingImport'"),
  ])('leaves other diagnostics authoritative', (item) => {
    expect(isStaleImportHeaderError(item)).toBe(false);
    expect(diagnosticReportIsAuthoritative(report([item]))).toBe(true);
  });
});

describe('DiagnosticTracker', () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'fuse-tracker-')));
    writeFileSync(join(root, 'Main.lean'), '');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function open() {
    const store = new DocumentStore(root, 2);
    const [resolved, uri] = store.resolve('Main.lean');
    const state = store.add(resolved, uri, '');
    return { store, state, tracker: new DiagnosticTracker(store) };
  }

  it('ignores invalid and stale notifications', () => {
    const { state, tracker } = open();
    tracker.reduce('ignored', {});
    tracker.reduce('textDocument/publishDiagnostics', []);
    tracker.reduce('textDocument/publishDiagnostics', { uri: 3 });
    tracker.reduce('textDocument/publishDiagnostics', { uri: state.uri, version: state.version - 1, diagnostics: [] });
    tracker.reduce('textDocument/publishDiagnostics', { uri: state.uri, diagnostics: 'bad' });
    tracker.reduce('$/lean/fileProgress', []);
    tracker.reduce('$/lean/fileProgress', { textDocument: [] });
    tracker.reduce('$/lean/fileProgress', { textDocument: { uri: 3 } });
    tracker.reduce('$/lean/fileProgress', { textDocument: { uri: state.uri, version: state.version - 1 }, processing: [] });
    tracker.reduce('$/lean/fileProgress', { textDocument: { uri: state.uri }, processing: 'bad' });
    expect(state.diagnosticsVersion).toBeNull();
    expect(state.progressVersion).toBeNull();
  });

  it('filters range-scoped reports and applies the completeness rules', () => {
    const { state, tracker } = open();
    tracker.reduce('textDocument/publishDiagnostics', {
      uri: state.uri,
      version: state.version,
      diagnostics: [{ range: sourceRange(1, 2), message: 'error', severity: 1 }, { range: sourceRange(8, 9), message: 'outside' }, { message: 'invalid' }],
    });
    tracker.reduce('$/lean/fileProgress', { textDocument: { uri: state.uri, version: state.version }, processing: [{ range: sourceRange(8, 10) }, { range: 'bad' }, 4] });
    const requested = { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } };
    const ranged = DiagnosticTracker.report(state, requested, false);
    expect(ranged.complete).toBe(true);
    expect(ranged.hasErrors).toBe(true);
    expect(ranged.diagnostics).toHaveLength(1);
    expect(rangesIntersect(requested, ranged.diagnostics[0].range)).toBe(true);
    expect(rangesIntersect(requested, { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } })).toBe(false);

    // Whole file: still processing → incomplete until the wait request lands.
    expect(DiagnosticTracker.report(state, null, false).complete).toBe(false);
    DiagnosticTracker.markWaitComplete(state);
    expect(DiagnosticTracker.report(state, null, false).complete).toBe(true);
    const timedOut = DiagnosticTracker.report(state, null, true);
    expect(timedOut.complete).toBe(false);
    expect(timedOut.timedOut).toBe(true);
  });

  it('keeps protocol completion for a stale-import report', () => {
    const { state, tracker } = open();
    tracker.reduce('textDocument/publishDiagnostics', {
      uri: state.uri,
      version: state.version,
      diagnostics: [{ range: sourceRange(), message: 'Imports are out of date and must be rebuilt; use the "Restart File" command in your editor.', severity: 1 }],
    });
    DiagnosticTracker.markWaitComplete(state);
    const full = DiagnosticTracker.report(state, null, false);
    expect(full.complete).toBe(true);
    expect(diagnosticReportIsAuthoritative(full)).toBe(false);
    expect(full.diagnostics[0].message).toContain('Restart File');
    const ranged = DiagnosticTracker.report(state, { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } }, false);
    expect(ranged.complete).toBe(true);
    expect(ranged.diagnostics).toEqual([]);
    expect(diagnosticReportIsAuthoritative(ranged)).toBe(true);
  });

  it('wakes change waiters and resets state on a new version', async () => {
    const { store, state, tracker } = open();
    const changed = state.waitForChange();
    tracker.reduce('$/lean/fileProgress', { textDocument: { uri: state.uri }, processing: [] });
    await changed;
    expect(state.processing).toBe(false);
    state.resetForVersion('new', store.nextVersion(state));
    expect(state.version).toBe(1);
    expect(state.processing).toBe(true);
    expect(state.diagnosticsVersion).toBeNull();
  });
});

describe('lineRange', () => {
  it('converts one-indexed inclusive lines', () => {
    expect(lineRange(null, null)).toBeUndefined();
    expect(lineRange(3, null)).toEqual({ start: { line: 2, character: 0 }, end: { line: 2 ** 31 - 1, character: 2 ** 31 - 1 } });
    expect(lineRange(null, 4)).toEqual({ start: { line: 0, character: 0 }, end: { line: 3, character: 2 ** 31 - 1 } });
  });
});

describe('hoverContentsMarkdown', () => {
  it('flattens every LSP shape', () => {
    expect(hoverContentsMarkdown(null)).toBeNull();
    expect(hoverContentsMarkdown('hi')).toBe('hi');
    expect(hoverContentsMarkdown({ value: 'body' })).toBe('body');
    expect(hoverContentsMarkdown({ kind: 'markdown', value: 'body' })).toBe('body');
    expect(hoverContentsMarkdown({ language: 'lean', value: 'x : Nat' })).toBe('```lean\nx : Nat\n```');
    expect(hoverContentsMarkdown(['a', { value: 'b' }, null])).toBe('a\n\nb');
    expect(hoverContentsMarkdown(123)).toBeNull();
    expect(hoverContentsMarkdown([])).toBeNull();
  });
});
