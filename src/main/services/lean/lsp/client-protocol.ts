import { pathToFileURL } from 'node:url';
import { hoverContentsMarkdown, parseRange } from './diagnostics';
import {
  LeanInitializationError,
  LeanLSPError,
  LSPServerError,
  type JSONValue,
} from './errors';
import type {
  DocumentSymbol,
  GoalResult,
  HoverResult,
  OpenDocument,
  Position,
  TermGoalResult,
} from './models';

const SUPPORTED_SERVER_REQUESTS = new Set([
  'client/registerCapability',
  'workspace/semanticTokens/refresh',
  'workspace/inlayHint/refresh',
]);

function object(value: JSONValue, method: string): Record<string, JSONValue> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new LeanLSPError(`Lean returned an invalid ${method} response`);
  }
  return value;
}

export function normalizeLspText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function initializeParams(projectRoot: string): JSONValue {
  return {
    processId: process.pid,
    rootUri: pathToFileURL(projectRoot).href,
    capabilities: {
      workspace: { configuration: true },
      textDocument: {
        publishDiagnostics: { relatedInformation: true },
        documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        hover: { contentFormat: ['markdown', 'plaintext'] },
      },
    },
    initializationOptions: { editDelay: 0, hasWidgets: false },
  };
}

export function initializeCapabilities(result: JSONValue): Record<string, JSONValue> {
  const capabilities = object(result, 'initialize').capabilities;
  if (capabilities === null || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    throw new LeanInitializationError('Lean initialize response has no capabilities object');
  }
  return capabilities;
}

export function handleServerRequest(method: string): JSONValue {
  if (SUPPORTED_SERVER_REQUESTS.has(method)) return null;
  throw new LSPServerError(-32601, `Method not found: ${method}`);
}

export function positionParams(document: OpenDocument, position: Position): JSONValue {
  return {
    textDocument: { uri: document.uri, version: document.version },
    position: { line: position.line, character: position.character },
  };
}

export function parseGoalResult(result: JSONValue): GoalResult | null {
  if (result === null || result === undefined) return null;
  const value = object(result, 'plainGoal');
  const goals = value.goals;
  if (!Array.isArray(goals) || !goals.every((item) => typeof item === 'string')) {
    throw new LeanLSPError('Lean returned an invalid plainGoal response');
  }
  return { rendered: typeof value.rendered === 'string' ? value.rendered : '', goals: goals as string[] };
}

export function parseTermGoalResult(result: JSONValue): TermGoalResult | null {
  if (result === null || result === undefined) return null;
  const value = object(result, 'plainTermGoal');
  const range = parseRange(value.range);
  if (typeof value.goal !== 'string' || !range) {
    throw new LeanLSPError('Lean returned an invalid plainTermGoal response');
  }
  return { goal: value.goal, range };
}

export function parseHoverResult(result: JSONValue): HoverResult | null {
  if (result === null || result === undefined) return null;
  const value = object(result, 'hover');
  const contents = hoverContentsMarkdown(value.contents);
  return contents === null ? null : { contents, range: parseRange(value.range) };
}

export function parseDocumentSymbols(result: JSONValue): DocumentSymbol[] {
  if (result === null || result === undefined) return [];
  if (!Array.isArray(result)) throw new LeanLSPError('Lean returned invalid document symbols');
  return result.map(parseSymbol).filter((symbol): symbol is DocumentSymbol => symbol !== null);
}

function parseSymbol(value: JSONValue): DocumentSymbol | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const { name, kind, detail } = value;
  const range = parseRange(value.range);
  const selectionRange = parseRange(value.selectionRange) ?? range;
  if (typeof name !== 'string' || typeof kind !== 'number' || !range || !selectionRange) return null;
  const children = Array.isArray(value.children)
    ? value.children.map(parseSymbol).filter((child): child is DocumentSymbol => child !== null)
    : [];
  return { name, kind, range, selectionRange, detail: typeof detail === 'string' ? detail : null, children };
}
