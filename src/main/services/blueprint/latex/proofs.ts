import {
  bisectLeft,
  capture,
  cutSpans,
  extractOptionalTitle,
  findAll,
  isOnlyPythonSpace,
  mergeRanges,
  nestedDeclarationSpans,
  PROOF_TAG_PATTERN,
  PROVES_PATTERN,
  type Span,
} from './grammar';
import { logLatexWarning } from './log';
import { hasLeanok, PROOF_METADATA_PATTERNS, removeMatches } from './normalization';

export interface ProofBlock {
  start: number;
  end: number;
  bodyStart: number;
  bodyEnd: number;
  proves: string | null;
}

export interface AttributeProofArgs {
  environmentEnd: number;
  bodyStart: number;
  bodyEnd: number;
  nested: readonly Span[];
  label: string;
}

function pairedProofBlocks(structure: string): ProofBlock[] {
  const stack: Array<[number, number]> = [];
  const blocks: ProofBlock[] = [];
  for (const tag of findAll(PROOF_TAG_PATTERN, structure)) {
    if (tag[1] === 'begin') {
      stack.push([tag.index, tag.index + tag[0].length]);
      continue;
    }
    const open = stack.pop();
    if (!open) continue;
    blocks.push({ start: open[0], end: tag.index + tag[0].length, bodyStart: open[1], bodyEnd: tag.index, proves: null });
  }
  return blocks.sort((a, b) => a.start - b.start);
}

function nestedBlocks(block: ProofBlock, blocks: readonly ProofBlock[], starts: readonly number[]): ProofBlock[] {
  const nested: ProofBlock[] = [];
  let index = bisectLeft(starts, block.bodyStart);
  while (index < blocks.length && blocks[index].start < block.bodyEnd) {
    if (blocks[index].end <= block.bodyEnd) nested.push(blocks[index]);
    index += 1;
  }
  return nested;
}

/** Index all depth-paired proof blocks and ignore nested `\proves` tags for an outer block. */
export function scanProofBlocks(source: string, structure: string): ProofBlock[] {
  const blocks = pairedProofBlocks(structure);
  const starts = blocks.map((block) => block.start);
  return blocks.map((block) => {
    const nested = nestedBlocks(block, blocks, starts);
    const match = findAll(PROVES_PATTERN, structure, block.bodyStart, block.bodyEnd).find(
      (candidate) => !nested.some((child) => child.start <= candidate.index && candidate.index < child.end),
    ) ?? null;
    const proves = capture(source, match).trim();
    return { ...block, proves: proves || null };
  });
}

export function provesIndex(blocks: readonly ProofBlock[]): Map<string, ProofBlock> {
  const index = new Map<string, ProofBlock>();
  for (const block of blocks) {
    if (block.proves === null) continue;
    if (index.has(block.proves)) {
      logLatexWarning(
        `Ignoring a second \\proves{${block.proves}} proof block at offset ${block.start}; a declaration can only have one proof`,
      );
    } else index.set(block.proves, block);
  }
  return index;
}

function adjacentProof(
  structure: string,
  blocks: readonly ProofBlock[],
  starts: readonly number[],
  environmentEnd: number,
  label: string,
): ProofBlock | null {
  const block = blocks[bisectLeft(starts, environmentEnd)];
  if (!block) return null;
  const adjacent = isOnlyPythonSpace(structure.slice(environmentEnd, block.start));
  return adjacent && (block.proves === null || block.proves === label) ? block : null;
}

function containedProof(
  blocks: readonly ProofBlock[],
  starts: readonly number[],
  args: AttributeProofArgs,
): ProofBlock | null {
  let index = bisectLeft(starts, args.bodyStart);
  while (index < blocks.length && blocks[index].start < args.bodyEnd) {
    const block = blocks[index];
    const ownedByNested = args.nested.some(([start, end]) => start <= block.start && block.start < end);
    if (block.end <= args.bodyEnd && !ownedByNested && (block.proves === null || block.proves === args.label)) return block;
    index += 1;
  }
  return null;
}

/** Resolve proof ownership by adjacency, containment, then `\proves` reference. */
export function attributeProof(
  structure: string,
  blocks: readonly ProofBlock[],
  starts: readonly number[],
  proves: ReadonlyMap<string, ProofBlock>,
  args: AttributeProofArgs,
): ProofBlock | null {
  return adjacentProof(structure, blocks, starts, args.environmentEnd, args.label)
    ?? containedProof(blocks, starts, args)
    ?? proves.get(args.label)
    ?? null;
}

function excludedProofSpans(block: ProofBlock, blocks: readonly ProofBlock[], initial: Span[]): Span[] {
  for (const candidate of blocks) {
    if (block.start < candidate.start && candidate.end <= block.end && candidate.proves !== null) {
      initial.push([candidate.start, candidate.end]);
    }
  }
  return mergeRanges(initial);
}

export function proofProse(
  source: string,
  structure: string,
  block: ProofBlock,
  blocks: readonly ProofBlock[],
): { prose: string; proofLeanok: boolean } {
  const { end: proseStart } = extractOptionalTitle(source, structure, block.bodyStart, block.bodyEnd);
  const nested = nestedDeclarationSpans(source, structure, proseStart, block.bodyEnd);
  const excluded = excludedProofSpans(block, blocks, nested);
  const [body, bodyStructure] = cutSpans(source, structure, proseStart, block.bodyEnd, excluded);
  return {
    prose: removeMatches(body, bodyStructure, PROOF_METADATA_PATTERNS).trim(),
    proofLeanok: hasLeanok(body),
  };
}
