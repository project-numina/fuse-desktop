import {
  findAll,
  findFirst,
  LABEL_PATTERN,
  LEAN_OK_PATTERN,
  nestedDeclarationSpans,
  type ProofBlock,
  type Span,
} from './blueprint';
import type { DeclarationTags } from './tags';
import {
  leanokRemovalEdits,
  rewriteProofLeanok,
  type Edit,
  withinAny,
} from './tag-edits';

const LINE_START = '(?<![^\\n])';
const OWNED_TAG_LINE = new RegExp(
  `${LINE_START}[ \\t]*\\\\(?:lean|leanfile|uses)\\{[^}]*\\}[ \\t]*\\r?\\n|${LINE_START}[ \\t]*\\\\leanok(?![A-Za-z])[ \\t]*\\r?\\n`,
  'y',
);
const LABEL_LINE = new RegExp(`${LINE_START}([ \\t]*)\\\\label\\{([^}]+)\\}[ \\t]*\\r?\\n`);
const LEANFILE_LINE = new RegExp(`${LINE_START}[ \\t]*\\\\leanfile\\{([^}]*)\\}`);

function renderTagBlock(indent: string, tags: DeclarationTags, newline: string): string {
  const lines: string[] = [];
  if (tags.leanName) lines.push(`${indent}\\lean{${tags.leanName}}${newline}`);
  if (tags.leanFile) lines.push(`${indent}\\leanfile{${tags.leanFile}}${newline}`);
  if (tags.uses.length) lines.push(`${indent}\\uses{${tags.uses.join(', ')}}${newline}`);
  if (tags.leanok) lines.push(`${indent}\\leanok${newline}`);
  return lines.join('');
}

function consumeOwnedLines(source: string, start: number, limit: number): number {
  const scoped = limit < source.length ? source.slice(0, limit) : source;
  let cursor = start;
  while (cursor < limit) {
    OWNED_TAG_LINE.lastIndex = cursor;
    const match = OWNED_TAG_LINE.exec(scoped);
    if (match === null) break;
    cursor = match.index + match[0].length;
  }
  return cursor;
}

export function proofSpansIn(blocks: readonly ProofBlock[], bodyStart: number, bodyEnd: number): Span[] {
  return blocks.filter((block) => bodyStart <= block.start && block.start < bodyEnd).map((block) => [block.start, block.end]);
}

export function ownerLabel(source: string, bodyStart: number, bodyEnd: number, nested: readonly Span[]): string | null {
  for (const match of findAll(LABEL_PATTERN, source, bodyStart, bodyEnd)) {
    if (!withinAny(match.index, nested)) return match[1];
  }
  return null;
}

function findLabelLine(source: string, bodyStart: number, bodyEnd: number, nested: readonly Span[], label: string): [string, number, number] | null {
  for (const match of findAll(LABEL_LINE, source, bodyStart, bodyEnd)) {
    if (match[2] !== label || withinAny(match.index, nested)) continue;
    const blockStart = match.index + match[0].length;
    return [match[1], blockStart, consumeOwnedLines(source, blockStart, bodyEnd)];
  }
  return null;
}

/** Build the canonical statement tag replacement plus stray marker removals. */
export function statementEdits(
  source: string,
  bodyStart: number,
  bodyEnd: number,
  nested: readonly Span[],
  proofs: readonly Span[],
  label: string,
  tags: DeclarationTags,
  newline: string,
): Edit[] | null {
  const labelLine = findLabelLine(source, bodyStart, bodyEnd, nested, label);
  if (labelLine === null) return null;
  const [indent, blockStart, blockEnd] = labelLine;
  let effective = tags;
  if (!tags.leanFile) {
    const existing = findFirst(LEANFILE_LINE, source, blockStart, blockEnd);
    if (existing !== null) effective = { ...tags, leanFile: existing[1] };
  }
  const edits: Edit[] = [[blockStart, blockEnd, renderTagBlock(indent, effective, newline)]];
  edits.push(...leanokRemovalEdits(source, bodyStart, bodyEnd, [[blockStart, blockEnd], ...nested, ...proofs]));
  return edits;
}

/** Normalize an attributed proof, or create the canonical missing-proof stub. */
export function proofEdit(
  source: string,
  envEnd: number,
  block: ProofBlock | null,
  tags: DeclarationTags,
  declarationIndent: string,
  newline: string,
  preserve: readonly Span[],
): Edit | null {
  if (block === null) {
    if (tags.proofInOtherFile || !(tags.proofLeanok && tags.createMissingProof)) return null;
    const stub = `${newline}${declarationIndent}\\begin{proof}${newline}${declarationIndent}\\leanok${newline}${declarationIndent}\\end{proof}`;
    return [envEnd, envEnd, stub];
  }
  const original = source.slice(block.start, block.end);
  const rewritten = rewriteProofLeanok(original, tags.proofLeanok, newline, preserve);
  return rewritten === original ? null : [block.start, block.end, rewritten];
}

/** Proof-relative spans whose marker belongs to a nested declaration/proof. */
export function nestedProofLeanokSpans(source: string, structure: string, block: ProofBlock, blocks: readonly ProofBlock[]): Span[] {
  const absolute = nestedDeclarationSpans(source, structure, block.bodyStart, block.bodyEnd);
  for (const candidate of blocks) {
    if (block.start < candidate.start && candidate.end <= block.end && candidate.proves !== null) absolute.push([candidate.start, candidate.end]);
  }
  return absolute.map(([start, end]) => [start - block.start, end - block.start]);
}

/** A marker is syntactically standalone only when it matches the parser grammar. */
export function containsStandaloneLeanok(source: string): boolean {
  return findAll(LEAN_OK_PATTERN, source).length > 0;
}
