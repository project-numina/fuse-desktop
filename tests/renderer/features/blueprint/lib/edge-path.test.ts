import { describe, expect, it } from 'vitest';

import { smoothEdgePath } from '@/features/blueprint/lib/edge-path';

describe('smoothEdgePath', () => {
  it('requires at least two points', () => {
    expect(smoothEdgePath([])).toBe('');
    expect(smoothEdgePath([{ x: 1, y: 2 }])).toBe('');
  });

  it('draws two points as a straight segment', () => {
    expect(smoothEdgePath([{ x: 0, y: 0 }, { x: 10, y: 20 }])).toBe('M0,0 L10,20');
  });

  it('rounds each interior bend through the next midpoint', () => {
    expect(smoothEdgePath([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 10 },
    ])).toBe('M0,0 Q10,0 10,5 Q10,10 15,10 L20,10');
  });
});
