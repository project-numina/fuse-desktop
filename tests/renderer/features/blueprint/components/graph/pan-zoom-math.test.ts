import { describe, expect, it } from 'vitest';

import {
  fitView,
  smoothView,
  wheelZoomFactor,
  zoomAroundPoint,
} from '@/features/blueprint/components/graph/pan-zoom-math';

describe('pan and zoom math', () => {
  it('keeps the anchored graph point fixed while clamping scale bounds', () => {
    const view = { scale: 1, translate: { x: 10, y: 20 } };
    expect(zoomAroundPoint(view, { x: 100, y: 80 }, 10)).toEqual({
      scale: 2.5,
      translate: { x: -125, y: -70 },
    });
    expect(zoomAroundPoint(view, { x: 100, y: 80 }, 0.01).scale).toBe(0.25);
  });

  it('normalizes line wheels and caps unusually large pixel deltas', () => {
    expect(wheelZoomFactor(-5, WheelEvent.DOM_DELTA_LINE))
      .toBe(Math.exp(80 * 0.0014));
    expect(wheelZoomFactor(-1000, WheelEvent.DOM_DELTA_PIXEL))
      .toBe(Math.exp(80 * 0.0014));
  });

  it('centers a valid fit and rejects zero-sized geometry', () => {
    expect(fitView(
      { width: 500, height: 300 },
      { width: 200, height: 100 },
      { fitMargin: 20, fitMaxScale: 2 },
    )).toEqual({ scale: 2, translate: { x: 50, y: 50 } });
    expect(fitView(
      { width: 0, height: 300 },
      { width: 200, height: 100 },
      { fitMargin: 20, fitMaxScale: 2 },
    )).toBeNull();
  });

  it('interpolates distant views and snaps imperceptible remaining drift', () => {
    const current = { scale: 1, translate: { x: 0, y: 0 } };
    const target = { scale: 2, translate: { x: 100, y: -50 } };
    expect(smoothView(current, target)).toEqual({
      settled: false,
      view: { scale: 1.18, translate: { x: 18, y: -9 } },
    });
    expect(smoothView(
      { scale: 1.9998, translate: { x: 99.8, y: -49.8 } },
      target,
    )).toEqual({ settled: true, view: target });
  });
});
