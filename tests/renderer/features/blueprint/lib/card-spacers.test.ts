import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { cardSpacerField, setCardSpacers } from '@/features/blueprint/lib/card-spacers';

function ranges(state: EditorState) {
  const iterator = state.field(cardSpacerField).iter();
  const result: Array<{ from: number; to: number }> = [];
  while (iterator.value) {
    result.push({ from: iterator.from, to: iterator.to });
    iterator.next();
  }
  return result;
}

describe('cardSpacerField', () => {
  it('replaces spacers and drops nonpositive heights', () => {
    let state = EditorState.create({ doc: 'abc', extensions: [cardSpacerField] });
    state = state.update({ effects: setCardSpacers.of([
      { pos: 1, height: 20 }, { pos: 2, height: 0 }, { pos: 3, height: -1 },
    ]) }).state;
    expect(ranges(state)).toEqual([{ from: 1, to: 1 }]);
  });

  it('maps spacers through document changes', () => {
    let state = EditorState.create({ doc: 'abc', extensions: [cardSpacerField] });
    state = state.update({ effects: setCardSpacers.of([{ pos: 2, height: 20 }]) }).state;
    state = state.update({ changes: { from: 0, insert: 'xy' } }).state;
    expect(ranges(state)).toEqual([{ from: 4, to: 4 }]);
  });

  it('a later effect replaces the complete decoration set', () => {
    let state = EditorState.create({ doc: 'abc', extensions: [cardSpacerField] });
    state = state.update({ effects: setCardSpacers.of([{ pos: 1, height: 20 }]) }).state;
    state = state.update({ effects: setCardSpacers.of([]) }).state;
    expect(ranges(state)).toEqual([]);
  });
});
