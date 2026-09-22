import { describe, expect, it } from 'vitest';
import {
  blockingDependencies,
  buildDependencyGraph,
  liveCycles,
  readyFrontier,
  topologicalOrder,
  transitiveDependencies,
  type DeclarationLike,
  type DependencyGraph,
} from '@main/services/blueprint/dependency-graph';

function declarations(...specification: Array<[string, string[] | null]>): DeclarationLike[] {
  return specification.map(([label, uses]) => ({ label, uses }));
}

function graphOf(...specification: Array<[string, string[] | null]>): DependencyGraph {
  return buildDependencyGraph(declarations(...specification));
}

const none: ReadonlySet<string> = new Set();
const set = (...labels: string[]): Set<string> => new Set(labels);

describe('buildDependencyGraph', () => {
  it('keeps document order and resolves edges', () => {
    const graph = graphOf(['thm:froda', ['lem:jump', 'def:continuous']], ['lem:jump', ['def:continuous']], ['def:continuous', []]);
    expect(graph.labels).toEqual(['thm:froda', 'lem:jump', 'def:continuous']);
    expect(graph.edges.get('thm:froda')).toEqual(['lem:jump', 'def:continuous']);
    expect(graph.edges.get('lem:jump')).toEqual(['def:continuous']);
    expect(graph.edges.get('def:continuous')).toEqual([]);
  });

  it('records external references without edges', () => {
    const graph = graphOf(['thm:froda', ['Mathlib.Order.Monotone', 'def:continuous']], ['def:continuous', []]);
    expect(graph.edges.get('thm:froda')).toEqual(['def:continuous']);
    expect(graph.externalReferences.get('thm:froda')).toEqual(['Mathlib.Order.Monotone']);
    expect([...graph.edges.keys()]).toEqual(graph.labels);
    expect([...graph.externalReferences.keys()]).toEqual(['thm:froda']);
  });

  it('keeps a self edge as a one-node cycle', () => {
    const graph = graphOf(['thm:froda', ['thm:froda', 'def:continuous']], ['def:continuous', []]);
    expect(graph.edges.get('thm:froda')).toEqual(['thm:froda', 'def:continuous']);
    expect(graph.cycles).toEqual([['thm:froda']]);
    expect(graph.externalReferences.has('thm:froda')).toBe(false);
  });

  it('de-duplicates repeated uses and external references', () => {
    const graph = graphOf(['thm:froda', ['def:continuous', 'lem:jump', 'def:continuous']], ['lem:jump', []], ['def:continuous', []]);
    expect(graph.edges.get('thm:froda')).toEqual(['def:continuous', 'lem:jump']);
    expect(graphOf(['thm:froda', ['thm:absent', 'thm:absent']]).externalReferences.get('thm:froda')).toEqual(['thm:absent']);
  });

  it('lets the first copy of a repeated label win', () => {
    const graph = graphOf(['def:continuous', ['lem:jump']], ['lem:jump', []], ['def:continuous', []]);
    expect(graph.labels).toEqual(['def:continuous', 'lem:jump']);
    expect(graph.edges.get('def:continuous')).toEqual(['lem:jump']);
  });

  it('treats missing uses as no dependencies and accepts an empty blueprint', () => {
    expect(graphOf(['thm:froda', null]).edges).toEqual(new Map([['thm:froda', []]]));
    const empty = buildDependencyGraph([]);
    expect(empty.labels).toEqual([]);
    expect(empty.cycles).toEqual([]);
    expect(topologicalOrder(empty)).toEqual([]);
    expect(readyFrontier(empty, none, none)).toEqual([]);
  });
});

