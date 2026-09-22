import type { TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import { setCardSpacers } from '@/features/blueprint/lib/card-spacers';
import { setDeclarationAnchors } from '@/features/blueprint/lib/declaration-anchors';
import {
  applyCardTops,
  buildDeclarations,
  editorToCardOffset,
  measureContentBottom,
  measureDeclarationTop,
} from './measurement';
import {
  CARD_GAP,
  cardLayoutAnnotation,
  type DeclarationLayout,
  type MachineDeps,
  MAX_MISMATCH_RETRIES,
  MEASUREMENT_TOLERANCE,
} from './types';

interface VisibilityControls {
  observeCards: (cards: HTMLElement[]) => void;
  seedCardHeights: (cards: HTMLElement[], heights: number[]) => void;
  suppressObserverUntilNextFrame: () => void;
}

interface LayoutControls extends VisibilityControls {
  scheduleLayout: (delay?: number) => void;
}

export interface CardLayoutEngine {
  runLayout: () => boolean;
  refreshCardPositions: () => boolean;
  updateEditorToCardOffset: (editor: EditorView) => boolean;
}

interface SpacerResult {
  specs: { pos: number; height: number }[];
  heights: Map<string, number>;
}

export function isLayoutActive(deps: MachineDeps): boolean {
  return (deps.activeRef.current ?? true)
    && deps.rootRef.current !== null
    && deps.rootRef.current.offsetParent !== null;
}

export function createCardLayoutEngine(
  deps: MachineDeps,
  controls: LayoutControls,
): CardLayoutEngine {
  let lastIdentity = '';
  let lastOffset: number | null = null;
  let mismatchRetries = 0;
  const lastSpacerHeights = new Map<string, number>();

  const getCardLayer = (): HTMLElement | null =>
    deps.rootRef.current?.querySelector(deps.cardPaneSelector) as HTMLElement | null;
  const getCards = (layer: HTMLElement): HTMLElement[] =>
    [...layer.querySelectorAll(deps.cardSelector)] as HTMLElement[];

  function declarations(editor: EditorView): DeclarationLayout[] {
    return buildDeclarations(
      editor,
      deps.declarationSegmentsRef.current.slice(),
      deps.declarationStartLinesRef.current.slice(),
      deps.declarationEndLinesRef.current.slice(),
    );
  }

  function dispatch(editor: EditorView, effects: TransactionSpec['effects']): void {
    editor.dispatch({ annotations: cardLayoutAnnotation.of(true), effects });
  }

  function clear(editor: EditorView): void {
    dispatch(editor, [setCardSpacers.of([]), setDeclarationAnchors.of([])]);
    getCardLayer()?.style.removeProperty('min-height');
    deps.setCardTopByDeclKey({});
    lastSpacerHeights.clear();
    lastIdentity = '';
    lastOffset = null;
    mismatchRetries = 0;
  }

  function updateEditorToCardOffset(editor: EditorView): boolean {
    const offset = editorToCardOffset(editor, getCardLayer());
    if (offset === null) return false;
    const changed = lastOffset === null
      || Math.abs(offset - lastOffset) > MEASUREMENT_TOLERANCE;
    lastOffset = offset;
    return changed;
  }

  function refreshCardPositions(): boolean {
    const editor = deps.viewRef.current;
    if (!deps.rootRef.current || !editor || !isLayoutActive(deps)) return false;
    if (!deps.showAnnotationsRef.current) return true;
    const layer = getCardLayer();
    if (!layer) return false;
    const cards = getCards(layer);
    const current = declarations(editor);
    if (current.length !== cards.length) return false;
    return applyCardTops(editor, layer, cards, current, deps.setCardTopByDeclKey);
  }

  function declarationIdentity(current: DeclarationLayout[]): string {
    return current.map((declaration, index) => `${index}:${declaration.key}`).join('|');
  }

  function installAnchors(
    editor: EditorView,
    current: DeclarationLayout[],
    sameSet: boolean,
  ): void {
    const anchors = setDeclarationAnchors.of(
      current.map(({ pos, key }) => ({ pos, key })),
    );
    if (!sameSet && lastIdentity) dispatch(editor, [anchors, setCardSpacers.of([])]);
    else dispatch(editor, anchors);
  }

  function spacerHeight(
    naturalGap: number,
    cardHeight: number,
  ): number {
    return Math.max(0, cardHeight + CARD_GAP - naturalGap);
  }

  function computeSpacers(
    editor: EditorView,
    paneTop: number,
    current: DeclarationLayout[],
    anchorTops: number[],
    cardHeights: number[],
    sameSet: boolean,
  ): SpacerResult {
    const specs: SpacerResult['specs'] = [];
    const heights = new Map<string, number>();
    for (let index = 0; index < current.length; index++) {
      const key = `${index}:${current[index].key}`;
      const previous = sameSet ? (lastSpacerHeights.get(key) ?? 0) : 0;
      const nextTop = anchorTops[index + 1]
        ?? measureContentBottom(editor, paneTop);
      const gap = nextTop - anchorTops[index] - previous;
      const height = spacerHeight(gap, cardHeights[index]);
      specs.push({ pos: current[index].spacerPos, height });
      heights.set(key, height);
    }
    return { specs, heights };
  }

  function acceptLayout(
    editor: EditorView,
    identity: string,
    nextHeights: Map<string, number>,
  ): void {
    mismatchRetries = 0;
    lastSpacerHeights.clear();
    nextHeights.forEach((height, key) => lastSpacerHeights.set(key, height));
    lastIdentity = identity;
    updateEditorToCardOffset(editor);
  }

  function handleMismatch(editor: EditorView): false {
    deps.setCardTopByDeclKey({});
    if (mismatchRetries < MAX_MISMATCH_RETRIES) {
      mismatchRetries++;
      controls.scheduleLayout(50);
    } else clear(editor);
    return false;
  }

  function layoutVisible(editor: EditorView, layer: HTMLElement): boolean {
    const cards = getCards(layer);
    const current = declarations(editor);
    if (!current.length || !cards.length) {
      clear(editor);
      return true;
    }
    controls.observeCards(cards);
    controls.suppressObserverUntilNextFrame();
    if (current.length !== cards.length) return handleMismatch(editor);

    const identity = declarationIdentity(current);
    const sameSet = identity === lastIdentity;
    if (!sameSet) lastSpacerHeights.clear();
    installAnchors(editor, current, sameSet);
    const paneTop = layer.getBoundingClientRect().top;
    const tops = current.map(({ pos, key }) => measureDeclarationTop(editor, pos, key, paneTop));
    if (tops.some((top) => top === null)) return false;
    const cardHeights = cards.map((card) => card.offsetHeight);
    controls.seedCardHeights(cards, cardHeights);
    const spacers = computeSpacers(editor, paneTop, current, tops as number[], cardHeights, sameSet);
    dispatch(editor, setCardSpacers.of(spacers.specs));
    const positioned = applyCardTops(editor, layer, cards, current, deps.setCardTopByDeclKey);
    if (positioned) acceptLayout(editor, identity, spacers.heights);
    return positioned;
  }

  function runLayout(): boolean {
    const editor = deps.viewRef.current;
    if (!deps.rootRef.current || !editor || !isLayoutActive(deps)) return false;
    if (!deps.showAnnotationsRef.current) {
      controls.observeCards([]);
      controls.suppressObserverUntilNextFrame();
      clear(editor);
      return true;
    }
    const layer = getCardLayer();
    return layer ? layoutVisible(editor, layer) : false;
  }

  return { runLayout, refreshCardPositions, updateEditorToCardOffset };
}
