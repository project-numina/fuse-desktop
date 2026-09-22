import { DECLARATION_KINDS } from './blueprint-model';

export const BEGIN_PATTERN = new RegExp('\\\\begin\\{(' + DECLARATION_KINDS.join('|') + ')\\}');
export const LABEL_PATTERN = /\\label\{([^}]*)\}/d;
export const LEAN_PATTERN = /\\lean\{([^}]*)\}/d;
export const LEAN_FILE_PATTERN = /\\leanfile\{([^}]*)\}/d;
export const USES_PATTERN = /\\uses\{([^}]*)\}/d;
export const PROOF_TAG_PATTERN = /\\(begin|end)\{proof\}/;
export const PROVES_PATTERN = /\\proves\{([^}]*)\}/d;
export const LEAN_OK_PATTERN = /\\leanok(?![A-Za-z])/;

const PY_SPACE_CLASS = ' \\t\\n\\v\\f\\r\\x1c-\\x1f\\x85\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const PY_SPACE_PATTERN = new RegExp(`[${PY_SPACE_CLASS}]`);
const NON_PY_SPACE_PATTERN = new RegExp(`[^${PY_SPACE_CLASS}]`);
const TRAILING_PROOF_START_PATTERN = new RegExp(`[${PY_SPACE_CLASS}]*\\\\begin\\{proof\\}`, 'y');

/** A half-open `[start, end)` offset range. */
export type Span = [number, number];

export function isPythonSpace(character: string): boolean {
  return PY_SPACE_PATTERN.test(character);
}

export function isOnlyPythonSpace(text: string): boolean {
  return !NON_PY_SPACE_PATTERN.test(text);
}

function globalClone(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
}

/** Match within `[start, end)` without allowing a match to cross `end`. */
export function findAll(pattern: RegExp, text: string, start = 0, end = text.length): RegExpExecArray[] {
  const scoped = end < text.length ? text.slice(0, end) : text;
  const clone = globalClone(pattern);
  clone.lastIndex = start;
  const matches: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  while ((match = clone.exec(scoped)) !== null) matches.push(match);
  return matches;
}

export function findFirst(pattern: RegExp, text: string, start = 0, end = text.length): RegExpExecArray | null {
  const scoped = end < text.length ? text.slice(0, end) : text;
  const clone = globalClone(pattern);
  clone.lastIndex = start;
  return clone.exec(scoped);
}

export function capture(text: string, match: RegExpExecArray | null): string {
  if (match === null) return '';
  const span = match.indices?.[1];
  return span ? text.slice(span[0], span[1]) : '';
}

export function bisectLeft(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Optional titles ignore brackets inside inline math and tolerate malformed nesting. */
export function extractOptionalTitle(
  source: string,
  structure: string,
  position: number,
  limit?: number,
): { title: string | null; end: number } {
  const scanEnd = limit === undefined ? structure.length : Math.min(limit, structure.length);
  const cursor = skipPythonSpace(structure, position, scanEnd);
  if (cursor >= scanEnd || structure[cursor] !== '[') return { title: null, end: position };
  return scanTitle(source, structure, cursor + 1, scanEnd, position);
}

function skipPythonSpace(structure: string, position: number, limit: number): number {
  let cursor = position;
  while (cursor < limit && isPythonSpace(structure[cursor])) cursor += 1;
  return cursor;
}

function scanTitle(
  source: string,
  structure: string,
  titleStart: number,
  scanEnd: number,
  fallbackEnd: number,
): { title: string | null; end: number } {
  let depth = 1;
  let inMath = false;
  let firstCloseAny: number | null = null;
  let firstCloseOutsideMath: number | null = null;
  for (let cursor = titleStart; cursor < scanEnd; cursor += 1) {
    const character = structure[cursor];
    if (character === '\\') cursor += 1;
    else if (character === '$') inMath = !inMath;
    else if (character === '[' && !inMath) depth += 1;
    else if (character === ']') {
      firstCloseAny ??= cursor;
      if (!inMath && --depth === 0) return { title: source.slice(titleStart, cursor), end: cursor + 1 };
      if (!inMath) firstCloseOutsideMath ??= cursor;
    }
  }
  const close = firstCloseOutsideMath ?? firstCloseAny;
  return close === null ? { title: null, end: fallbackEnd } : { title: source.slice(titleStart, close), end: close + 1 };
}

export function findMatchingEnd(structure: string, start: number, kind: string): number | null {
  const beginTag = `\\begin{${kind}}`;
  const endTag = `\\end{${kind}}`;
  let depth = 1;
  let position = start;
  while (position < structure.length) {
    const nextBegin = structure.indexOf(beginTag, position);
    const nextEnd = structure.indexOf(endTag, position);
    if (nextEnd === -1) return null;
    if (nextBegin !== -1 && nextBegin < nextEnd) {
      depth += 1;
      position = nextBegin + beginTag.length;
    } else if (--depth === 0) return nextEnd + endTag.length;
    else position = nextEnd + endTag.length;
  }
  return null;
}

function matchingProofEnd(structure: string, bodyStart: number): number | null {
  let depth = 1;
  for (const tag of findAll(PROOF_TAG_PATTERN, structure, bodyStart)) {
    if (tag[1] === 'begin') depth += 1;
    else if (--depth === 0) return tag.index + tag[0].length;
  }
  return null;
}

function proofExtendedEnd(structure: string, end: number, limit: number): number {
  const pattern = new RegExp(TRAILING_PROOF_START_PATTERN.source, 'y');
  pattern.lastIndex = end;
  const match = pattern.exec(structure);
  if (match === null) return end;
  const close = matchingProofEnd(structure, match.index + match[0].length);
  return close === null || close > limit ? end : close;
}

export function mergeRanges(ranges: readonly Span[]): Span[] {
  const merged: Span[] = [];
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [start, end] of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** Nested declarations own an immediately following proof within the same body. */
export function nestedDeclarationSpans(source: string, structure: string, bodyStart: number, bodyEnd: number): Span[] {
  const spans: Span[] = [];
  for (const match of findAll(BEGIN_PATTERN, structure, bodyStart, bodyEnd)) {
    const { end: nestedStart } = extractOptionalTitle(source, structure, match.index + match[0].length);
    const nestedEnd = findMatchingEnd(structure, nestedStart, match[1]);
    if (nestedEnd !== null && nestedEnd <= bodyEnd) {
      spans.push([match.index, proofExtendedEnd(structure, nestedEnd, bodyEnd)]);
    }
  }
  return mergeRanges(spans);
}

/** Cut aligned spans from source and masked structure, replacing each with one LF. */
export function cutSpans(
  source: string,
  structure: string,
  bodyStart: number,
  bodyEnd: number,
  spans: readonly Span[],
): [string, string] {
  if (spans.length === 0) return [source.slice(bodyStart, bodyEnd), structure.slice(bodyStart, bodyEnd)];
  const sourceParts: string[] = [];
  const structureParts: string[] = [];
  let cursor = bodyStart;
  for (const [start, end] of spans) {
    sourceParts.push(source.slice(cursor, start), '\n');
    structureParts.push(structure.slice(cursor, start), '\n');
    cursor = end;
  }
  sourceParts.push(source.slice(cursor, bodyEnd));
  structureParts.push(structure.slice(cursor, bodyEnd));
  return [sourceParts.join(''), structureParts.join('')];
}