describe('transitiveDependencies', () => {
  const chain = (): DependencyGraph =>
    graphOf(['thm:froda', ['lem:jump']], ['lem:jump', ['def:continuous']], ['def:continuous', ['def:limit']], ['def:limit', []]);

  it('walks the whole closure', () => {
    expect(transitiveDependencies(chain(), 'thm:froda')).toEqual(set('lem:jump', 'def:continuous', 'def:limit'));
  });

  it('excludes external references and unknown labels', () => {
    expect(transitiveDependencies(graphOf(['thm:froda', ['Mathlib.Topology.Basic']]), 'thm:froda')).toEqual(set());
    expect(transitiveDependencies(graphOf(['thm:froda', []]), 'thm:absent')).toEqual(set());
  });

  it('includes a cycle member itself', () => {
    expect(transitiveDependencies(graphOf(['cyc:a', ['cyc:b']], ['cyc:b', ['cyc:a']]), 'cyc:a')).toEqual(set('cyc:a', 'cyc:b'));
  });

  it('reuses a cached sub-closure without truncating', () => {
    const graph = chain();
    transitiveDependencies(graph, 'lem:jump');
    expect(transitiveDependencies(graph, 'thm:froda')).toEqual(set('lem:jump', 'def:continuous', 'def:limit'));
  });
});

describe('topologicalOrder', () => {
  it('puts dependencies first and breaks ties by document order', () => {
    expect(topologicalOrder(graphOf(['thm:froda', ['lem:jump']], ['lem:jump', ['def:continuous']], ['def:continuous', []]))).toEqual([
      'def:continuous',
      'lem:jump',
      'thm:froda',
    ]);
    expect(topologicalOrder(graphOf(['thm:main', ['def:zeta', 'def:alpha']], ['def:zeta', []], ['def:alpha', []]))).toEqual([
      'def:zeta',
      'def:alpha',
      'thm:main',
    ]);
  });

  it('is identical across runs and trails an orphan behind the ready root', () => {
    const specification: Array<[string, string[]]> = [
      ['thm:main', ['lem:one', 'lem:two']],
      ['lem:two', ['def:base']],
      ['lem:one', ['def:base']],
      ['def:base', []],
      ['def:orphan', []],
    ];
    const first = topologicalOrder(graphOf(...specification));
    expect(topologicalOrder(graphOf(...specification))).toEqual(first);
    expect(first).toEqual(['def:base', 'lem:two', 'lem:one', 'thm:main', 'def:orphan']);
  });

  it('appends cycle members in document order and covers every label once', () => {
    expect(topologicalOrder(graphOf(['cyc:b', ['cyc:a']], ['def:free', []], ['cyc:a', ['cyc:b']]))).toEqual(['def:free', 'cyc:b', 'cyc:a']);
    const graph = graphOf(['thm:main', ['cyc:a', 'def:base']], ['cyc:a', ['cyc:b']], ['cyc:b', ['cyc:a']], ['def:base', []]);
    const order = topologicalOrder(graph);
    expect([...order].sort()).toEqual([...graph.labels].sort());
    expect(new Set(order).size).toBe(order.length);
  });
});

