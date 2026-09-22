import type { MacroDict } from '@/lib/latex-macros';
import {
  findBraceAwareMathBoundary,
  findBraceBoundary,
  findDisplayMathBoundary,
  findEnvironmentBoundary,
  findInlineMathBoundary,
  readBraceArgument,
  readLatexCommand,
  readOptionalArgument,
  skipWhitespace,
  type ParsedArgument,
} from './scan-boundaries';
import {
  escapeAttributeValue,
  escapeHtmlValue,
  flushEscapedText,
  hasSafeUrlScheme,
} from './scan-primitives';
import {
  readMathLabels,
  readSectionLabel,
  readVerbatimInline,
  removeLatexComments,
  splitListItems,
} from './scan-tokens';
import {
  readDeclarationMetadata,
  resolveDeclarationStatus,
  type ResolvedStatus,
} from './declaration-parsing';
import { renderPreparedKatex } from './katex-rendering';

export interface DeclarationStatus {
  kind?: string;
  status: string;
}

export type StatusDict = Record<string, string | DeclarationStatus>;

export interface ReferenceTarget {
  kind: string;
  number: string;
}

export type ReferenceDict = Record<string, string | ReferenceTarget>;

export interface DeclarationMetadata {
  label: string;
  leanName: string;
  uses: string[];
  leanOk: boolean;
}

export function escapeHtml(text: string): string {
  return escapeHtmlValue(text);
}

export function escapeAttribute(text: string): string {
  return escapeAttributeValue(text);
}

export function isSafeUrl(url: string): boolean {
  return hasSafeUrlScheme(url);
}

/** Extract leanblueprint sidecar commands without removing visible body text. */
export function extractDeclarationMetadata(body: string): DeclarationMetadata {
  return readDeclarationMetadata(body);
}

/** Resolve backend status first, falling back to source Lean markers. */
export function resolveStatus(
  metadata: DeclarationMetadata,
  statuses: StatusDict,
): ResolvedStatus | null {
  return resolveDeclarationStatus(metadata, statuses);
}

/** Read a balanced optional argument, respecting escapes and brace-protected brackets. */
export function extractOptionalArg(
  input: string,
  pos: number,
): ParsedArgument | null {
  return readOptionalArgument(input, pos);
}

/** Split only top-level list items; nested environment items stay in their parent. */
export function splitOnItem(body: string): string[] {
  return splitListItems(body);
}

export function readTrailingLabel(input: string, pos: number): string {
  return readSectionLabel(input, pos);
}

export function stripLatexComments(source: string): string {
  return removeLatexComments(source);
}

export function readEquationLabels(body: string): string[] {
  return readMathLabels(body);
}

export function readCommandName(input: string, pos: number): [string, number] {
  return readLatexCommand(input, pos);
}

export function findMatchingBrace(input: string, pos: number): number {
  return findBraceBoundary(input, pos);
}

export function extractBraceArg(input: string, pos: number): ParsedArgument | null {
  return readBraceArgument(input, pos);
}

export function findClosingMathInline(input: string, pos: number): number {
  return findInlineMathBoundary(input, pos);
}

export function findClosingMathDisplay(input: string, pos: number): number {
  return findDisplayMathBoundary(input, pos);
}

export function findEndEnvironment(
  input: string,
  pos: number,
  envName: string,
): number {
  return findEnvironmentBoundary(input, pos, envName);
}

/** Find a slash-delimited math closer while ignoring delimiters in brace groups. */
export function findClosingMathBraceAware(
  input: string,
  pos: number,
  delimiter: string,
): number {
  return findBraceAwareMathBoundary(input, pos, delimiter);
}

export function flushText(textBuffer: string[], out: string[]): void {
  flushEscapedText(textBuffer, out);
}

export function skipOptionalWhitespace(input: string, pos: number): number {
  return skipWhitespace(input, pos);
}

/** Read listings, minted, and verbatim inline payloads without TeX interpretation. */
export function readInlineCode(
  input: string,
  pos: number,
  command: string,
): ParsedArgument | null {
  return readVerbatimInline(input, pos, command);
}

/** Render TeX after resolving document commands, or return escaped source on failure. */
export function renderKatex(
  tex: string,
  displayMode: boolean,
  macros: MacroDict,
  references: ReferenceDict = {},
): string {
  return renderPreparedKatex(tex, displayMode, macros, references);
}
