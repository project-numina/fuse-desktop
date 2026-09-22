import type { DeclarationLike, DependencyGraph } from './index';
import { detectCycles } from './cycles';

interface ClassifiedUses {
  dependencies: string[];
  references: string[];
}

function firstUsesByLabel(declarations: Iterable<DeclarationLike>): Map<string, readonly string[]> {
  const usesByLabel = new Map<string, readonly string[]>();
  for (const declaration of declarations) {
    if (!usesByLabel.has(declaration.label)) usesByLabel.set(declaration.label, declaration.uses ?? []);
  }
  return usesByLabel;
}

function classifyUses(uses: readonly string[], known: ReadonlySet<string>): ClassifiedUses {
  const dependencies: string[] = [];
  const references: string[] = [];
  const seen = new Set<string>();
  for (const used of uses) {
    if (seen.has(used)) continue;
    seen.add(used);
    (known.has(used) ? dependencies : references).push(used);
  }
  return { dependencies, references };
}

/** Resolve authored uses into internal edges and non-blocking external references. */
export function constructDependencyGraph(declarations: Iterable<DeclarationLike>): DependencyGraph {
  const usesByLabel = firstUsesByLabel(declarations);
  const labels = [...usesByLabel.keys()];
  const known = new Set(labels);
  const edges = new Map<string, string[]>();
  const externalReferences = new Map<string, string[]>();
  for (const label of labels) {
    const { dependencies, references } = classifyUses(usesByLabel.get(label)!, known);
    edges.set(label, dependencies);
    if (references.length) externalReferences.set(label, references);
  }
  return { labels, edges, externalReferences, cycles: detectCycles(labels, edges) };
}
