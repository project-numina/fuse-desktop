/**
 * CodeMirror 6 extension that inserts invisible block-widget spacers
 * between lines so that an external card pane can stay vertically aligned.
 *
 * Layout-changing decorations must be "direct" (provided via a StateField,
 * not a ViewPlugin). See https://codemirror.net/examples/decoration/
 */

import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';

export interface SpacerSpec {
  pos: number;
  height: number;
}

/** Invisible block widget that reserves vertical space. */
class SpacerWidget extends WidgetType {
  readonly height: number;

  constructor(height: number) {
    super();
    this.height = height;
  }

  eq(other: SpacerWidget): boolean {
    return other.height === this.height;
  }

  get estimatedHeight() {
    return this.height;
  }

  toDOM(): HTMLElement {
    const element = document.createElement('div');
    element.className = 'cm-card-spacer';
    element.style.height = `${this.height}px`;
    element.style.pointerEvents = 'none';
    return element;
  }
}

/**
 * State effect that replaces the current set of spacer decorations.
 * Each spec is { pos: number, height: number } where pos is a document
 * position and height is the pixel gap to insert before that line.
 */
export const setCardSpacers = StateEffect.define<SpacerSpec[]>({
  map(value, changes) {
    return value.map(spacer => ({
      pos: changes.mapPos(spacer.pos, -1),
      height: spacer.height,
    }));
  },
});

/** StateField that holds the spacer DecorationSet. */
export const cardSpacerField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },

  update(decorations, transaction) {
    decorations = decorations.map(transaction.changes);

    for (const effect of transaction.effects) {
      if (effect.is(setCardSpacers)) {
        const ranges = effect.value
          .filter(spacer => spacer.height > 0)
          .map(spacer =>
            Decoration.widget({
              widget: new SpacerWidget(spacer.height),
              block: true,
              side: 1,
            }).range(spacer.pos),
          );
        return Decoration.set(ranges, true);
      }
    }

    return decorations;
  },

  provide: field => EditorView.decorations.from(field),
});

/** Base theme for the spacer elements. */
export const cardSpacerTheme = EditorView.baseTheme({
  '.cm-card-spacer': {
    display: 'block',
  },
});
