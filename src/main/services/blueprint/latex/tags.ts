/**
 * Canonical leanblueprint tag rewrites for declaration statements and proofs.
 * Parsing/attribution stays in `blueprint`; the local helpers own comment-aware
 * edits and statement/proof serialization while this module coordinates passes.
 */

import {
  attributeProof,
  BEGIN_PATTERN,
  declarationRequiresProof,
  extractOptionalTitle,
  findAll,
  findMatchingEnd,
  nestedDeclarationSpans,
  provesIndex,
  scanProofBlocks,
  type ProofBlock,
} from './blueprint';
import { maskLatexComments } from './comments';
import { applyEdits, newlineStyle, rfind, type Edit } from './tag-edits';
import {
  nestedProofLeanokSpans,
  ownerLabel,
  proofEdit,
  proofSpansIn,
  statementEdits,
} from './tag-statement';

export { applyEdits, isInComment, rewriteProofLeanok } from './tag-edits';
export type { Edit } from './tag-edits';

/** Canonical metadata and status markers for one declaration. */
export interface DeclarationTags {
  leanName: string;
  leanFile: string;
  uses: readonly string[];
  leanok: boolean;
  proofLeanok: boolean;
  createMissingProof: boolean;
  proofInOtherFile: boolean;
}

export function declarationTags(overrides: Partial<DeclarationTags> = {}): DeclarationTags {
  return {
    leanName: '',
    leanFile: '',
    uses: [],
    leanok: false,
    proofLeanok: false,
    createMissingProof: false,
    proofInOtherFile: false,
    ...overrides,
  };
}

export interface RewriteResult {
  source: string;
  /** The subset of requested labels actually found and rewritten. */
  matched: Set<string>;
}

interface DeclarationRewrite {
  label: string;
  edits: Edit[];
}

function declarationRewrite(
  source: string,
  structure: string,
  beginMatch: RegExpExecArray,
  blocks: readonly ProofBlock[],
  starts: readonly number[],
  proves: ReadonlyMap<string, ProofBlock>,
  tagsByLabel: ReadonlyMap<string, DeclarationTags>,
  newline: string,
): DeclarationRewrite | null {
  const kind = beginMatch[1];
  const { end: bodyStart } = extractOptionalTitle(source, structure, beginMatch.index + beginMatch[0].length);
  const envEnd = findMatchingEnd(structure, bodyStart, kind);
  if (envEnd === null) return null;
  const bodyEnd = envEnd - `\\end{${kind}}`.length;
  const nested = nestedDeclarationSpans(source, structure, bodyStart, bodyEnd);
  const label = ownerLabel(source, bodyStart, bodyEnd, nested);
  const tags = label === null ? undefined : tagsByLabel.get(label);
  if (label === null || tags === undefined) return null;
  const edits = statementEdits(source, bodyStart, bodyEnd, nested, proofSpansIn(blocks, bodyStart, bodyEnd), label, tags, newline);
  if (edits === null) return null;

  const lineStart = rfind(source, '\n', beginMatch.index) + 1;
  const whitespace = source.slice(lineStart, beginMatch.index);
  const indent = whitespace.trim() ? '' : whitespace;
  const proof = attributeProof(structure, blocks, starts, proves, { environmentEnd: envEnd, bodyStart, bodyEnd, nested, label });
  const proofChange = proofEdit(
    source,
    envEnd,
    proof,
    tags,
    indent,
    newline,
    proof === null ? [] : nestedProofLeanokSpans(source, structure, proof, blocks),
  );
  if (proofChange !== null) edits.push(proofChange);
  return { label, edits };
}

/** Rewrite one non-overlapping nesting bucket against current source offsets. */
export function rewriteTexTagsOnce(source: string, tagsByLabel: ReadonlyMap<string, DeclarationTags>): RewriteResult {
  const matched = new Set<string>();
  if (tagsByLabel.size === 0) return { source, matched };
  const structure = maskLatexComments(source);
  const blocks = scanProofBlocks(source, structure);
  const starts = blocks.map((block) => block.start);
  const proves = provesIndex(blocks);
  const edits: Edit[] = [];
  for (const beginMatch of findAll(BEGIN_PATTERN, structure)) {
    const rewrite = declarationRewrite(source, structure, beginMatch, blocks, starts, proves, tagsByLabel, newlineStyle(source));
    if (rewrite === null) continue;
    matched.add(rewrite.label);
    edits.push(...rewrite.edits);
  }
  return edits.length === 0 ? { source, matched } : { source: applyEdits(source, edits), matched };
}

function declarationTargets(source: string, tagsByLabel: ReadonlyMap<string, DeclarationTags>): Map<string, [number, ProofBlock | null]> {
  const structure = maskLatexComments(source);
  const blocks = scanProofBlocks(source, structure);
  const starts = blocks.map((block) => block.start);
  const proves = provesIndex(blocks);
  const targets = new Map<string, [number, ProofBlock | null]>();
  for (const beginMatch of findAll(BEGIN_PATTERN, structure)) {
    const kind = beginMatch[1];
    const { end: bodyStart } = extractOptionalTitle(source, structure, beginMatch.index + beginMatch[0].length);
    const envEnd = findMatchingEnd(structure, bodyStart, kind);
    if (envEnd === null) continue;
    const bodyEnd = envEnd - `\\end{${kind}}`.length;
    const nested = nestedDeclarationSpans(source, structure, bodyStart, bodyEnd);
    const label = ownerLabel(source, bodyStart, bodyEnd, nested);
    if (label === null || !tagsByLabel.has(label)) continue;
    const proof = attributeProof(structure, blocks, starts, proves, { environmentEnd: envEnd, bodyStart, bodyEnd, nested, label });
    targets.set(label, [beginMatch.index, proof]);
  }
  return targets;
}