describe('cycles', () => {
  it('reports a two-label cycle once, rotated to its smallest label', () => {
    expect(graphOf(['cyc:b', ['cyc:a']], ['cyc:a', ['cyc:b']]).cycles).toEqual([['cyc:a', 'cyc:b']]);
  });

  it('reports disjoint and overlapping cycles', () => {
    expect(graphOf(['cyc:a', ['cyc:b']], ['cyc:b', ['cyc:a']], ['cyc:p', ['cyc:q']], ['cyc:q', ['cyc:p']]).cycles).toEqual([
      ['cyc:a', 'cyc:b'],
      ['cyc:p', 'cyc:q'],
    ]);
    expect(graphOf(['cyc:a', ['cyc:b']], ['cyc:b', ['cyc:a', 'cyc:c']], ['cyc:c', ['cyc:b']]).cycles).toEqual([
      ['cyc:a', 'cyc:b'],
      ['cyc:b', 'cyc:c'],
    ]);
  });

  it('starts a longer cycle at its smallest label', () => {
    const graph = graphOf(['cyc:b', ['cyc:a']], ['cyc:c', ['cyc:b']], ['cyc:a', ['cyc:c']]);
    expect(graph.cycles).toHaveLength(1);
    expect(graph.cycles[0][0]).toBe('cyc:a');
    expect(new Set(graph.cycles[0])).toEqual(set('cyc:a', 'cyc:b', 'cyc:c'));
  });

  it('reports the same cycles as the reference search order', () => {
    const graph = graphOf(
      ['thm:root', ['cyc:alpha', 'cyc:plum']],
      ['cyc:alpha', ['cyc:beta']],
      ['cyc:beta', ['cyc:alpha']],
      ['cyc:plum', ['cyc:quince']],
      ['cyc:quince', ['cyc:plum']],
      ['def:one', []],
      ['def:two', ['def:one']],
      ['def:three', ['def:two', 'def:one']],
      ['def:four', ['def:three']],
    );
    expect(graph.cycles).toEqual([['cyc:alpha', 'cyc:beta'], ['cyc:plum', 'cyc:quince']]);
    const partial = graphOf(['thm:main', ['lem:one']], ['lem:one', ['lem:two']], ['lem:two', ['thm:main', 'lem:three']], ['lem:three', ['lem:one']]);
    expect(partial.cycles).toEqual([['lem:one', 'thm:main', 'lem:two']]);
  });

  it('still deadlocks members of an unreported cycle', () => {
    const graph = graphOf(['thm:main', ['lem:one']], ['lem:one', ['lem:two']], ['lem:two', ['thm:main', 'lem:three']], ['lem:three', ['lem:one']]);
    expect(graph.cycles.flat()).not.toContain('lem:three');
    const approved = new Set(graph.labels);
    expect(readyFrontier(graph, approved, none)).toEqual([]);
    expect(blockingDependencies(graph, 'lem:three', approved, none)).toEqual(['thm:main', 'lem:one', 'lem:two', 'lem:three']);
  });

  it('treats a self edge as a one-node cycle everywhere', () => {
    const graph = graphOf(['thm:froda', ['thm:froda']]);
    expect(graph.cycles).toEqual([['thm:froda']]);
    expect(topologicalOrder(graph)).toEqual(['thm:froda']);
    expect(liveCycles(graph, none)).toEqual([['thm:froda']]);

    const withDependent = graphOf(['thm:froda', ['thm:froda']], ['cor:step', ['thm:froda']]);
    const approved = set('thm:froda', 'cor:step');
    expect(readyFrontier(withDependent, approved, none)).toEqual([]);
    expect(blockingDependencies(withDependent, 'thm:froda', approved, none)).toEqual(['thm:froda']);
    expect(blockingDependencies(withDependent, 'cor:step', approved, none)).toEqual(['thm:froda']);
    expect(readyFrontier(withDependent, set('cor:step'), set('thm:froda'))).toEqual(['cor:step']);
    expect(liveCycles(withDependent, set('thm:froda'))).toEqual([]);
  });

  it('reports no cycle for a diamond', () => {
    expect(graphOf(['thm:main', ['lem:left', 'lem:right']], ['lem:left', ['def:base']], ['lem:right', ['def:base']], ['def:base', []]).cycles).toEqual([]);
  });
});

