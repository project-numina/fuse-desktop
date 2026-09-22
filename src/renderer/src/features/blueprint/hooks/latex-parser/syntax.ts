import { declarationRequiresProof } from '@/lib/declaration-kind';

export const DECLARATION_KINDS = [
  'theorem',
  'lemma',
  'corollary',
  'definition',
  'proposition',
  'axiom',
  'conjecture',
  'example',
  'remark',
  'hypothesis',
  'claim',
  'assumption',
  'notation',
] as const;

export const KINDS_PATTERN = DECLARATION_KINDS.join('|');
export const LEANOK_PATTERN = /\\leanok(?![A-Za-z])/;
export const LABEL_PATTERN = /\\label\{([^}]*)\}/d;
export const LEAN_PATTERN = /\\lean\{([^}]*)\}/d;
export const LEANFILE_PATTERN = /\\leanfile\{([^}]*)\}/d;
export const USES_PATTERN = /\\uses\{([^}]*)\}/d;
export const PROOF_PATTERN_GLOBAL = /\\begin\{proof\}[\s\S]*?\\end\{proof\}/g;
export const PROOF_TAG_PATTERN = /\\(begin|end)\{proof\}/g;

export const STATEMENT_STRIP_PATTERNS = [
  /\\label\{[^}]*\}\n?/g,
  /\\lean\{[^}]*\}\n?/g,
  /\\leanfile\{[^}]*\}\n?/g,
  /\\leanok(?![A-Za-z])[ \t]*\r?\n?/g,
  /\\notready\s*\n?/g,
  /\\ready\s*\n?/g,
  /\\uses\{[^}]*\}\n?/g,
  /\\proves\{[^}]*\}\n?/g,
  /\\begin\{proof\}[\s\S]*?\\end\{proof\}\n?/g,
];

export const PROOF_STRIP_PATTERNS = [
  /\\uses\{[^}]*\}/g,
  /\\leanok(?![A-Za-z])/g,
  /\\proves\{[^}]*\}/g,
];

function urlishSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  const pattern = /\\(?:url|nolinkurl|path|href)\b\s*\{/g;
  for (const match of text.matchAll(pattern)) {
    let depth = 1;
    let cursor = (match.index ?? 0) + match[0].length;
    while (cursor < text.length && text[cursor] !== '\n' && text[cursor] !== '\r' && depth > 0) {
      if (text[cursor] === '{') depth++;
      else if (text[cursor] === '}') depth--;
      cursor++;
    }
    spans.push([match.index ?? 0, cursor]);
  }
  return spans;
}

/** Masks comments without changing offsets used to slice the original source. */
export function maskLatexComments(text: string): string {
  const masked = text.split('');
  const preservedSpans = urlishSpans(text);
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '%') continue;
    if (preservedSpans.some(([start, end]) => start <= index && index < end)) continue;
    let backslashes = 0;
    let cursor = index - 1;
    while (cursor >= 0 && text[cursor] === '\\') {
      backslashes++;
      cursor--;
    }
    if (backslashes % 2 === 1) continue;
    while (index < text.length && text[index] !== '\n') {
      masked[index] = ' ';
      index++;
    }
  }
  return masked.join('');
}

export function hasLeanok(text: string): boolean {
  return LEANOK_PATTERN.test(maskLatexComments(text));
}

