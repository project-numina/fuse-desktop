import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyCardTops,
  buildDeclarations,
  editorToCardOffset,
  measureDeclarationTop,
} from '@/features/blueprint/hooks/card-positioning/measurement';

function box(top: number): DOMRect {
  return {
    top,
    bottom: top + 20,
    left: 0,
    right: 300,
    width: 300,
    height: 20,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

function editor(): EditorView {
  const dom = document.createElement('div');
  const scrollDOM = document.createElement('div');
  scrollDOM.getBoundingClientRect = () => box(80);
  Object.defineProperties(scrollDOM, {
    scrollTop: { configurable: true, writable: true, value: 10 },
    scrollHeight: { configurable: true, value: 500 },
  });
  return {
    dom,
    scrollDOM,
    coordsAtPos: vi.fn(() => null),
    lineBlockAt: vi.fn(() => null),
    state: {
      doc: {
        lines: 3,
        line: (line: number) => ({ from: line * 10, to: line * 10 + 9 }),
      },
    },
  } as unknown as EditorView;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('card positioning measurements', () => {
  it('builds only valid keyed declaration ranges', () => {
    const view = editor();
    expect(buildDeclarations(
      view,
      [
        { entry: { label: 'one' }, declKey: 'one' },
        { entry: null, declKey: 'ignored' },
        { entry: { label: 'three' }, declKey: 'three' },
      ],
      [1, 2, 4],
      [2, 2, 3],
    )).toEqual([{ key: 'one', pos: 10, spacerPos: 29 }]);
  });

  it('prefers rendered anchors, then coordinates, then the height map', () => {
    vi.stubGlobal('CSS', { escape: (value: string) => value });
    const view = editor();
    const anchor = document.createElement('div');
    anchor.dataset.declAnchor = 'decl';
    anchor.getBoundingClientRect = () => box(140);
    view.dom.append(anchor);
    expect(measureDeclarationTop(view, 10, 'decl', 100)).toBe(40);

    anchor.remove();
    vi.mocked(view.coordsAtPos).mockReturnValue({ top: 155 } as DOMRect);
    expect(measureDeclarationTop(view, 10, 'decl', 100)).toBe(55);

    vi.mocked(view.coordsAtPos).mockReturnValue(null);
    vi.mocked(view.lineBlockAt).mockReturnValue({ top: 90 } as ReturnType<EditorView['lineBlockAt']>);
    expect(measureDeclarationTop(view, 10, 'decl', 100)).toBe(60);
    vi.mocked(view.lineBlockAt).mockReturnValue(null as unknown as ReturnType<EditorView['lineBlockAt']>);
    expect(measureDeclarationTop(view, 10, 'decl', 100)).toBeNull();
  });

  it('positions cards and measures the editor-to-pane offset', () => {
    vi.stubGlobal('CSS', { escape: (value: string) => value });
    const view = editor();
    const pane = document.createElement('aside');
    pane.getBoundingClientRect = () => box(100);
    const anchor = document.createElement('div');
    anchor.dataset.declAnchor = 'one';
    anchor.getBoundingClientRect = () => box(125);
    view.dom.append(anchor);
    const card = document.createElement('article');
    Object.defineProperty(card, 'offsetHeight', { configurable: true, value: 40 });
    const setTops = vi.fn();

    expect(applyCardTops(
      view,
      pane,
      [card],
      [{ key: 'one', pos: 10, spacerPos: 19 }],
      setTops,
    )).toBe(true);
    expect(card.style.top).toBe('25px');
    expect(pane.style.minHeight).toBe('81px');
    expect(setTops).toHaveBeenCalledWith({ one: 25 });
    expect(editorToCardOffset(view, pane)).toBe(-20);
    expect(editorToCardOffset(view, null)).toBeNull();
  });

  it('fails without mutating state when a card is missing', () => {
    vi.stubGlobal('CSS', { escape: (value: string) => value });
    const setTops = vi.fn();
    expect(applyCardTops(
      editor(),
      document.createElement('aside'),
      [],
      [{ key: 'one', pos: 10, spacerPos: 19 }],
      setTops,
    )).toBe(false);
    expect(setTops).not.toHaveBeenCalled();
  });
});
