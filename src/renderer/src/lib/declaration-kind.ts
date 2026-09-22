/**
 * Declaration environments whose mathematical content includes a proof
 * obligation. Statement-only environments can be complete once their
 * statement is formalized; these kinds still need a verified proof.
 *
 * Keep this set in sync with _PROOF_REQUIRED_KINDS in the shared backend
 * parser (src/numina/latex/blueprint.py), which
 * test_proof_required_kinds_match_the_frontend enforces.
 */
const PROOF_REQUIRED_KINDS = new Set([
  'theorem',
  'lemma',
  'corollary',
  'proposition',
  'example',
  'claim',
]);

export function declarationRequiresProof(kind: string | undefined): boolean {
  return kind !== undefined && PROOF_REQUIRED_KINDS.has(kind.toLowerCase());
}
