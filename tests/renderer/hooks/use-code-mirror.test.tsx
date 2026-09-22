/**
 * Covers the two pieces of the hook that exist to keep the editor's rendering
 * honest: the post-mount re-measure, for editors that mount inside an element
 * still animating its scale (the source dialog scales from 95% to 100% on
 * open), and the cursor-line decorations that must not paint over a selection.
 */

import { render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorStateConfig } from '@codemirror/state';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { cursorLineDecorations, useCodeMirror } from '@/hooks/use-code-mirror';

const UNSCALED_WIDTH = 200;

/** Painted width reported by the container; drives the scale detection. */
let paintedWidth = UNSCALED_WIDTH;

/**
 * Report a fixed layout width and a settable painted width on one element, so
 * the hook sees the same divergence a scaling ancestor produces. Scoped to the
 * container rather than the prototype: CodeMirror measures its own DOM through
 * the same APIs and misreports break it.
 */
function stubElementLayout(element: HTMLElement) {
  Object.defineProperty(element, 'offsetWidth', {
    configurable: true,
    get: () => UNSCALED_WIDTH,
  });
  element.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: paintedWidth,
      bottom: 100,
      width: paintedWidth,
      height: 100,
      toJSON: () => ({}),
    }) as DOMRect;
}

/**
 * Wait out whole frames. More than one at a time, because a callback the loop
 * queues during a frame only runs in the next one -- a single frame cannot tell
 * "the loop retired" from "its next callback has not run yet".
 */
async function advanceFrames(count = 2) {
  for (let frame = 0; frame < count; frame += 1) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

function Harness() {
  const container = useRef<HTMLDivElement | null>(null);
  useCodeMirror(container, { source: 'one\ntwo\nthree' });
  return (
    <div
      ref={(node) => {
        if (node) stubElementLayout(node);
        container.current = node;
      }}
    />
  );
}

/**
 * Render with measurement stubbed out. CodeMirror's real measure pass reads
 * geometry jsdom cannot supply, so the assertions track the requests rather
 * than their effect.
 */
function renderHarness() {
  const requestMeasure = vi
    .spyOn(EditorView.prototype, 'requestMeasure')
    .mockImplementation(() => {});
  render(<Harness />);
  return requestMeasure;
}

afterEach(() => {
  paintedWidth = UNSCALED_WIDTH;
  vi.restoreAllMocks();
});

describe('useCodeMirror scale settling', () => {
  it('stops re-measuring once the editor is drawn unscaled', async () => {
    const requestMeasure = renderHarness();

    await advanceFrames();
    const afterSettle = requestMeasure.mock.calls.length;
    await advanceFrames();

    // No further frames are queued: an unscaled editor needs one measure, not a
    // running loop.
    expect(requestMeasure.mock.calls.length).toBe(afterSettle);
  });

  it('keeps re-measuring while an ancestor is still scaling, then stops', async () => {
    paintedWidth = UNSCALED_WIDTH * 0.95;
    const requestMeasure = renderHarness();

    await advanceFrames();
    const whileScaled = requestMeasure.mock.calls.length;
    await advanceFrames();
    expect(requestMeasure.mock.calls.length).toBeGreaterThan(whileScaled);

    // The enter animation finishes; the next frame measures at the real scale
    // and the loop retires.
    paintedWidth = UNSCALED_WIDTH;
    await advanceFrames();
    const afterSettle = requestMeasure.mock.calls.length;
    await advanceFrames();
    expect(requestMeasure.mock.calls.length).toBe(afterSettle);
  });
});

describe('cursorLineDecorations', () => {
  const doc = 'alpha\nbeta\ngamma';

  function decoratedLineStarts(selection: EditorStateConfig['selection']) {
    const state = EditorState.create({
      doc,
      selection,
      // Without this the state keeps only the main range, so the multi-cursor
      // case would silently collapse to one.
      extensions: [EditorState.allowMultipleSelections.of(true)],
    });
    const starts: number[] = [];
    cursorLineDecorations(state).between(0, doc.length, (from) => {
      starts.push(from);
    });
    return starts;
  }

  it('highlights the line holding a bare cursor', () => {
    // 'beta' starts at offset 6.
    expect(decoratedLineStarts({ anchor: 8 })).toEqual([6]);
  });

  // Dragging a selection upwards leaves the head on its first line. Decorating
  // that line would paint the opaque active-line background over the selection.
  it('highlights nothing while a range spans text, in either direction', () => {
    expect(decoratedLineStarts({ anchor: 14, head: 2 })).toEqual([]);
    expect(decoratedLineStarts({ anchor: 2, head: 14 })).toEqual([]);
  });

  it('deduplicates multiple cursors on one line and keeps distinct ones', () => {
    const twoOnOneLine = EditorSelection.create([
      EditorSelection.cursor(1),
      EditorSelection.cursor(3),
      EditorSelection.cursor(8),
    ]);
    expect(decoratedLineStarts(twoOnOneLine)).toEqual([0, 6]);
  });
});
