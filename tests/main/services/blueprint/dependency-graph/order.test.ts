import { describe, expect, it } from 'vitest';
import { heapOrder } from '@main/services/blueprint/dependency-graph/order';
import type { DependencyGraph } from '@main/services/blueprint/dependency-graph';

describe('dependency graph ordering seam', () => {
  it('uses document position to break every ready-node tie', () => {
    const labels = ['goal', 'zeta', 'alpha', 'orphan'];
    const orderable = new Map([
      ['goal', ['zeta', 'alpha']],
      ['zeta', []],
      ['alpha', []],
      ['orphan', []],
    ]);
    const graph: DependencyGraph = {
      labels,
      edges: orderable,
      externalReferences: new Map(),
      cycles: [],
    };

    expect(heapOrder(graph, orderable)).toEqual(['zeta', 'alpha', 'goal', 'orphan']);
  });
});
