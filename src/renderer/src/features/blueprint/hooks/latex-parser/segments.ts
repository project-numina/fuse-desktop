import type { BlueprintEntry, LatexSegment, ProofBlock } from './types';
import {
  capture,
  KINDS_PATTERN,
  LABEL_PATTERN,
  maskLatexComments,
  onlyWhitespaceBetween,
} from './syntax';

interface DeclarationBlock {
  kind: string;
  start: number;
  end: number;
}

function findMatchingEndLine(lines: string[], startLine: number, kind: string): number | null {
  const beginPattern = new RegExp(`\\\\begin\\{${kind}\\}`);
  const endPattern = new RegExp(`\\\\end\\{${kind}\\}`);
  let depth = 1;
  for (let line = startLine; line < lines.length; line++) {
    if (beginPattern.test(lines[line])) depth++;
    if (endPattern.test(lines[line])) {
      depth--;
      if (depth === 0) return line;
    }
  }
  return null;
}

function lineIndexAtOffset(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle] <= offset) low = middle;
    else high = middle;
  }
  return low;
}

function lineStartsFor(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

function proofsByStartLine(
  proofBlocks: ProofBlock[],
  lineStarts: number[],
): Map<number, ProofBlock> {
  const byLine = new Map<number, ProofBlock>();
  for (const proof of proofBlocks) {
    const line = lineIndexAtOffset(lineStarts, proof.start);
    if (!byLine.has(line)) byLine.set(line, proof);
  }
  return byLine;
}

function trailingProofEnd(
  source: string,
  maskedLines: string[],
  lineStarts: number[],
  proofs: Map<number, ProofBlock>,
  start: number,
  endLine: number,
): number {
  let nextLine = endLine + 1;
  while (nextLine < maskedLines.length && maskedLines[nextLine].trim() === '') nextLine++;
  const proof = proofs.get(nextLine);
  if (!proof || !onlyWhitespaceBetween(source, lineStarts[nextLine], proof.start)) return endLine + 1;
  const label = maskedLines.slice(start, endLine + 1).join('\n').match(LABEL_PATTERN)?.[1];
  if (proof.proves && proof.proves !== label) return endLine + 1;
  return lineIndexAtOffset(lineStarts, proof.end - 1) + 1;
}

function declarationBlocks(
  source: string,
  maskedLines: string[],
  lineStarts: number[],
  proofBlocks: ProofBlock[],
): DeclarationBlock[] {
  const proofs = proofsByStartLine(proofBlocks, lineStarts);
  const blocks: DeclarationBlock[] = [];
  for (let line = 0; line < maskedLines.length; line++) {
    const match = maskedLines[line].match(new RegExp(`\\\\begin\\{(${KINDS_PATTERN})\\}`));
    if (!match) continue;
    const endLine = findMatchingEndLine(maskedLines, line + 1, match[1]);
    if (endLine === null) continue;
    const end = trailingProofEnd(source, maskedLines, lineStarts, proofs, line, endLine);
    blocks.push({ kind: match[1], start: line, end });
    line = end - 1;
  }
  return blocks;
}

function entriesByLabel(entries: BlueprintEntry[]): Map<string, BlueprintEntry[]> {
  const grouped = new Map<string, BlueprintEntry[]>();
  for (const entry of entries) {
    const bucket = grouped.get(entry.label);
    if (bucket) bucket.push(entry);
    else grouped.set(entry.label, [entry]);
  }
  return grouped;
}

function declarationSegment(
  block: DeclarationBlock,
  lines: string[],
  maskedLines: string[],
  entries: Map<string, BlueprintEntry[]>,
  occurrences: Map<string, number>,
): LatexSegment {
  const text = lines.slice(block.start, block.end).join('\n');
  const maskedText = maskedLines.slice(block.start, block.end).join('\n');
  const labelMatch = maskedText.match(LABEL_PATTERN);
  const label = labelMatch ? capture(text, labelMatch) : null;
  const occurrence = label ? (occurrences.get(label) ?? 0) : 0;
  if (label) occurrences.set(label, occurrence + 1);
  return {
    type: 'decl',
    entry: label ? (entries.get(label)?.[occurrence] ?? null) : null,
    kind: block.kind,
    text,
    lineStart: block.start + 1,
    lineEnd: block.end,
    declKey: label ? `${label}#${occurrence}` : undefined,
  };
}

/** Splits source into declaration cards and surrounding code segments. */
export function buildLatexSegments(
  source: string,
  entries: BlueprintEntry[],
  proofBlocks: ProofBlock[],
): LatexSegment[] {
  const lines = source.split('\n');
  const maskedLines = maskLatexComments(source).split('\n');
  const blocks = declarationBlocks(source, maskedLines, lineStartsFor(source), proofBlocks);
  const groupedEntries = entriesByLabel(entries);
  const occurrences = new Map<string, number>();
  const segments: LatexSegment[] = [];
  let cursor = 0;
  for (const block of blocks) {
    if (cursor < block.start) {
      segments.push({
        type: 'code',
        text: lines.slice(cursor, block.start).join('\n'),
        lineStart: cursor + 1,
      });
    }
    segments.push(declarationSegment(block, lines, maskedLines, groupedEntries, occurrences));
    cursor = block.end;
  }
  if (cursor < lines.length) {
    segments.push({
      type: 'code',
      text: lines.slice(cursor).join('\n'),
      lineStart: cursor + 1,
    });
  }
  return segments;
}
