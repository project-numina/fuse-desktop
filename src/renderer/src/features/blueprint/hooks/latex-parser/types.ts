export interface BlueprintEntry {
  kind: string;
  label: string;
  title: string;
  statement: string;
  proof: string | null;
  leanName: string;
  leanFile: string;
  uses: string[];
  status: string;
  issues?: unknown;
  lean_name?: string;
  lean_file?: string;
}

export interface LatexSegment {
  type: 'code' | 'decl';
  text: string;
  lineStart: number;
  lineEnd?: number;
  entry?: BlueprintEntry | null;
  kind?: string;
  /** Stable per-label occurrence identity used by cards and editor anchors. */
  declKey?: string;
}

export interface LatexBlueprint {
  entries?: (BlueprintEntry & {
    issues?: unknown;
    lean_name?: string;
    lean_file?: string;
    status?: string;
  })[];
  blueprint_content?: string;
}

export interface ProofBlock {
  start: number;
  end: number;
  bodyStart: number;
  bodyEnd: number;
  proves: string | null;
}

export interface ParsedLatexDocument {
  entries: BlueprintEntry[];
  proofBlocks: ProofBlock[];
}
