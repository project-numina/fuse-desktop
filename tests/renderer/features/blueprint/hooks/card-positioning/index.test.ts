import { act, renderHook } from '@testing-library/react';
import type { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCardPositioning } from '@/features/blueprint/hooks/card-positioning';

interface ObserverDouble {
  callback: ResizeObserverCallback;
  observe: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

const observers: ObserverDouble[] = [];
let frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;

function box(top: number, width = 300, height = 20): DOMRect {
  return {
    top,
    left: 0,
    right: width,
    bottom: top + height,
    width,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

function flushFrames(limit = 50): void {
  let pass = 0;
  while (frames.size > 0 && pass < limit) {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(pass * 16));
    pass += 1;
  }
  expect(pass).toBeLessThan(limit);
}

function flushScheduledLayout(): void {
  act(() => {
    vi.runAllTimers();
    flushFrames();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  observers.length = 0;
  frames = new Map();
  nextFrameId = 1;
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    constructor(public callback: ResizeObserverCallback) {
      observers.push(this);
    }
  });
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = nextFrameId++;
    frames.set(id, callback);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id);
  });
  vi.stubGlobal('CSS', { escape: (value: string) => value });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(showAnnotations = true, active = true) {
  const root = document.createElement('section');
  Object.defineProperty(root, 'offsetParent', { configurable: true, value: document.body });
  root.getBoundingClientRect = () => box(0, 500, 400);

  const cardLayer = document.createElement('aside');
  cardLayer.className = 'edit-card-pane';
  cardLayer.getBoundingClientRect = () => box(100, 240, 300);
  const cards = [60, 40].map((height) => {
    const card = document.createElement('article');
    card.className = 'edit-card-position';
    Object.defineProperty(card, 'offsetHeight', { configurable: true, value: height });
    cardLayer.append(card);
    return card;
  });
  root.append(cardLayer);

  const editorDom = document.createElement('div');
  const anchorTops = [120, 170];
  ['first', 'second'].forEach((key, index) => {
    const anchor = document.createElement('div');
    anchor.dataset.declAnchor = key;
    anchor.getBoundingClientRect = () => box(anchorTops[index]);
    editorDom.append(anchor);
  });

  const scrollDOM = document.createElement('div');
  scrollDOM.getBoundingClientRect = () => box(100, 300, 200);
  Object.defineProperties(scrollDOM, {
    scrollTop: { configurable: true, writable: true, value: 0 },
    scrollHeight: { configurable: true, value: 200 },
  });
  const dispatch = vi.fn();
  const editor = {
    dom: editorDom,
    scrollDOM,
    dispatch,
    coordsAtPos: vi.fn(() => null),
    lineBlockAt: vi.fn(() => null),
    state: {
      doc: {
        lines: 3,
        line: (line: number) => ({ from: (line - 1) * 10, to: line * 10 - 1 }),
      },
    },
  } as unknown as EditorView;

  const props = {
    root: { current: root },
    viewRef: { current: editor },
    showAnnotations,
    declarationSegments: [
      { entry: { label: 'First' }, declKey: 'first' },
      { entry: { label: 'Second' }, declKey: 'second' },
    ],
    declarationStartLines: [1, 2],
    declarationEndLines: [1, 2],
    source: 'source',
    active,
  };
  const hook = renderHook(
    (current: typeof props) => useCardPositioning(current),
    { initialProps: props },
  );
  return { ...hook, props, root, cardLayer, cards, editor, dispatch, anchorTops };
}

describe('useCardPositioning', () => {
  it('measures declaration anchors, positions cards, and exposes completion state', () => {
    const { result, cards, cardLayer, dispatch } = setup();

    act(() => result.current.scheduleLayout());
    flushScheduledLayout();

    expect(cards.map(card => card.style.top)).toEqual(['20px', '70px']);
    expect(cardLayer.style.minHeight).toBe('126px');
    expect(result.current.cardTopByDeclKey).toEqual({ first: 20, second: 70 });
    expect(result.current.layoutReady).toBe(true);
    // One transaction installs anchors and another installs computed spacers.
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('clears card layout when annotations become hidden', () => {
    const { result, rerender, props, cardLayer, dispatch } = setup();
    act(() => result.current.scheduleLayout());
    flushScheduledLayout();
    dispatch.mockClear();

    rerender({ ...props, showAnnotations: false });
    flushScheduledLayout();

    expect(result.current.layoutReady).toBe(true);
    expect(result.current.cardTopByDeclKey).toEqual({});
    expect(cardLayer.style.minHeight).toBe('');
    expect(dispatch).toHaveBeenCalledOnce();

    dispatch.mockClear();
    rerender({ ...props, showAnnotations: true });
    expect(result.current.layoutReady).toBe(false);
    flushScheduledLayout();
    expect(result.current.layoutReady).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(6);
  });

  it('treats invalid declarations as an empty layout instead of measuring them', () => {
    const { result, rerender, props, dispatch } = setup();
    rerender({ ...props, declarationStartLines: [0, 99] });

    flushScheduledLayout();

    expect(result.current.cardTopByDeclKey).toEqual({});
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it('does no work while inactive, then uses current props when explicitly scheduled', () => {
    const { result, rerender, props, dispatch } = setup(true, false);
    act(() => result.current.scheduleLayout());
    flushScheduledLayout();
    expect(dispatch).not.toHaveBeenCalled();

    rerender({ ...props, active: true });
    act(() => result.current.scheduleLayout());
    flushScheduledLayout();
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('responds to width changes and disconnects both observers on unmount', () => {
    const { result, dispatch, root, unmount } = setup();
    act(() => result.current.scheduleLayout());
    flushScheduledLayout();
    dispatch.mockClear();

    const layoutObserver = observers[0];
    act(() => layoutObserver.callback([{
      target: root,
      contentRect: box(0, 500, 400),
    } as unknown as ResizeObserverEntry], layoutObserver as unknown as ResizeObserver));
    flushScheduledLayout();
    expect(dispatch).toHaveBeenCalledTimes(2);

    unmount();
    expect(observers).toHaveLength(2);
    expect(observers.every(observer => observer.disconnect.mock.calls.length === 1)).toBe(true);
  });

  it('refreshes card tops without recomputing spacers and relayouts after card reflow', () => {
    const { result, cards, dispatch, anchorTops } = setup();
    act(() => result.current.scheduleLayout());
    flushScheduledLayout();
    dispatch.mockClear();

    anchorTops[0] = 135;
    act(() => result.current.schedulePositionRefresh());
    flushScheduledLayout();
    expect(cards[0].style.top).toBe('35px');
    expect(result.current.cardTopByDeclKey.first).toBe(35);
    expect(dispatch).not.toHaveBeenCalled();

    const cardObserver = observers[1];
    act(() => cardObserver.callback([{
      target: cards[0],
      borderBoxSize: [{ blockSize: 80 }],
    } as unknown as ResizeObserverEntry], cardObserver as unknown as ResizeObserver));
    flushScheduledLayout();
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('cancels delayed layouts and bursts when unmounted', () => {
    const { result, unmount, dispatch } = setup();
    act(() => {
      result.current.scheduleLayout(100);
      result.current.scheduleLayoutBurst([150, 250]);
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();
    act(() => vi.runAllTimers());
    flushFrames();

    expect(vi.getTimerCount()).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