describe('readyFrontier', () => {
  it('requires approval and excludes satisfied labels', () => {
    const graph = graphOf(['def:base', []]);
    expect(readyFrontier(graph, none, none)).toEqual([]);
    expect(readyFrontier(graph, set('def:base'), none)).toEqual(['def:base']);
    expect(readyFrontier(graph, set('def:base'), set('def:base'))).toEqual([]);
  });

  it('accepts an approved dependency and blocks on an unapproved one, transitively', () => {
    const pair = graphOf(['thm:froda', ['def:base']], ['def:base', []]);
    expect(readyFrontier(pair, set('thm:froda', 'def:base'), none)).toEqual(['def:base', 'thm:froda']);
    expect(readyFrontier(pair, set('thm:froda'), none)).toEqual([]);
    const chain = graphOf(['thm:froda', ['lem:jump']], ['lem:jump', ['def:base']], ['def:base', []]);
    expect(readyFrontier(chain, set('thm:froda', 'lem:jump'), none)).toEqual([]);
    expect(readyFrontier(chain, set('thm:froda', 'lem:jump', 'def:base'), none)).toEqual(['def:base', 'lem:jump', 'thm:froda']);
  });

  it('short-circuits below a satisfied dependency and ignores external references', () => {
    const chain = graphOf(['thm:froda', ['lem:jump']], ['lem:jump', ['def:base']], ['def:base', ['def:limit']], ['def:limit', []]);
    expect(readyFrontier(chain, set('thm:froda'), set('lem:jump'))).toEqual(['thm:froda']);
    expect(readyFrontier(graphOf(['thm:froda', ['Mathlib.Order.Monotone', 'thm:typoed']]), set('thm:froda'), none)).toEqual(['thm:froda']);
  });

  it('orders a freed cycle member before its dependent', () => {
    const graph = graphOf(['lem:a', ['lem:b']], ['lem:b', ['lem:a']], ['thm:main', ['lem:a']]);
    expect(graph.cycles).toEqual([['lem:a', 'lem:b']]);
    expect(readyFrontier(graph, set('lem:a', 'thm:main'), set('lem:b'))).toEqual(['lem:a', 'thm:main']);
  });

  it('handles cycles: exclusion, blocking dependents, and dissolution by a proof', () => {
    expect(readyFrontier(graphOf(['cyc:a', ['cyc:b']], ['cyc:b', ['cyc:a']], ['def:free', []]), set('cyc:a', 'cyc:b', 'def:free'), none)).toEqual(['def:free']);
    const dependent = graphOf(['thm:main', ['cyc:a']], ['cyc:a', ['cyc:b']], ['cyc:b', ['cyc:a']]);
    expect(readyFrontier(dependent, set('thm:main', 'cyc:a', 'cyc:b'), none)).toEqual([]);
    expect(readyFrontier(dependent, set('thm:main'), set('cyc:a'))).toEqual(['thm:main']);
    expect(readyFrontier(graphOf(['cyc:a', ['cyc:b']], ['cyc:b', ['cyc:a']]), set('cyc:b'), set('cyc:a'))).toEqual(['cyc:b']);
    const triangle = graphOf(['cyc:a', ['cyc:b']], ['cyc:b', ['cyc:c']], ['cyc:c', ['cyc:a']]);
    const approved = set('cyc:a', 'cyc:b', 'cyc:c');
    expect(readyFrontier(triangle, approved, none)).toEqual([]);
    expect(readyFrontier(triangle, approved, set('cyc:b'))).toEqual(['cyc:a', 'cyc:c']);
    expect(readyFrontier(triangle, approved, set('cyc:b', 'cyc:a'))).toEqual(['cyc:c']);
  });

  it('reflects a changed or mutated approval set', () => {
    const graph = graphOf(['thm:froda', ['def:base']], ['def:base', []]);
    expect(readyFrontier(graph, set('thm:froda'), none)).toEqual([]);
    expect(readyFrontier(graph, set('thm:froda', 'def:base'), none)).toEqual(['def:base', 'thm:froda']);
    expect(readyFrontier(graph, set('thm:froda'), none)).toEqual([]);
    const approved = set('thm:froda');
    expect(readyFrontier(graph, approved, none)).toEqual([]);
    approved.add('def:base');
    expect(readyFrontier(graph, approved, none)).toEqual(['def:base', 'thm:froda']);
  });
});

