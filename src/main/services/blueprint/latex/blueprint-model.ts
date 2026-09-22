export type FormalizationStatus = 'not_started' | 'in_progress' | 'proved';

/** Theorem-like environments recognized by leanblueprint and the renderer. */
export const DECLARATION_KINDS: readonly string[] = [
  'theorem',
  'lemma',
  'corollary',
  'definition',
  'proposition',
  'axiom',
  'conjecture',
  'example',
  'remark',
  'hypothesis',
  'claim',
  'assumption',
  'notation',
];

/** Kinds carrying a proof obligation even when the informal proof is omitted. */
export const PROOF_REQUIRED_KINDS: ReadonlySet<string> = new Set([
  'theorem',
  'lemma',
  'corollary',
  'proposition',
  'example',
  'claim',
]);

export interface BlueprintDeclaration {
  kind: string;
  label: string;
  title: string;
  statement: string;
  proof: string | null;
  uses: string[];
  leanName: string;
  leanFile: string;
  statementLeanok: boolean;
  proofLeanok: boolean;
  sourceLine: number;
}

export interface UnattachedProof {
  targetLabel: string;
  proof: string;
  proofLeanok: boolean;
}

export interface ParsedBlueprintLatex {
  declarations: BlueprintDeclaration[];
  unattachedProofs: UnattachedProof[];
}

export function declarationRequiresProof(kind: string): boolean {
  return PROOF_REQUIRED_KINDS.has(kind.toLowerCase());
}

export function formalizationIsTerminal(kind: string, hasProof: boolean): boolean {
  return !hasProof && !declarationRequiresProof(kind);
}

export function deriveLeanokStatus(
  kind: string,
  hasProof: boolean,
  statementLeanok: boolean,
  proofLeanok: boolean,
): FormalizationStatus {
  if (hasProof) {
    if (proofLeanok) return 'proved';
    if (statementLeanok) return 'in_progress';
    return 'not_started';
  }
  if (statementLeanok) return declarationRequiresProof(kind) ? 'in_progress' : 'proved';
  return 'not_started';
}

export function declarationStatus(declaration: BlueprintDeclaration): FormalizationStatus {
  return deriveLeanokStatus(
    declaration.kind,
    declaration.proof !== null,
    declaration.statementLeanok,
    declaration.proofLeanok,
  );
}
