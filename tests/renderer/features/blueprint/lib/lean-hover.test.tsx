import { EditorState, type Extension } from '@codemirror/state';
import { activateHover, EditorView, hasHoverTooltips } from '@codemirror/view';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  leanHoverExtension,
  leanHoverSource,
  type LeanHoverResult,
} from '@/features/blueprint/lib/lean-hover';

beforeAll(() => {
  Range.prototype.getClientRects = () => ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* iterator() {},
  }) as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

const DOC = 'def one := 1\ndef target := 2';

function view(doc = DOC, extensions: Extension = []): EditorView {
  return new EditorView({ state: EditorState.create({ doc, extensions }) });
}

function hoverResult(overrides: Partial<LeanHoverResult> = {}): LeanHoverResult {
  return {
    contents: '`one : Nat`',
    start_line: null,
    start_column: null,
    end_line: null,
    end_column: null,
    ...overrides,
  };
}

const noErrors = () => 'unused';

describe('Lean hover requests', () => {
  it('asks the server for the 1-based line and column under the pointer', async () => {
    const fetchHover = vi.fn(async () => hoverResult());
    const source = leanHoverSource({ fetchHover, errorMessage: noErrors });
    const editor = view();
    // Third character of the second line.
    await source(editor, editor.state.doc.line(2).from + 2);
    expect(fetchHover).toHaveBeenCalledWith(2, 3, expect.any(AbortSignal));
  });

  it('aborts an in-flight hover when a newer one starts', async () => {
    const signals: AbortSignal[] = [];
    let releaseFirst: (() => void) | null = null;
    const fetchHover = vi.fn(async (_l: number, _c: number, signal: AbortSignal) => {
      signals.push(signal);
      if (signals.length === 1) {
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
      }
      return hoverResult();
    });
    const source = leanHoverSource({ fetchHover, errorMessage: noErrors });
    const editor = view();

    const first = source(editor, 1);
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    const second = source(editor, 5);

    expect(signals[0].aborted).toBe(true);
    releaseFirst!();
    // The superseded hover resolves to nothing rather than a stale card.
    await expect(first).resolves.toBeNull();
    await expect(second).resolves.not.toBeNull();
  });

  it('suppresses the card when the request was cancelled mid-flight', async () => {
    const fetchHover = vi.fn(async () => {
      throw new Error('aborted');
    });
    const source = leanHoverSource({ fetchHover, errorMessage: () => 'should not show' });
    const editor = view();
    const promise = source(editor, 1);
    // Starting a second hover aborts the first, which then rejects.
    void source(editor, 2);
    await expect(promise).resolves.toBeNull();
  });

  it('aborts an in-flight hover when the pointer leaves the editor', async () => {
    let release!: () => void;
    let signal!: AbortSignal;
    const fetchHover = vi.fn(async (_l: number, _c: number, requestSignal: AbortSignal) => {
      signal = requestSignal;
      await new Promise<void>((resolve) => { release = resolve; });
      return hoverResult();
    });
    const editor = view(DOC, leanHoverExtension({ fetchHover, errorMessage: noErrors }));

    activateHover(editor, 1, 1);
    await vi.waitFor(() => expect(fetchHover).toHaveBeenCalledTimes(1));
    editor.contentDOM.dispatchEvent(new MouseEvent('mouseleave'));

    expect(signal.aborted).toBe(true);
    release();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(hasHoverTooltips(editor.state)).toBe(false);
    editor.destroy();
  });
});

