import { describe, expect, it } from 'vitest';

import type { ParsedEntry } from '@/features/blueprint/lib/chapter-entries';
import { buildElkGraph, EMPTY_LAYOUT, ELK_OPTIONS, mapElkResult } from '@/features/blueprint/lib/graph-layout';
import type { GraphNodeDimensions } from '@/features/blueprint/lib/graph-node-sizing';

function entry(label: string, uses: string[] = []): ParsedEntry {
  return {
    kind: 'theorem',
    label,
    title: label,
    uses,
    status: 'not_started',
    leanName: '',
  };
}

const fallback: GraphNodeDimensions = { width: 100, height: 50 };

describe('buildElkGraph', () => {
  it('uses measured node dimensions with a fallback', () => {
    const graph = buildElkGraph(
      [entry('a'), entry('b')],
      new Map([['a', { width: 200, height: 80 }]]),
      fallback,
    );
    expect(graph).toMatchObject({
      id: 'root',
      children: [
        { id: 'a', width: 200, height: 80 },
        { id: 'b', width: 100, height: 50 },
      ],
    });
    expect(graph.layoutOptions).toBe(ELK_OPTIONS);
  });

  it('creates dependency edges only between known entries', () => {
    expect(buildElkGraph(
      [entry('a', ['b', 'ghost', 'b']), entry('b')],
      new Map(),
      fallback,
    ).edges).toEqual([
      { id: 'b->a', sources: ['b'], targets: ['a'] },
      { id: 'b->a', sources: ['b'], targets: ['a'] },
    ]);
  });
});

describe('mapElkResult', () => {
  it('centers nodes and flattens edge sections to polylines', () => {
    const layout = mapElkResult({
      width: 300,
      height: 200,
      children: [{ id: 'a', x: 10, y: 20, width: 100, height: 50 }],
      edges: [{
        sources: ['b'],
        targets: ['a'],
        sections: [{
          startPoint: { x: 0, y: 0 },
          bendPoints: [{ x: 5, y: 5 }],
          endPoint: { x: 10, y: 10 },
        }],
      }],
    }, [entry('a')], fallback);
    expect(layout).toMatchObject({
      width: 300,
      height: 200,
      nodes: [{ label: 'a', x: 60, y: 45, width: 100, height: 50 }],
      edges: [{
        source: 'b',
        target: 'a',
        points: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }],
      }],
    });
  });

  it('handles omitted ELK values', () => {
    const layout = mapElkResult({
      children: [{ id: 'a' }],
      edges: [{ sources: ['b'], targets: ['a'] }],
    }, [entry('a')], fallback);
    expect(layout.nodes[0]).toMatchObject({ width: 100, height: 50, x: 50, y: 25 });
    expect(layout.edges[0].points).toEqual([]);
    expect(layout.width).toBe(0);
    expect(layout.height).toBe(0);
  });
});

it('exports an empty layout constant', () => {
  expect(EMPTY_LAYOUT).toEqual({ nodes: [], edges: [], width: 0, height: 0 });
});
