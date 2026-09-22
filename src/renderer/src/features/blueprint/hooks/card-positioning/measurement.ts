import type { EditorView } from '@codemirror/view';

import {
  CARD_GAP,
  type DeclarationLayout,
  type DeclarationSegment,
} from './types';

export function buildDeclarations(
  editor: EditorView,
  segments: DeclarationSegment[],
  startLines: number[],
  endLines: number[],
): DeclarationLayout[] {
  return startLines.map((lineNumber, index) => {
    if (lineNumber < 1 || lineNumber > editor.state.doc.lines) return null;
    const segment = segments[index];
    if (!segment?.declKey || !segment.entry) return null;
    const endLine = endLines[index] ?? lineNumber;
    if (endLine < 1 || endLine > editor.state.doc.lines) return null;
    return {
      key: segment.declKey,
      pos: editor.state.doc.line(lineNumber).from,
      spacerPos: editor.state.doc.line(endLine).to,
    };
  }).filter(Boolean) as DeclarationLayout[];
}

/** Measures an anchored declaration, falling back to CodeMirror's height map. */
export function measureDeclarationTop(
  editor: EditorView,
  position: number,
  key: string,
  paneTop: number,
): number | null {
  const anchor = editor.dom.querySelector<HTMLElement>(
    `[data-decl-anchor="${CSS.escape(key)}"]`,
  );
  if (anchor) return anchor.getBoundingClientRect().top - paneTop;
  const coords = editor.coordsAtPos(position);
  if (coords) return coords.top - paneTop;
  const block = editor.lineBlockAt(position);
  if (!block) return null;
  const scrollRect = editor.scrollDOM.getBoundingClientRect();
  return scrollRect.top - paneTop - editor.scrollDOM.scrollTop + block.top;
}

export function measureContentBottom(editor: EditorView, paneTop: number): number {
  const scrollRect = editor.scrollDOM.getBoundingClientRect();
  return scrollRect.top - paneTop - editor.scrollDOM.scrollTop + editor.scrollDOM.scrollHeight;
}

export function applyCardTops(
  editor: EditorView,
  cardLayer: HTMLElement,
  cards: HTMLElement[],
  declarations: DeclarationLayout[],
  setCardTops: (value: Record<string, number>) => void,
): boolean {
  const paneTop = cardLayer.getBoundingClientRect().top;
  const tops: Record<string, number> = {};
  let minHeight = 0;
  for (let index = 0; index < declarations.length; index++) {
    const card = cards[index];
    if (!card) return false;
    const declaration = declarations[index];
    const top = measureDeclarationTop(editor, declaration.pos, declaration.key, paneTop);
    if (top === null) return false;
    card.style.top = `${top}px`;
    tops[declaration.key] = top;
    minHeight = Math.max(minHeight, top + card.offsetHeight + CARD_GAP);
  }
  cardLayer.style.minHeight = `${Math.ceil(minHeight)}px`;
  setCardTops(tops);
  return true;
}

export function editorToCardOffset(
  editor: EditorView,
  cardLayer: HTMLElement | null,
): number | null {
  if (!cardLayer) return null;
  return editor.scrollDOM.getBoundingClientRect().top - cardLayer.getBoundingClientRect().top;
}
