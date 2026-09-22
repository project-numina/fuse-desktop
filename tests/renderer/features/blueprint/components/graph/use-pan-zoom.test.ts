import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePanZoom } from '@/features/blueprint/components/graph/use-pan-zoom';

let nextFrameId = 1;
let frames = new Map<number, FrameRequestCallback>();

function rect(width: number, height: number, left = 0, top = 0): DOMRect {
  return {
    width,
    height,
    left,
    top,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

function flushFrames(limit = 200): void {
  let count = 0;
  while (frames.size > 0 && count < limit) {
    const pending = [...frames.entries()];
    frames.clear();
    for (const [, callback] of pending) callback(count * 16);
    count += 1;
  }
  expect(count).toBeLessThan(limit);
}

beforeEach(() => {
  frames = new Map();
  nextFrameId = 1;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = nextFrameId++;
    frames.set(id, callback);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id);
  });
});

afterEach(() => {
  document.body.style.cursor = '';
  vi.restoreAllMocks();
});

function setup(options?: { fitMargin?: number; fitMaxScale?: number }) {
  const container = document.createElement('div');
  const viewport = document.createElement('div');
  container.getBoundingClientRect = () => rect(500, 300, 10, 20);
  const containerRef = { current: container };
  const viewportRef = { current: viewport };
  const getLayoutSize = vi.fn(() => ({ width: 200, height: 100 }));
  const hook = renderHook(() => usePanZoom(
    containerRef,
    viewportRef,
    getLayoutSize,
    options,
  ));
  return { ...hook, container, viewport, getLayoutSize };
}

describe('usePanZoom', () => {
  it('fits the graph with the configured margin and maximum scale', () => {
    const { result, viewport, getLayoutSize } = setup({ fitMargin: 20, fitMaxScale: 2 });

    act(() => result.current.fit());

    expect(getLayoutSize).toHaveBeenCalledOnce();
    expect(viewport.style.transform).toBe('translate(50px, 50px) scale(2)');
  });

  it('ignores impossible fits and non-primary drags', () => {
    const { result, container, viewport } = setup();
    container.getBoundingClientRect = () => rect(0, 300);

    act(() => result.current.fit());
    act(() => result.current.onCanvasMouseDown(new MouseEvent('mousedown', {
      button: 1,
      clientX: 10,
      clientY: 10,
    })));
    act(() => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 50 })));

    expect(viewport.style.transform).toBe('');
    expect(document.body.style.cursor).toBe('');
  });

  it('pans immediately and releases the global cursor on mouseup', () => {
    const { result, viewport } = setup();

    act(() => result.current.onCanvasMouseDown(new MouseEvent('mousedown', {
      button: 0,
      clientX: 20,
      clientY: 30,
    })));
    expect(document.body.style.cursor).toBe('grabbing');

    act(() => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 55, clientY: 80 })));
    expect(viewport.style.transform).toBe('translate(35px, 50px) scale(1)');

    act(() => window.dispatchEvent(new MouseEvent('mouseup')));
    expect(document.body.style.cursor).toBe('');
    act(() => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 100 })));
    expect(viewport.style.transform).toBe('translate(35px, 50px) scale(1)');
  });

  it('smoothly zooms around the wheel cursor and removes compositor hints when settled', () => {
    const { result, viewport } = setup();
    const event = new WheelEvent('wheel', {
      cancelable: true,
      clientX: 260,
      clientY: 170,
      deltaY: -100,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
    });

    act(() => result.current.onWheel(event));
    expect(event.defaultPrevented).toBe(true);
    expect(viewport.style.willChange).toBe('transform');

    act(() => flushFrames());

    // The per-event delta is capped at 80, and the cursor is relative to the
    // container's (10, 20) origin.
    const scale = Math.exp(80 * 0.0014);
    const x = 250 - 250 * scale;
    const y = 150 - 150 * scale;
    expect(viewport.style.transform).toBe(`translate(${x}px, ${y}px) scale(${scale})`);
    expect(viewport.style.willChange).toBe('');
    expect(viewport.style.backfaceVisibility).toBe('');
  });

  it('anchors button zoom on the viewport centre and cancels an in-flight frame on unmount', () => {
    const { result, viewport, unmount } = setup();

    act(() => result.current.zoomIn());
    expect(viewport.style.willChange).toBe('transform');
    expect(frames.size).toBe(1);

    unmount();

    expect(frames.size).toBe(0);
    expect(viewport.style.willChange).toBe('');
    expect(viewport.style.backfaceVisibility).toBe('');
  });

  it('clears a drag that is still active when the hook unmounts', () => {
    const { result, unmount } = setup();
    act(() => result.current.onCanvasMouseDown(new MouseEvent('mousedown', {
      button: 0,
      clientX: 20,
      clientY: 30,
    })));
    expect(document.body.style.cursor).toBe('grabbing');

    unmount();

    expect(document.body.style.cursor).toBe('');
  });
});
