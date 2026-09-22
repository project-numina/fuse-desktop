/**
 * CodeMirror 6 extension that tags declaration start lines with
 * data-decl-anchor attributes so the card positioning system can
 * measure their actual rendered positions via getBoundingClientRect.
 */

import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';

export interface DeclarationAnchorSpec {
  pos: number;
  /**
   * Per-occurrence declaration key (``LatexSegment.declKey``), not a ``\label``.
   * The attribute is looked up with querySelector, so two declarations sharing
   * a label must not share this value or they would measure as one line.
   */
  key: string;
}

/**
 * State effect that replaces the current set of declaration-line anchors.
 * Each spec marks a document position with a key attribute on its
 * rendered .cm-line wrapper.
 */
export const setDeclarationAnchors = StateEffect.define<DeclarationAnchorSpec[]>({
  map(value, changes) {
    return value.map(anchor => ({
      pos: changes.mapPos(anchor.pos, 1),
      key: anchor.key,
    }));
  },
});

/** StateField that holds the declaration-anchor DecorationSet. */
export const declarationAnchorField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },

  update(decorations, transaction) {
    decorations = decorations.map(transaction.changes);

    for (const effect of transaction.effects) {
      if (effect.is(setDeclarationAnchors)) {
        const ranges = effect.value.map(anchor =>
          Decoration.line({
            attributes: {
              'data-decl-anchor': anchor.key,
            },
          }).range(anchor.pos),
        );
        return Decoration.set(ranges, true);
      }
    }

    return decorations;
  },

  provide: field => EditorView.decorations.from(field),
});
