import { describe, expect, it } from 'vitest';
import {
  handleServerRequest,
  initializeCapabilities,
  normalizeLspText,
  parseDocumentSymbols,
  parseGoalResult,
  parseHoverResult,
  parseTermGoalResult,
  positionParams,
} from '@main/services/lean/lsp/client-protocol';
import { LeanInitializationError, LeanLSPError, LSPServerError } from '@main/services/lean/lsp/errors';

const range = {
  start: { line: 1, character: 2 },
  end: { line: 3, character: 4 },
};

describe('LSP client protocol helpers', () => {
  it('normalizes document text and builds versioned position parameters', () => {
    expect(normalizeLspText('a\r\nb\rc')).toBe('a\nb\nc');
    expect(positionParams(
      { path: '/repo/Main.lean', uri: 'file:///repo/Main.lean', content: '', version: 3 },
      { line: 4, character: 5 },
    )).toEqual({
      textDocument: { uri: 'file:///repo/Main.lean', version: 3 },
      position: { line: 4, character: 5 },
    });
  });

  it('validates initialization and server requests', () => {
    expect(initializeCapabilities({ capabilities: { hoverProvider: true } })).toEqual({ hoverProvider: true });
    expect(() => initializeCapabilities({})).toThrow(LeanInitializationError);
    expect(handleServerRequest('client/registerCapability')).toBeNull();
    expect(() => handleServerRequest('workspace/unknown')).toThrow(LSPServerError);
  });

  it('parses goal, term-goal, and hover responses', () => {
    expect(parseGoalResult({ goals: ['⊢ True'], rendered: 'goal' })).toEqual({ goals: ['⊢ True'], rendered: 'goal' });
    expect(parseTermGoalResult({ goal: 'Nat', range })).toEqual({ goal: 'Nat', range });
    expect(parseHoverResult({ contents: { kind: 'markdown', value: '**Nat**' }, range })).toEqual({
      contents: '**Nat**',
      range,
    });
    expect(parseGoalResult(null)).toBeNull();
    expect(() => parseGoalResult({ goals: [1] })).toThrow(LeanLSPError);
  });

  it('drops invalid symbols while preserving nested valid symbols', () => {
    expect(parseDocumentSymbols([
      {
        name: 'outer',
        kind: 12,
        range,
        selectionRange: range,
        children: [{ name: 'inner', kind: 13, range, selectionRange: range }, { name: 1 }],
      },
      { name: 'missing range', kind: 12 },
    ])).toEqual([
      {
        name: 'outer',
        kind: 12,
        detail: null,
        range,
        selectionRange: range,
        children: [{ name: 'inner', kind: 13, detail: null, range, selectionRange: range, children: [] }],
      },
    ]);
  });
});
