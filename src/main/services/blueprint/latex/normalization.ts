import { maskLatexComments } from './comments';
import {
  capture,
  findAll,
  LEAN_FILE_PATTERN,
  LEAN_OK_PATTERN,
  LEAN_PATTERN,
  mergeRanges,
  PROOF_TAG_PATTERN,
  PROVES_PATTERN,
  type Span,
  USES_PATTERN,
} from './grammar';

const STATEMENT_METADATA_PATTERNS: readonly RegExp[] = [
  /\\label\{[^}]*\}\n?/,
  /\\lean\{[^}]*\}\n?/,
  /\\leanfile\{[^}]*\}\n?/,
  /\\leanok(?![A-Za-z])[ \t]*\r?\n?/,
  /\\notready\s*\n?/,
  /\\ready\s*\n?/,
  /\\uses\{[^}]*\}\n?/,
  /\\proves\{[^}]*\}\n?/,
];

export const PROOF_METADATA_PATTERNS: readonly RegExp[] = [USES_PATTERN, LEAN_OK_PATTERN, PROVES_PATTERN];

export interface NormalizedStatement {
  statement: string;
  uses: string[];
  leanName: string;
  leanFile: string;
  statementLeanok: boolean;
}

export function countNewlines(text: string, end: number): number {
  let count = 0;
  let index = text.indexOf('\n');
  while (index !== -1 && index < end) {
    count += 1;
    index = text.indexOf('\n', index + 1);
  }
  return count;
}

export function hasLeanok(text: string): boolean {
  return LEAN_OK_PATTERN.test(maskLatexComments(text));
}

/** Outermost proof spans; nested proof blocks are removed as a unit. */
export function proofSpans(structure: string): Span[] {
  const spans: Span[] = [];
  let depth = 0;
  let start = 0;
  for (const tag of findAll(PROOF_TAG_PATTERN, structure)) {
    if (tag[1] === 'begin') {
      if (depth === 0) start = tag.index;
      depth += 1;
    } else if (depth > 0 && --depth === 0) {
      let end = tag.index + tag[0].length;
      if (structure.startsWith('\n', end)) end += 1;
      spans.push([start, end]);
    }
  }
  return spans;
}

export function removeSpans(text: string, structure: string, spans: readonly Span[]): [string, string] {
  if (spans.length === 0) return [text, structure];
  const textParts: string[] = [];
  const structureParts: string[] = [];
  let cursor = 0;
  for (const [start, end] of spans) {
    textParts.push(text.slice(cursor, start));
    structureParts.push(structure.slice(cursor, start));
    cursor = end;
  }
  textParts.push(text.slice(cursor));
  structureParts.push(structure.slice(cursor));
  return [textParts.join(''), structureParts.join('')];
}

export function removeMatches(text: string, structure: string, patterns: readonly RegExp[]): string {
  const ranges = patterns.flatMap((pattern) =>
    findAll(pattern, structure).map((match): Span => [match.index, match.index + match[0].length]),
  );
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

export function extractUses(text: string, matches: readonly RegExpExecArray[]): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    for (const item of capture(text, match).split(',')) {
      const label = item.trim();
      if (!label || seen.has(label)) continue;
      seen.add(label);
      labels.push(label);
    }
  }
  return labels;
}

export function normalizeStatement(body: string, structure: string): NormalizedStatement {
  const [statementRegion, statementStructure] = removeSpans(body, structure, proofSpans(structure));
  return {
    statement: removeMatches(statementRegion, statementStructure, STATEMENT_METADATA_PATTERNS).trim(),
    uses: extractUses(statementRegion, findAll(USES_PATTERN, statementStructure)),
    leanName: capture(body, LEAN_PATTERN.exec(structure)),
    leanFile: capture(body, LEAN_FILE_PATTERN.exec(structure)),
    statementLeanok: hasLeanok(statementRegion),
  };
}