function declarationDepth(position: number, ownProof: ProofBlock | null, targetedProofs: readonly ProofBlock[]): number {
  return targetedProofs.filter((proof) => (
    (proof.start < position && position < proof.end)
    || (ownProof !== null && proof.start < ownProof.start && ownProof.end <= proof.end)
  )).length;
}

/** Bucket nested declaration targets so each pass uses valid source offsets. */
export function declarationRewriteBatches(source: string, tagsByLabel: ReadonlyMap<string, DeclarationTags>): Array<Map<string, DeclarationTags>> {
  const targets = declarationTargets(source, tagsByLabel);
  const targetedProofs = [...targets.values()].map(([, proof]) => proof).filter((proof): proof is ProofBlock => proof !== null);
  const buckets = new Map<number, Map<string, DeclarationTags>>();
  for (const [label, tags] of tagsByLabel) {
    const [position, ownProof] = targets.get(label) ?? [-1, null];
    const depth = declarationDepth(position, ownProof, targetedProofs);
    const bucket = buckets.get(depth) ?? new Map<string, DeclarationTags>();
    bucket.set(label, tags);
    buckets.set(depth, bucket);
  }
  return [...buckets.keys()].sort((a, b) => a - b).map((depth) => buckets.get(depth)!);
}

export function rewriteTexTags(source: string, tagsByLabel: ReadonlyMap<string, DeclarationTags>): RewriteResult {
  let rewritten = source;
  const matched = new Set<string>();
  for (const pending of declarationRewriteBatches(source, tagsByLabel)) {
    const result = rewriteTexTagsOnce(rewritten, pending);
    rewritten = result.source;
    for (const label of result.matched) matched.add(label);
  }
  return { source: rewritten, matched };
}

/** Rewrite `\proves`-linked proof markers in one non-overlapping pass. */
export function rewriteProofLeanokTagsOnce(source: string, proofLeanokByLabel: ReadonlyMap<string, boolean>): RewriteResult {
  const matched = new Set<string>();
  if (proofLeanokByLabel.size === 0) return { source, matched };
  const structure = maskLatexComments(source);
  const blocks = scanProofBlocks(source, structure);
  const proves = provesIndex(blocks);
  const edits: Edit[] = [];
  for (const [label, wanted] of proofLeanokByLabel) {
    const block = proves.get(label);
    if (block === undefined) continue;
    matched.add(label);
    const edit = proofEdit(source, block.end, block, declarationTags({ proofLeanok: wanted }), '', newlineStyle(source), nestedProofLeanokSpans(source, structure, block, blocks));
    if (edit !== null) edits.push(edit);
  }
  return edits.length === 0 ? { source, matched } : { source: applyEdits(source, edits), matched };
}

function proofRewriteBatches(source: string, proofLeanokByLabel: ReadonlyMap<string, boolean>): Array<Map<string, boolean>> {
  const structure = maskLatexComments(source);
  const proves = provesIndex(scanProofBlocks(source, structure));
  const targetBlocks = [...proofLeanokByLabel.keys()].map((label) => proves.get(label)).filter((block): block is ProofBlock => block !== undefined);
  const buckets = new Map<number, Map<string, boolean>>();
  for (const [label, wanted] of proofLeanokByLabel) {
    const block = proves.get(label);
    const depth = block === undefined ? 0 : targetBlocks.filter((ancestor) => ancestor.start < block.start && block.end <= ancestor.end).length;
    const bucket = buckets.get(depth) ?? new Map<string, boolean>();
    bucket.set(label, wanted);
    buckets.set(depth, bucket);
  }
  return [...buckets.keys()].sort((a, b) => a - b).map((depth) => buckets.get(depth)!);
}

export function rewriteProofLeanokTags(source: string, proofLeanokByLabel: ReadonlyMap<string, boolean>): RewriteResult {
  let rewritten = source;
  const matched = new Set<string>();
  for (const pending of proofRewriteBatches(source, proofLeanokByLabel)) {
    const result = rewriteProofLeanokTagsOnce(rewritten, pending);
    rewritten = result.source;
    for (const label of result.matched) matched.add(label);
  }
  return { source: rewritten, matched };
}

/** Map the parser's declaration JSON view back to canonical writer tags. */
export function tagsFromDeclaration(data: Record<string, unknown>): DeclarationTags {
  const text = (value: unknown): string => (value ? String(value) : '');
  const usesRaw = data.uses;
  const status = data.status;
  const kind = text(data.kind);
  const sourceFile = text(data.sourceFile);
  const proofSourceFile = text(data.proofSourceFile);
  return {
    leanName: text(data.leanDeclaration),
    leanFile: '',
    uses: Array.isArray(usesRaw) ? usesRaw.filter((item): item is string => typeof item === 'string' && item !== '') : [],
    leanok: status === 'proved' || status === 'in_progress',
    proofLeanok: status === 'proved',
    createMissingProof: status === 'proved' && declarationRequiresProof(kind),
    proofInOtherFile: Boolean(proofSourceFile && proofSourceFile !== sourceFile),
  };
}