describe('blockingDependencies', () => {
  it('names only the deepest unmet work and moves up as approvals land', () => {
    const graph = graphOf(['thm:main', ['lem:cover', 'def:base']], ['lem:cover', ['def:base']], ['def:base', ['def:limit']], ['def:limit', []]);
    expect(blockingDependencies(graph, 'thm:main', set('thm:main'), none)).toEqual(['def:limit']);
    const chain = graphOf(['thm:main', ['lem:cover']], ['lem:cover', ['def:base']], ['def:base', []]);
    expect(blockingDependencies(chain, 'thm:main', set('thm:main', 'def:base'), none)).toEqual(['lem:cover']);
    expect(blockingDependencies(chain, 'thm:main', set('thm:main'), set('lem:cover'))).toEqual([]);
  });

  it('is empty for ready, unknown and externally referencing labels', () => {
    expect(blockingDependencies(graphOf(['thm:main', ['def:base']], ['def:base', []]), 'thm:main', set('thm:main', 'def:base'), none)).toEqual([]);
    expect(blockingDependencies(graphOf(['def:base', []]), 'thm:absent', none, none)).toEqual([]);
    expect(blockingDependencies(graphOf(['thm:main', ['Mathlib.Analysis.Basic']]), 'thm:main', set('thm:main'), none)).toEqual([]);
  });

  it('returns blockers in topological order', () => {
    const graph = graphOf(['thm:main', ['lem:left', 'lem:right']], ['lem:right', []], ['lem:left', []]);
    expect(blockingDependencies(graph, 'thm:main', set('thm:main'), none)).toEqual(['lem:right', 'lem:left']);
  });

  it('explains cycle members by their cycle', () => {
    const graph = graphOf(['cyc:b', ['cyc:a']], ['cyc:a', ['cyc:b', 'def:base']], ['def:base', []]);
    expect(blockingDependencies(graph, 'cyc:a', set('cyc:a', 'cyc:b'), none)).toEqual(['cyc:b', 'cyc:a']);
    const shared = graphOf(['cyc:a', ['cyc:b']], ['cyc:b', ['cyc:a', 'cyc:c']], ['cyc:c', ['cyc:b']]);
    expect(blockingDependencies(shared, 'cyc:b', none, none)).toEqual(['cyc:a', 'cyc:b', 'cyc:c']);
    expect(blockingDependencies(graphOf(['cyc:a', ['cyc:b']], ['cyc:b', ['cyc:a']]), 'cyc:b', set('cyc:b'), set('cyc:a'))).toEqual([]);
    const triangle = graphOf(['cyc:a', ['cyc:b']], ['cyc:b', ['cyc:c']], ['cyc:c', ['cyc:a', 'def:base']], ['def:base', []]);
    expect(blockingDependencies(triangle, 'cyc:c', set('cyc:a', 'cyc:b', 'cyc:c'), set('cyc:b'))).toEqual(['def:base']);
    const dependent = graphOf(['thm:main', ['cyc:a']], ['cyc:a', ['cyc:b']], ['cyc:b', ['cyc:a']]);
    expect(blockingDependencies(dependent, 'thm:main', set('thm:main', 'cyc:a', 'cyc:b'), none)).toEqual(['cyc:a']);
  });

  it('agrees with the frontier', () => {
    const graph = graphOf(['thm:main', ['lem:cover']], ['lem:cover', ['def:base']], ['def:base', []], ['def:free', []]);
    const approved = set('thm:main', 'lem:cover', 'def:free');
    const frontier = readyFrontier(graph, approved, none);
    const unblocked = topologicalOrder(graph).filter((label) => approved.has(label) && blockingDependencies(graph, label, approved, none).length === 0);
    expect(frontier).toEqual(unblocked);
  });

  it('names a cycle nested inside a broken one', () => {
    const graph = graphOf(['cyc:a', ['cyc:c']], ['cyc:b', ['cyc:a']], ['cyc:c', ['cyc:a', 'cyc:d']], ['cyc:d', ['cyc:b']]);
    expect(graph.cycles).toEqual([['cyc:a', 'cyc:b', 'cyc:d', 'cyc:c']]);
    const approved = set('cyc:a', 'cyc:b', 'cyc:c');
    const satisfied = set('cyc:d');
    expect(readyFrontier(graph, approved, satisfied)).toEqual([]);
    for (const label of ['cyc:a', 'cyc:c']) expect(blockingDependencies(graph, label, approved, satisfied)).toEqual(['cyc:a', 'cyc:c']);
    expect(blockingDependencies(graph, 'cyc:b', approved, satisfied)).toEqual(['cyc:a']);
    expect(liveCycles(graph, satisfied)).toEqual([['cyc:a', 'cyc:c']]);
  });
});

