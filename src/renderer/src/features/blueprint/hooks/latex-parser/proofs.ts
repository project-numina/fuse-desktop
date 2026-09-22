import type { ProofBlock } from './types';
import {
  extractOptionalTitle,
  hasLeanok,
  onlyWhitespaceBetween,
  PROOF_STRIP_PATTERNS,
  PROOF_TAG_PATTERN,
  removeMatches,
} from './syntax';

function proofIndexAtOrAfter(blocks: ProofBlock[], target: number): number {
  let low = 0;
  let high = blocks.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (blocks[middle].start < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function directProvesTarget(
  source: string,
  structure: string,
  block: ProofBlock,
  blocks: ProofBlock[],
): string | null {
  const nested = blocks.filter((candidate) =>
    candidate.start >= block.bodyStart && candidate.end <= block.bodyEnd,
  );
  const pattern = /\\proves\{([^}]*)\}/dg;
  pattern.lastIndex = block.bodyStart;
  let match = pattern.exec(structure);
  while (match && match.index < block.bodyEnd) {
    const matchIndex = match.index;
    const insideChild = nested.some(
      (child) => child.start <= matchIndex && matchIndex < child.end,
    );
    if (!insideChild) break;
    match = pattern.exec(structure);
  }
  const span = match && match.index < block.bodyEnd ? match.indices?.[1] : undefined;
  return span ? source.slice(span[0], span[1]).trim() || null : null;
}

/** Indexes balanced proof blocks and their direct \proves ownership. */
export function scanProofBlocks(source: string, structure: string): ProofBlock[] {
  const stack: { start: number; bodyStart: number }[] = [];
  const blocks: ProofBlock[] = [];
  for (const tag of structure.matchAll(new RegExp(PROOF_TAG_PATTERN.source, 'g'))) {
    if (tag[1] === 'begin') {
      stack.push({ start: tag.index, bodyStart: tag.index + tag[0].length });
      continue;
    }
    const begin = stack.pop();
    if (!begin) continue;
    blocks.push({
      start: begin.start,
      end: tag.index + tag[0].length,
      bodyStart: begin.bodyStart,
      bodyEnd: tag.index,
      proves: null,
    });
  }
  blocks.sort((left, right) => left.start - right.start);
  return blocks.map((block) => ({
    ...block,
    proves: directProvesTarget(source, structure, block, blocks),
  }));
}

export function provesIndex(blocks: ProofBlock[]): Map<string, ProofBlock> {
  const index = new Map<string, ProofBlock>();
  for (const block of blocks) {
    if (block.proves === null || index.has(block.proves)) continue;
    index.set(block.proves, block);
  }
  return index;
}

function insideNestedDeclaration(
  block: ProofBlock,
  nested: [number, number][],
): boolean {
  return nested.some(([start, end]) => start <= block.start && block.start < end);
}

/** Applies leanblueprint's adjacent, inner, then \proves proof precedence. */
export function attributeProof(
  structure: string,
  blocks: ProofBlock[],
  proves: Map<string, ProofBlock>,
  envEnd: number,
  bodyStart: number,
  bodyEnd: number,
  nested: [number, number][],
  label: string,
): ProofBlock | null {
  const adjacent = blocks[proofIndexAtOrAfter(blocks, envEnd)];
  if (
    adjacent
    && onlyWhitespaceBetween(structure, envEnd, adjacent.start)
    && (adjacent.proves === null || adjacent.proves === label)
  ) return adjacent;

  let index = proofIndexAtOrAfter(blocks, bodyStart);
  while (index < blocks.length) {
    const block = blocks[index];
    if (block.start >= bodyEnd) break;
    if (
      block.end <= bodyEnd
      && !insideNestedDeclaration(block, nested)
      && (block.proves === null || block.proves === label)
    ) return block;
    index++;
  }
  return proves.get(label) ?? null;
}

export function proofProse(
  source: string,
  structure: string,
  block: ProofBlock,
): { proof: string; proofLeanok: boolean } {
  const proseStart = extractOptionalTitle(
    source,
    block.bodyStart,
    structure,
    block.bodyEnd,
  ).end;
  const body = source.slice(proseStart, block.bodyEnd);
  const bodyStructure = structure.slice(proseStart, block.bodyEnd);
  return {
    proof: removeMatches(body, bodyStructure, PROOF_STRIP_PATTERNS).trim(),
    proofLeanok: hasLeanok(body),
  };
}
