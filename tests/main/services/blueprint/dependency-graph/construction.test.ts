import { describe, expect, it } from 'vitest';
import { constructDependencyGraph } from '@main/services/blueprint/dependency-graph/construction';

describe('dependency graph construction seam', () => {
  it('preserves authored order while separating internal and external references', () => {
    const graph = constructDependencyGraph([
      { label: 'goal', uses: ['base', 'Mathlib.fact', 'base'] },
      { label: 'base', uses: [] },
      { label: 'goal', uses: [] },
    ]);

    expect(graph.labels).toEqual(['goal', 'base']);
    expect(graph.edges).toEqual(new Map([['goal', ['base']], ['base', []]]));
    expect(graph.externalReferences).toEqual(new Map([['goal', ['Mathlib.fact']]]));
  });
});
