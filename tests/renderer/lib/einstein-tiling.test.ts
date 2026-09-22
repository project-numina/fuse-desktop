import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateTiling, renderTiling } from '@/lib/einstein-tiling';

describe('Einstein tiling', () => {
  afterEach(() => {
    document.documentElement.classList.remove('dark');
    delete document.documentElement.dataset.theme;
    vi.unstubAllGlobals();
  });

  it('preserves deterministic substitution counts and traversal order', () => {
    const expectedGenerations = [
      { total: 4, labels: { H: 3, H1: 1 } },
      { total: 25, labels: { H: 9, H1: 3, T: 1, P: 6, F: 6 } },
      { total: 169, labels: { H: 66, H1: 22, T: 3, P: 30, F: 48 } },
      { total: 1156, labels: { H: 441, H1: 147, T: 22, P: 210, F: 336 } },
    ];

    for (const [iterations, expected] of expectedGenerations.entries()) {
      const hats = generateTiling(iterations);
      const labels = Object.fromEntries(
        Object.keys(expected.labels).map(label => [
          label,
          hats.filter(hat => hat.label === label).length,
        ]),
      );
      expect(hats).toHaveLength(expected.total);
      expect(labels).toEqual(expected.labels);
      expect(hats[0].label).toBe('H');
      expect(hats[0].points[0].x).toBeCloseTo([1, -3.5, -9.5, -25][iterations]);
    }
  });

  it('generates labelled thirteen-point finite polygons', () => {
    for (const hat of generateTiling(2)) {
      expect(hat.points).toHaveLength(13);
      expect(['H', 'H1', 'T', 'P', 'F']).toContain(hat.label);
      expect(
        hat.points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)),
      ).toBe(true);
    }
  });

  it('renders visible hats to a high-DPI canvas', () => {
    const context = {
      setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(),
      fill: vi.fn(), stroke: vi.fn(),
      strokeStyle: '', lineWidth: 0, fillStyle: '',
    };
    const canvas = {
      getContext: () => context,
      width: 0,
      height: 0,
      style: {},
    } as unknown as HTMLCanvasElement;
    vi.stubGlobal('innerWidth', 800);
    vi.stubGlobal('innerHeight', 600);
    vi.stubGlobal('devicePixelRatio', 2);
    renderTiling(canvas, generateTiling(1));
    expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
    expect(context.beginPath).toHaveBeenCalled();
    expect(context.stroke).toHaveBeenCalled();
  });
});
