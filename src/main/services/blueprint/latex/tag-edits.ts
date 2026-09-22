import { extractOptionalTitle, findAll, LEAN_OK_PATTERN, type Span } from './blueprint';
import { logLatexWarning } from './log';

/** One edit over the original source: replace `source[start:end]` with `replacement`. */
export type Edit = [start: number, end: number, replacement: string];

const PROOF_HEADER_TRAILING_NEWLINE = /^[ \t]*\r?\n/;
const PROOF_HEADER = /^\\begin\{proof\}/;

/** Python's `str.rfind(needle, 0, end)` for a single-character needle. */
export function rfind(text: string, needle: string, end: number): number {
  return end <= 0 ? -1 : text.lastIndexOf(needle, end - 1);
}

export function newlineStyle(source: string): string {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

export function withinAny(position: number, spans: readonly Span[]): boolean {
  return spans.some(([start, end]) => start <= position && position < end);
}

/** Apply sorted non-overlapping edits, logging and skipping any overlap. */
export function applyEdits(source: string, edits: readonly Edit[]): string {
  const pieces: string[] = [];
  let cursor = 0;
  for (const [start, end, replacement] of [...edits].sort((a, b) => a[0] - b[0])) {
    if (start < cursor) {
      logLatexWarning(`Skipping overlapping .tex edit at [${start}, ${end}); this should not happen and may leave a stale tag - please report it.`);
      continue;
    }
    pieces.push(source.slice(cursor, start), replacement);
    cursor = end;
  }
  pieces.push(source.slice(cursor));
  return pieces.join('');
}

/** Whether `position` is past an unescaped `%` on its line. */
export function isInComment(text: string, position: number): boolean {
  const lineStart = rfind(text, '\n', position) + 1;
  let index = lineStart;
  while (index < position) {
    if (text[index] === '%') {
      let backslashes = 0;
      let cursor = index - 1;
      while (cursor >= lineStart - 1 && cursor >= 0 && text[cursor] === '\\') {
        backslashes += 1;
        cursor -= 1;
      }
      if (backslashes % 2 === 0) return true;
    }
    index += 1;
  }
  return false;
}

function commentStart(text: string, lineStart: number, lineEnd: number): number {
  let index = lineStart;
  while (index < lineEnd) {
    if (text[index] === '%') {
      let backslashes = 0;
      let cursor = index - 1;
      while (cursor >= lineStart && text[cursor] === '\\') {
        backslashes += 1;
        cursor -= 1;
      }
      if (backslashes % 2 === 0) return index;
    }
    index += 1;
  }
  return lineEnd;
}

/** Coalesce marker deletions on one line so produced edits never overlap. */
function lineLeanokEdits(source: string, lineStart: number, tokens: readonly Span[]): Edit[] {
  const newlineIndex = source.indexOf('\n', tokens[tokens.length - 1][1]);
  const lineContentEnd = newlineIndex === -1 ? source.length : newlineIndex;
  const lineEnd = newlineIndex === -1 ? lineContentEnd : newlineIndex + 1;
  const codeEnd = commentStart(source, lineStart, lineContentEnd);
  const code = source.slice(lineStart, codeEnd);
  let nonWhitespace = 0;
  for (const char of code) if (char !== ' ' && char !== '\t' && char !== '\r') nonWhitespace += 1;
  const covered = tokens.reduce((total, [start, end]) => total + (end - start), 0);
  if (nonWhitespace === covered && codeEnd === lineContentEnd) return [[lineStart, lineEnd, '']];

  const edits: Edit[] = [];
  let cursor = lineStart;
  for (const [tokenStart, tokenEnd] of tokens) {
    let deleteStart = tokenStart;
    let deleteEnd = tokenEnd;
    if (tokenEnd < codeEnd && (source[tokenEnd] === ' ' || source[tokenEnd] === '\t')) deleteEnd = tokenEnd + 1;
    else if (tokenStart - 1 >= cursor && (source[tokenStart - 1] === ' ' || source[tokenStart - 1] === '\t')) deleteStart = tokenStart - 1;
    deleteStart = Math.max(deleteStart, cursor);
    edits.push([deleteStart, deleteEnd, '']);
    cursor = deleteEnd;
  }
  return edits;
}

/** Delete real standalone `\leanok` markers, excluding nested owners/comments. */
export function leanokRemovalEdits(source: string, regionStart: number, regionEnd: number, exclude: readonly Span[]): Edit[] {
  const tokensByLine = new Map<number, Span[]>();
  for (const match of findAll(LEAN_OK_PATTERN, source, regionStart, regionEnd)) {
    if (withinAny(match.index, exclude) || isInComment(source, match.index)) continue;
    const lineStart = rfind(source, '\n', match.index) + 1;
    const tokens = tokensByLine.get(lineStart) ?? [];
    tokens.push([match.index, match.index + match[0].length]);
    tokensByLine.set(lineStart, tokens);
  }
  const edits: Edit[] = [];
  for (const [lineStart, tokens] of tokensByLine) edits.push(...lineLeanokEdits(source, lineStart, tokens));
  return edits;
}

function stripLeanokCommands(text: string, preserve: readonly Span[] = []): string {
  const edits = leanokRemovalEdits(text, 0, text.length, preserve);
  return edits.length ? applyEdits(text, edits) : text;
}

function lstripSpacesAndTabs(line: string): string {
  let start = 0;
  while (start < line.length && (line[start] === ' ' || line[start] === '\t')) start += 1;
  return line.slice(start);
}

function proofLeanokIndent(proofBlock: string): string {
  for (const line of proofBlock.split('\n').slice(1)) {
    if (line.trim()) return line.slice(0, line.length - lstripSpacesAndTabs(line).length);
  }
  return '';
}

function proofHeaderEnd(proofBlock: string): number | null {
  const match = PROOF_HEADER.exec(proofBlock);
  return match === null ? null : extractOptionalTitle(proofBlock, proofBlock, match[0].length, proofBlock.length).end;
}

/** Normalize a proof's owned marker and optionally insert one after its header. */
export function rewriteProofLeanok(proofBlock: string, wantLeanok: boolean, newline: string, preserve: readonly Span[] = []): string {
  const without = stripLeanokCommands(proofBlock, preserve);
  if (!wantLeanok) return without;
  const headerEnd = proofHeaderEnd(without);
  if (headerEnd === null) return without;
  const indent = proofLeanokIndent(without);
  let rest = without.slice(headerEnd);
  const trailingNewline = PROOF_HEADER_TRAILING_NEWLINE.exec(rest);
  rest = trailingNewline !== null ? rest.slice(trailingNewline[0].length) : lstripSpacesAndTabs(rest);
  return `${without.slice(0, headerEnd)}${newline}${indent}\\leanok${newline}${rest}`;
}
