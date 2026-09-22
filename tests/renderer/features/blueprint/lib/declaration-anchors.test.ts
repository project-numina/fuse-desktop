import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { declarationAnchorField, setDeclarationAnchors } from '@/features/blueprint/lib/declaration-anchors';

function anchors(state: EditorState) {
  const iterator = state.field(declarationAnchorField).iter();
  const result: Array<{ from: number; key: string | undefined }> = [];
  while (iterator.value) {
    result.push({
      from: iterator.from,
      key: iterator.value.spec.attributes?.['data-decl-anchor'],
    });
    iterator.next();
  }
  return result;
}

describe('declarationAnchorField', () => {
  it('adds keyed line decorations at declaration positions', () => {
    let state = EditorState.create({ doc: 'theorem\nproof', extensions: [declarationAnchorField] });
    state = state.update({ effects: setDeclarationAnchors.of([
      { pos: 0, key: 'first' }, { pos: 8, key: 'second' },
    ]) }).state;
    expect(anchors(state)).toEqual([
      { from: 0, key: 'first' }, { from: 8, key: 'second' },
    ]);
  });

  it('keeps duplicate-label declarations on separate anchors', () => {
    let state = EditorState.create({ doc: 'one\ntwo', extensions: [declarationAnchorField] });
    state = state.update({ effects: setDeclarationAnchors.of([
      { pos: 0, key: 'thm:dup#0' }, { pos: 4, key: 'thm:dup#1' },
    ]) }).state;
    expect(anchors(state)).toEqual([
      { from: 0, key: 'thm:dup#0' }, { from: 4, key: 'thm:dup#1' },
    ]);
  });

  it('keeps a line anchor at the edited line start and supports clearing', () => {
    let state = EditorState.create({ doc: 'abc', extensions: [declarationAnchorField] });
    state = state.update({ effects: setDeclarationAnchors.of([{ pos: 0, key: 'a' }]) }).state;
    state = state.update({ changes: { from: 0, insert: 'x' } }).state;
    expect(anchors(state)[0].from).toBe(0);
    state = state.update({ effects: setDeclarationAnchors.of([]) }).state;
    expect(anchors(state)).toEqual([]);
  });
});
