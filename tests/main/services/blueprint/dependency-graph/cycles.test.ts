import { describe, expect, it } from 'vitest';
import { detectCycles, liveCycleGroups } from '@main/services/blueprint/dependency-graph/cycles';
import type { DependencyGraph } from '@main/services/blueprint/dependency-graph';

function graph(edges: Array<[string, string[]]>): DependencyGraph {
  return {
    labels: edges.map(([label]) => label),
    edges: new Map(edges),
    externalReferences: new Map(),
    cycles: [],
  };
}

describe('dependency graph cycle diagnostics seam', () => {
  it('normalizes build-time cycles in stable order', () => {
    const edges = new Map([
      ['b', ['a']],
      ['a', ['b']],
      ['self', ['self']],
      ['free', []],
    ]);

    expect(detectCycles([...edges.keys()], edges)).toEqual([['a', 'b'], ['self']]);
  });

  it('removes satisfied labels before finding live components', () => {
    const cyclic = graph([['a', ['b']], ['b', ['a']], ['self', ['self']], ['free', []]]);
    const groups = liveCycleGroups(cyclic, new Set(['b']));

    expect(groups.has('a')).toBe(false);
    expect(groups.get('self')).toEqual(new Set(['self']));
  });
});