describe('liveCycles', () => {
  it('reports undissolved cycles in document order, each group once', () => {
    expect(liveCycles(graphOf(['cyc:a', ['cyc:b']], ['cyc:b', ['cyc:a']], ['def:free', []]), none)).toEqual([['cyc:a', 'cyc:b']]);
    const dissolved = graphOf(['lem:a', ['lem:b']], ['lem:b', ['lem:a']], ['thm:main', ['lem:a']]);
    expect(dissolved.cycles).toEqual([['lem:a', 'lem:b']]);
    expect(liveCycles(dissolved, set('lem:b'))).toEqual([]);
    expect(liveCycles(graphOf(['cyc:c', ['cyc:d']], ['cyc:d', ['cyc:c']], ['cyc:a', ['cyc:b']], ['cyc:b', ['cyc:a']]), none)).toEqual([
      ['cyc:c', 'cyc:d'],
      ['cyc:a', 'cyc:b'],
    ]);
  });
});

// --- random-graph property tests ---

/** A small deterministic PRNG so the fuzz cases are reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sample<T>(random: () => number, items: readonly T[], count: number): T[] {
  const pool = [...items];
  const picked: T[] = [];
  while (picked.length < count) picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  return picked;
}

function randomGraphs(count: number, seed: number): DependencyGraph[] {
  const random = mulberry32(seed);
  const names = ['lab:a', 'lab:b', 'lab:c', 'lab:d', 'lab:e'];
  const graphs: DependencyGraph[] = [];
  for (let index = 0; index < count; index += 1) {
    const labels = sample(random, names, 2 + Math.floor(random() * (names.length - 1)));
    graphs.push(
      graphOf(
        ...labels.map((label): [string, string[]] => {
          const others = labels.filter((other) => other !== label);
          return [label, sample(random, others, Math.floor(random() * labels.length))];
        }),
      ),
    );
  }
  return graphs;
}

function everySubset(labels: readonly string[]): Set<string>[] {
  const subsets: Set<string>[] = [];
  for (let mask = 0; mask < 1 << labels.length; mask += 1) {
    subsets.push(new Set(labels.filter((_, index) => mask & (1 << index))));
  }
  return subsets.sort((a, b) => a.size - b.size);
}

describe('random graph invariants', () => {
  const graphs = randomGraphs(30, 20240607);

  it('mostly generates cyclic graphs', () => {
    expect(graphs.filter((graph) => graph.cycles.length).length).toBeGreaterThan(graphs.length / 2);
  });

  it('makes blocking dependencies the exact complement of the frontier', () => {
    for (const graph of graphs) {
      const subsets = everySubset(graph.labels);
      for (const approved of subsets) {
        for (const satisfied of subsets) {
          const frontier = readyFrontier(graph, approved, satisfied);
          for (const label of [...graph.labels, 'thm:absent']) {
            const blockers = blockingDependencies(graph, label, approved, satisfied);
            const widened = readyFrontier(graph, new Set([...approved, label]), satisfied);
            const context = JSON.stringify({ edges: [...graph.edges], approved: [...approved], satisfied: [...satisfied], label, blockers });
            expect(blockers.length === 0, context).toBe(widened.includes(label) || satisfied.has(label) || !graph.labels.includes(label));
            if (approved.has(label) && !satisfied.has(label)) expect(blockers.length === 0, context).toBe(frontier.includes(label));
            expect(blockers.some((blocker) => satisfied.has(blocker)), context).toBe(false);
            expect(blockers.every((blocker) => graph.labels.includes(blocker)), context).toBe(true);
          }
        }
      }
    }
  });

  it('returns the frontier in dependency order', () => {
    for (const graph of graphs) {
      const subsets = everySubset(graph.labels);
      for (const approved of subsets) {
        for (const satisfied of subsets) {
          const frontier = readyFrontier(graph, approved, satisfied);
          const position = new Map(frontier.map((label, index) => [label, index] as const));
          for (const label of frontier) {
            for (const dependency of graph.edges.get(label)!) {
              if (!position.has(dependency)) continue;
              expect(position.get(dependency)!).toBeLessThan(position.get(label)!);
            }
          }
        }
      }
    }
  });

  it('agrees between live cycles and blocking dependencies', () => {
    for (const graph of graphs) {
      for (const satisfied of everySubset(graph.labels)) {
        const approved = new Set(graph.labels);
        const held = new Set(liveCycles(graph, satisfied).flat());
        for (const label of graph.labels) {
          if (satisfied.has(label)) continue;
          const blockers = blockingDependencies(graph, label, approved, satisfied);
          expect(blockers.includes(label)).toBe(held.has(label));
        }
      }
    }
  });
});

// --- scale ---

function deepChain(depth: number): [string[], DependencyGraph] {
  const labels = Array.from({ length: depth }, (_, index) => `lem:step-${String(index).padStart(4, '0')}`);
  return [labels, graphOf(...labels.map((label, index): [string, string[]] => [label, index ? [labels[index - 1]] : []]))];
}

describe('scale', () => {
  it('answers a deep chain without recursing', () => {
    const depth = 3000;
    const [labels, graph] = deepChain(depth);
    const approved = new Set(labels);
    expect(topologicalOrder(graph)).toEqual(labels);
    expect(transitiveDependencies(graph, labels[labels.length - 1]).size).toBe(depth - 1);
    expect(readyFrontier(graph, approved, none)).toEqual(labels);
    expect(readyFrontier(graph, none, none)).toEqual([]);
    expect(blockingDependencies(graph, labels[labels.length - 1], none, none)).toEqual([labels[0]]);
  });

  it('keeps repeated queries over a deep chain linear', () => {
    const [labels, graph] = deepChain(3000);
    const approved = new Set(labels);
    const started = performance.now();
    for (let repeat = 0; repeat < 25; repeat += 1) expect(readyFrontier(graph, none, none)).toEqual([]);
    for (let repeat = 0; repeat < 25; repeat += 1) expect(readyFrontier(graph, approved, none)).toEqual(labels);
    for (const label of labels.slice(0, 200)) expect(blockingDependencies(graph, label, approved, none)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it('answers a wide fan-out from one sweep', () => {
    const root = 'def:root';
    const dependents = Array.from({ length: 4000 }, (_, index) => `lem:cite-${String(index).padStart(4, '0')}`);
    const graph = graphOf([root, []], ...dependents.map((label): [string, string[]] => [label, [root]]));
    const withoutRoot = new Set(dependents);
    const withRoot = new Set([...dependents, root]);
    const started = performance.now();
    expect(readyFrontier(graph, withoutRoot, none)).toEqual([]);
    for (const label of dependents) expect(blockingDependencies(graph, label, withoutRoot, none)).toEqual([root]);
    expect(readyFrontier(graph, withRoot, none)).toEqual([root, ...dependents]);
    for (const label of [root, ...dependents]) expect(blockingDependencies(graph, label, withRoot, none)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(5000);
  });
});
