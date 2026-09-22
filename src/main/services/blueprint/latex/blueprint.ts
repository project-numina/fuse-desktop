/**
 * Public compatibility boundary for leanblueprint declaration parsing.
 *
 * Parsing is split into model, grammar, normalization, proof-reference, and
 * declaration orchestration modules. Keep exports here stable: the tag
 * rewriter and metadata service share these parser primitives.
 */

export {
  DECLARATION_KINDS,
  PROOF_REQUIRED_KINDS,
  declarationRequiresProof,
  declarationStatus,
  deriveLeanokStatus,
  formalizationIsTerminal,
  type BlueprintDeclaration,
  type FormalizationStatus,
  type ParsedBlueprintLatex,
  type UnattachedProof,
} from './blueprint-model';
export { parseBlueprintDeclarations, parseBlueprintLatex } from './declarations';
export {
  BEGIN_PATTERN,
  LABEL_PATTERN,
  LEAN_FILE_PATTERN,
  LEAN_OK_PATTERN,
  LEAN_PATTERN,
  PROOF_TAG_PATTERN,
  PROVES_PATTERN,
  USES_PATTERN,
  bisectLeft,
  capture,
  cutSpans,
  extractOptionalTitle,
  findAll,
  findFirst,
  findMatchingEnd,
  isPythonSpace,
  mergeRanges,
  nestedDeclarationSpans,
  type Span,
} from './grammar';
export {
  attributeProof,
  proofProse,
  provesIndex,
  scanProofBlocks,
  type AttributeProofArgs,
  type ProofBlock,
} from './proofs';