describe('Lean hover cards', () => {
  it('shows nothing when Lean has no information for the position', async () => {
    const fetchHover = vi.fn(async () => hoverResult({ contents: null }));
    const source = leanHoverSource({ fetchHover, errorMessage: noErrors });
    await expect(source(view(), 1)).resolves.toBeNull();
  });

  it('anchors the card to the symbol range so it survives moving across the token', async () => {
    const fetchHover = vi.fn(async () => hoverResult({
      start_line: 2,
      start_column: 5,
      end_line: 2,
      end_column: 11,
    }));
    const source = leanHoverSource({ fetchHover, errorMessage: noErrors });
    const editor = view();
    const tooltip = await source(editor, editor.state.doc.line(2).from + 6);

    const secondLine = editor.state.doc.line(2).from;
    expect(tooltip?.pos).toBe(secondLine + 4);
    expect(tooltip?.end).toBe(secondLine + 10);
  });

  it('renders and tears down a successful markdown card', async () => {
    const fetchHover = vi.fn(async () => hoverResult());
    const source = leanHoverSource({ fetchHover, errorMessage: noErrors });
    const editor = view();
    const tooltip = await source(editor, 1);
    const rendered = tooltip!.create(editor);

    expect(rendered.dom.className).toBe('lean-hover-tooltip');
    expect(rendered.dom.querySelector('.lean-hover-body')).not.toBeNull();

    rendered.destroy?.();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
  });

  it('falls back to a point anchor when the range predates an edit', async () => {
    const fetchHover = vi.fn(async () => hoverResult({
      start_line: 99,
      start_column: 1,
      end_line: 99,
      end_column: 4,
    }));
    const source = leanHoverSource({ fetchHover, errorMessage: noErrors });
    const tooltip = await source(view(), 3);
    expect(tooltip?.pos).toBe(3);
    expect(tooltip?.end).toBe(3);
  });

  it('falls back when stale columns no longer fit an existing line', async () => {
    const fetchHover = vi.fn(async () => hoverResult({
      start_line: 1,
      start_column: 99,
      end_line: 1,
      end_column: 105,
    }));
    const source = leanHoverSource({ fetchHover, errorMessage: noErrors });
    const tooltip = await source(view('short'), 2);
    expect(tooltip?.pos).toBe(2);
    expect(tooltip?.end).toBe(2);
  });

  it('falls back when a stale range no longer covers the hovered position', async () => {
    const fetchHover = vi.fn(async () => hoverResult({
      start_line: 1,
      start_column: 1,
      end_line: 1,
      end_column: 4,
    }));
    const source = leanHoverSource({ fetchHover, errorMessage: noErrors });
    const tooltip = await source(view('short target'), 8);
    expect(tooltip?.pos).toBe(8);
    expect(tooltip?.end).toBe(8);
  });

  it('renders the failure message instead of dropping the hover silently', async () => {
    const fetchHover = vi.fn(async () => { throw new Error('boom'); });
    const source = leanHoverSource({
      fetchHover,
      errorMessage: () => 'The Lean project is still being built.',
    });
    const tooltip = await source(view(), 1);
    const { dom } = tooltip!.create(view());
    expect(dom.className).toContain('lean-hover-error');
    expect(dom.textContent).toBe('The Lean project is still being built.');
  });
});

describe('Lean hover extension', () => {
  it('builds the CodeMirror extension with the configured source', () => {
    const fetchHover = vi.fn(async () => hoverResult());
    expect(leanHoverExtension({ fetchHover, errorMessage: noErrors })).toBeDefined();
  });

  it('hides settled hover content on edits and releases its controller', async () => {
    let signal!: AbortSignal;
    const fetchHover = vi.fn(async (_l: number, _c: number, requestSignal: AbortSignal) => {
      signal = requestSignal;
      return hoverResult();
    });
    const editor = view(DOC, leanHoverExtension({ fetchHover, errorMessage: noErrors }));

    activateHover(editor, 1, 1);
    await vi.waitFor(() => expect(hasHoverTooltips(editor.state)).toBe(true));
    editor.dispatch({ changes: { from: 0, insert: '-- ' } });

    expect(hasHoverTooltips(editor.state)).toBe(false);
    editor.contentDOM.dispatchEvent(new MouseEvent('mouseleave'));
    expect(signal.aborted).toBe(false);
    editor.destroy();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
  });
});
