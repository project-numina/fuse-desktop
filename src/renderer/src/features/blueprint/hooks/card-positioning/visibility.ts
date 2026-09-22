import type { EditorView } from '@codemirror/view';

import {
  MEASUREMENT_TOLERANCE,
  type MachineDeps,
} from './types';

interface VisibilityCallbacks {
  scheduleLayout: (delay?: number) => void;
  schedulePositionRefresh: (delay?: number) => void;
  updateEditorToCardOffset: (editor: EditorView) => boolean;
}

export interface CardVisibilityController {
  mount: () => void;
  unmount: () => void;
  observeCards: (cards: HTMLElement[]) => void;
  seedCardHeights: (cards: HTMLElement[], heights: number[]) => void;
  suppressObserverUntilNextFrame: () => void;
}

export function createCardVisibilityController(
  deps: MachineDeps,
  callbacks: VisibilityCallbacks,
): CardVisibilityController {
  let resizeObserver: ResizeObserver | null = null;
  let cardResizeObserver: ResizeObserver | null = null;
  let observedEditor: HTMLElement | null = null;
  let suppressResizeObserver = false;
  let suppressFrame = 0;
  const observedCards = new Set<Element>();
  const lastWidth = new WeakMap<Element, number>();
  const lastCardHeight = new WeakMap<Element, number>();

  function suppressObserverUntilNextFrame(): void {
    suppressResizeObserver = true;
    if (suppressFrame) cancelAnimationFrame(suppressFrame);
    suppressFrame = requestAnimationFrame(() => {
      suppressFrame = 0;
      suppressResizeObserver = false;
    });
  }

  function observeEditor(editor: EditorView | null): void {
    if (!resizeObserver) return;
    if (observedEditor) {
      resizeObserver.unobserve(observedEditor);
      lastWidth.delete(observedEditor);
      observedEditor = null;
    }
    if (editor?.scrollDOM) {
      observedEditor = editor.scrollDOM;
      resizeObserver.observe(observedEditor);
    }
  }

  function observeCards(cards: HTMLElement[]): void {
    if (!cardResizeObserver) return;
    const next = new Set<Element>(cards);
    for (const card of observedCards) {
      if (next.has(card)) continue;
      cardResizeObserver.unobserve(card);
      observedCards.delete(card);
      lastCardHeight.delete(card);
    }
    for (const card of cards) {
      if (observedCards.has(card)) continue;
      cardResizeObserver.observe(card);
      observedCards.add(card);
    }
  }

  function seedCardHeights(cards: HTMLElement[], heights: number[]): void {
    cards.forEach((card, index) => lastCardHeight.set(card, heights[index]));
  }

  function widthChanged(entries: ResizeObserverEntry[]): boolean {
    let changed = false;
    for (const entry of entries) {
      const width = entry.contentRect.width;
      const previous = lastWidth.get(entry.target);
      if (previous === undefined || Math.abs(width - previous) > MEASUREMENT_TOLERANCE) {
        changed = true;
      }
      lastWidth.set(entry.target, width);
    }
    return changed;
  }

  function handleLayoutResize(entries: ResizeObserverEntry[]): void {
    if (suppressResizeObserver) return;
    const editor = deps.viewRef.current;
    const offsetChanged = editor ? callbacks.updateEditorToCardOffset(editor) : false;
    if (widthChanged(entries)) callbacks.scheduleLayout();
    else if (offsetChanged) callbacks.schedulePositionRefresh();
  }

  function handleCardResize(entries: ResizeObserverEntry[]): void {
    let changed = false;
    for (const entry of entries) {
      const height = entry.borderBoxSize?.[0]?.blockSize
        ?? (entry.target as HTMLElement).offsetHeight;
      const previous = lastCardHeight.get(entry.target);
      if (previous !== undefined
          && Math.abs(height - previous) > MEASUREMENT_TOLERANCE) changed = true;
      lastCardHeight.set(entry.target, height);
    }
    if (changed) callbacks.scheduleLayout();
  }

  const handleWindowResize = (): void => callbacks.scheduleLayout();

  function mount(): void {
    resizeObserver = new ResizeObserver(handleLayoutResize);
    if (deps.rootRef.current) resizeObserver.observe(deps.rootRef.current);
    observeEditor(deps.viewRef.current);
    cardResizeObserver = new ResizeObserver(handleCardResize);
    window.addEventListener('resize', handleWindowResize);
    if (typeof document !== 'undefined' && document.fonts) {
      void document.fonts.ready.then(() => callbacks.scheduleLayout());
    }
  }

  function unmount(): void {
    window.removeEventListener('resize', handleWindowResize);
    resizeObserver?.disconnect();
    resizeObserver = null;
    observedEditor = null;
    cardResizeObserver?.disconnect();
    cardResizeObserver = null;
    observedCards.clear();
    if (suppressFrame) cancelAnimationFrame(suppressFrame);
  }

  return {
    mount,
    unmount,
    observeCards,
    seedCardHeights,
    suppressObserverUntilNextFrame,
  };
}
