import type { BlueprintEntry, ParsedLatexDocument } from './types';
import { attributeProof, proofProse, provesIndex, scanProofBlocks } from './proofs';
import {
  capture,
  cutSpans,
  deriveLeanokStatus,
  extractOptionalTitle,
  findMatchingEnd,
  hasLeanok,
  KINDS_PATTERN,
  LABEL_PATTERN,
  LEAN_PATTERN,
  LEANFILE_PATTERN,
  maskLatexComments,
  nestedDeclarationSpans,
  PROOF_PATTERN_GLOBAL,
  removeMatches,
  STATEMENT_STRIP_PATTERNS,
  USES_PATTERN,
} from './syntax';

interface DeclarationContext {
  source: string;
  structure: string;
  blocks: ParsedLatexDocument['proofBlocks'];
  proves: Map<string, ParsedLatexDocument['proofBlocks'][number]>;
}

interface DeclarationParts {
  kind: string;
  title: string | null;
  bodyStart: number;
  bodyEnd: number;
  envEnd: number;
  nested: [number, number][];
  outer: { body: string; structure: string };
  label: string;
}

function declarationParts(
  source: string,
  structure: string,
  beginMatch: RegExpMatchArray,
): DeclarationParts | null {
  const kind = beginMatch[1];
  const matchEnd = (beginMatch.index ?? 0) + beginMatch[0].length;
  const { title, end: bodyStart } = extractOptionalTitle(source, matchEnd, structure);
  const envEnd = findMatchingEnd(structure, bodyStart, kind);
  if (envEnd === null) return null;
  const bodyEnd = envEnd - `\\end{${kind}}`.length;
  const nested = nestedDeclarationSpans(source, structure, bodyStart, bodyEnd);
  const outer = cutSpans(source, structure, bodyStart, bodyEnd, nested);
  const labelMatch = outer.structure.match(LABEL_PATTERN);
  if (!labelMatch) return null;
  const label = capture(outer.body, labelMatch);
  return { kind, title, bodyStart, bodyEnd, envEnd, nested, outer, label };
}

function buildEntry(context: DeclarationContext, parts: DeclarationParts): BlueprintEntry {
  const { source, structure, blocks, proves } = context;
  const { kind, title, bodyStart, bodyEnd, envEnd, nested, outer, label } = parts;
  const proofBlock = attributeProof(
    structure, blocks, proves, envEnd, bodyStart, bodyEnd, nested, label,
  );
  const proof = proofBlock ? proofProse(source, structure, proofBlock) : null;
  const statement = removeMatches(
    outer.body,
    outer.structure,
    STATEMENT_STRIP_PATTERNS,
  ).trim();
  const statementRegion = removeMatches(
    outer.body,
    outer.structure,
    [PROOF_PATTERN_GLOBAL],
  );
  return {
    kind,
    label,
    title: title || label,
    statement,
    proof: proof?.proof ?? null,
    leanName: capture(outer.body, outer.structure.match(LEAN_PATTERN)),
    leanFile: capture(outer.body, outer.structure.match(LEANFILE_PATTERN)),
    uses: capture(outer.body, outer.structure.match(USES_PATTERN))
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    status: deriveLeanokStatus(
      kind,
      proof !== null,
      hasLeanok(statementRegion),
      proof?.proofLeanok ?? false,
    ),
  };
}

function parseDeclaration(
  context: DeclarationContext,
  beginMatch: RegExpMatchArray,
): BlueprintEntry | null {
  const parts = declarationParts(context.source, context.structure, beginMatch);
  return parts ? buildEntry(context, parts) : null;
}

/** Parses LaTeX declarations with backend-compatible proof attribution. */
export function parseLatex(source: string): ParsedLatexDocument {
  const structure = maskLatexComments(source);
  const blocks = scanProofBlocks(source, structure);
  const context: DeclarationContext = {
    source,
    structure,
    blocks,
    proves: provesIndex(blocks),
  };
  const entries: BlueprintEntry[] = [];
  const beginPattern = new RegExp(`\\\\begin\\{(${KINDS_PATTERN})\\}`, 'g');
  for (const beginMatch of structure.matchAll(beginPattern)) {
    const entry = parseDeclaration(context, beginMatch);
    if (entry) entries.push(entry);
  }
  return { entries, proofBlocks: blocks };
}
