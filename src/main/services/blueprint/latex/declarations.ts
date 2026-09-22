import { type BlueprintDeclaration, type ParsedBlueprintLatex, type UnattachedProof } from './blueprint-model';
import { maskLatexComments } from './comments';
import {
  BEGIN_PATTERN,
  capture,
  cutSpans,
  extractOptionalTitle,
  findAll,
  findMatchingEnd,
  LABEL_PATTERN,
  nestedDeclarationSpans,
} from './grammar';
import { logLatexWarning } from './log';
import { countNewlines, normalizeStatement } from './normalization';
import { attributeProof, proofProse, provesIndex, scanProofBlocks, type ProofBlock } from './proofs';

interface ParserContext {
  source: string;
  structure: string;
  blocks: ProofBlock[];
  starts: number[];
  proves: Map<string, ProofBlock>;
}

interface DeclarationRegion {
  kind: string;
  title: string | null;
  environmentEnd: number;
  bodyStart: number;
  bodyEnd: number;
  nested: ReturnType<typeof nestedDeclarationSpans>;
  body: string;
  structure: string;
}

function declarationRegion(context: ParserContext, beginMatch: RegExpExecArray): DeclarationRegion | null {
  const kind = beginMatch[1];
  const heading = extractOptionalTitle(
    context.source,
    context.structure,
    beginMatch.index + beginMatch[0].length,
  );
  const environmentEnd = findMatchingEnd(context.structure, heading.end, kind);
  if (environmentEnd === null) return null;
  const bodyEnd = environmentEnd - `\\end{${kind}}`.length;
  const nested = nestedDeclarationSpans(context.source, context.structure, heading.end, bodyEnd);
  const [body, structure] = cutSpans(context.source, context.structure, heading.end, bodyEnd, nested);
  return { kind, title: heading.title, environmentEnd, bodyStart: heading.end, bodyEnd, nested, body, structure };
}

function attributedProof(context: ParserContext, region: DeclarationRegion, label: string): ProofBlock | null {
  return attributeProof(context.structure, context.blocks, context.starts, context.proves, {
    environmentEnd: region.environmentEnd,
    bodyStart: region.bodyStart,
    bodyEnd: region.bodyEnd,
    nested: region.nested,
    label,
  });
}

function warnDiscardedReference(context: ParserContext, label: string, block: ProofBlock | null): void {
  const linked = context.proves.get(label);
  if (linked !== undefined && linked !== block) {
    logLatexWarning(
      `Ignoring \\proves{${label}} at offset ${linked.start}; the declaration already has a proof by position`,
    );
  }
}

function parseDeclaration(context: ParserContext, beginMatch: RegExpExecArray): BlueprintDeclaration | null {
  const region = declarationRegion(context, beginMatch);
  if (region === null) return null;
  const label = capture(region.body, LABEL_PATTERN.exec(region.structure));
  if (!label.trim()) return null;
  const statement = normalizeStatement(region.body, region.structure);
  const block = attributedProof(context, region, label);
  const parsedProof = block === null ? null : proofProse(context.source, context.structure, block, context.blocks);
  warnDiscardedReference(context, label, block);
  return {
    kind: region.kind,
    label,
    title: region.title || label,
    statement: statement.statement,
    proof: parsedProof?.prose ?? null,
    uses: statement.uses,
    leanName: statement.leanName,
    leanFile: statement.leanFile,
    statementLeanok: statement.statementLeanok,
    proofLeanok: parsedProof?.proofLeanok ?? false,
    sourceLine: countNewlines(context.source, beginMatch.index) + 1,
  };
}

function unattachedProofs(context: ParserContext, declarations: readonly BlueprintDeclaration[]): UnattachedProof[] {
  const declared = new Set(declarations.map((declaration) => declaration.label));
  const unattached: UnattachedProof[] = [];
  for (const [targetLabel, block] of context.proves) {
    if (declared.has(targetLabel)) continue;
    const { prose, proofLeanok } = proofProse(context.source, context.structure, block, context.blocks);
    unattached.push({ targetLabel, proof: prose, proofLeanok });
  }
  return unattached;
}

export function parseBlueprintDeclarations(source: string): BlueprintDeclaration[] {
  return parseBlueprintLatex(source).declarations;
}

export function parseBlueprintLatex(source: string): ParsedBlueprintLatex {
  const structure = maskLatexComments(source);
  const blocks = scanProofBlocks(source, structure);
  const context: ParserContext = {
    source,
    structure,
    blocks,
    starts: blocks.map((block) => block.start),
    proves: provesIndex(blocks),
  };
  const declarations = findAll(BEGIN_PATTERN, structure)
    .map((match) => parseDeclaration(context, match))
    .filter((declaration): declaration is BlueprintDeclaration => declaration !== null);
  return { declarations, unattachedProofs: unattachedProofs(context, declarations) };
}