function mergeRanges(ranges: [number, number][]): [number, number][] {
  const merged: [number, number][] = [];
  for (const [start, end] of [...ranges].sort((left, right) => left[0] - right[0])) {
    const previous = merged[merged.length - 1];
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

export function removeMatches(text: string, structure: string, patterns: RegExp[]): string {
  const ranges: [number, number][] = [];
  for (const pattern of patterns) {
    for (const match of structure.matchAll(pattern)) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  if (ranges.length === 0) return text;
  const parts: string[] = [];
  let cursor = 0;
  for (const [start, end] of mergeRanges(ranges)) {
    parts.push(text.slice(cursor, start));
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return parts.join('');
}

export function capture(text: string, match: RegExpMatchArray | null): string {
  const span = match?.indices?.[1];
  return span ? text.slice(span[0], span[1]) : '';
}

export function deriveLeanokStatus(
  kind: string,
  hasProof: boolean,
  statementLeanok: boolean,
  proofLeanok: boolean,
): string {
  if (hasProof) {
    if (proofLeanok) return 'proved';
    if (statementLeanok) return 'in_progress';
    return 'not_started';
  }
  if (!statementLeanok) return 'not_started';
  return declarationRequiresProof(kind) ? 'in_progress' : 'proved';
}

export function extractOptionalTitle(
  source: string,
  position: number,
  structure: string = source,
  limit: number = structure.length,
): { title: string | null; end: number } {
  const scanEnd = Math.min(limit, structure.length);
  let cursor = position;
  while (cursor < scanEnd && /\s/.test(structure[cursor])) cursor++;
  if (cursor >= scanEnd || structure[cursor] !== '[') return { title: null, end: position };

  const titleStart = cursor + 1;
  let bracketDepth = 1;
  let inMath = false;
  let firstCloseAny: number | null = null;
  let firstCloseOutsideMath: number | null = null;
  cursor = titleStart;
  while (cursor < scanEnd) {
    const character = structure[cursor];
    if (character === '\\') {
      cursor += 2;
      continue;
    }
    if (character === '$') inMath = !inMath;
    else if (character === '[' && !inMath) bracketDepth++;
    else if (character === ']') {
      if (firstCloseAny === null) firstCloseAny = cursor;
      if (!inMath) {
        if (firstCloseOutsideMath === null) firstCloseOutsideMath = cursor;
        bracketDepth--;
        if (bracketDepth === 0) return { title: source.slice(titleStart, cursor), end: cursor + 1 };
      }
    }
    cursor++;
  }

  const fallbackClose = firstCloseOutsideMath ?? firstCloseAny;
  if (fallbackClose !== null) {
    return { title: source.slice(titleStart, fallbackClose), end: fallbackClose + 1 };
  }
  return { title: null, end: position };
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
      depth++;
      position = nextBegin + beginTag.length;
    } else {
      depth--;
      if (depth === 0) return nextEnd + endTag.length;
      position = nextEnd + endTag.length;
    }
  }
  return null;
}

function extendThroughTrailingProof(structure: string, end: number, limit: number): number {
  const match = structure.slice(end, limit).match(/^\s*\\begin\{proof\}[\s\S]*?\\end\{proof\}/);
  return match ? end + match[0].length : end;
}

export function nestedDeclarationSpans(
  source: string,
  structure: string,
  bodyStart: number,
  bodyEnd: number,
): [number, number][] {
  const nestedPattern = new RegExp(`\\\\begin\\{(${KINDS_PATTERN})\\}`, 'g');
  const ranges: [number, number][] = [];
  for (const nestedMatch of structure.slice(bodyStart, bodyEnd).matchAll(nestedPattern)) {
    const matchStart = bodyStart + nestedMatch.index;
    const matchEnd = matchStart + nestedMatch[0].length;
    const nestedBodyStart = extractOptionalTitle(source, matchEnd, structure).end;
    const nestedEnd = findMatchingEnd(structure, nestedBodyStart, nestedMatch[1]);
    if (nestedEnd === null || nestedEnd > bodyEnd) continue;
    ranges.push([matchStart, extendThroughTrailingProof(structure, nestedEnd, bodyEnd)]);
  }
  return mergeRanges(ranges);
}

export function cutSpans(
  source: string,
  structure: string,
  bodyStart: number,
  bodyEnd: number,
  spans: [number, number][],
): { body: string; structure: string } {
  if (spans.length === 0) {
    return { body: source.slice(bodyStart, bodyEnd), structure: structure.slice(bodyStart, bodyEnd) };
  }
  const bodyParts: string[] = [];
  const structureParts: string[] = [];
  let cursor = bodyStart;
  for (const [start, end] of spans) {
    bodyParts.push(source.slice(cursor, start), '\n');
    structureParts.push(structure.slice(cursor, start), '\n');
    cursor = end;
  }
  bodyParts.push(source.slice(cursor, bodyEnd));
  structureParts.push(structure.slice(cursor, bodyEnd));
  return { body: bodyParts.join(''), structure: structureParts.join('') };
}

export function onlyWhitespaceBetween(source: string, start: number, end: number): boolean {
  for (let index = start; index < end; index++) {
    if (!/\s/.test(source[index])) return false;
  }
  return true;
}
