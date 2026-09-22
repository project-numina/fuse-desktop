/**
 * React hook wrapping CodeMirror 6.
 *
 * binding between an `EditorView` and an external `source` string, with
 * support for readonly mode and custom extensions.
 *
 *  - external `source` -> editor sync via a dispatch tagged with the
 *    `fromSource` annotation and kept out of the undo history, plus an
 *    `updateListener` echo-guard that skips those transactions so a
 *    programmatic change never round-trips back into `onChange`.
 *  - a `readonly` `Compartment` that is reconfigured in place rather than
 *    rebuilding the whole editor.
 *  - a re-measure after mount for editors that open inside a scaling enter
 *    animation, whose first measurement would otherwise cache text metrics
 *    scaled by the in-flight transform.
 *
 * StrictMode safety: the `EditorView` is created exactly once per mount inside
 * a layout effect and destroyed on cleanup. React 19 StrictMode mounts, unmounts,
 * then remounts in development; because creation and teardown are symmetric and
 * the ref is cleared on teardown, the double-invoke never leaves two live views
 * attached to the same container. The update listener reads the latest
 * `onChange` through a ref, so it never captures a stale closure even though the
 * view itself is built only once.
 */

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { Extension } from '@codemirror/state';
import { Annotation, Compartment, EditorState, RangeSetBuilder, Transaction } from '@codemirror/state';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { Decoration, EditorView, ViewPlugin, drawSelection, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, insertNewline } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';

interface UseCodeMirrorOptions {
  /**
   * The bound document text. When provided, the editor is kept in sync with
   * this value and user edits are reported back through `onChange`. When
   * `undefined` (collaboration mode, e.g. blueprint's Yjs binding), the source
   * watcher is not wired up and the editor's document is owned entirely by the
   * supplied `extensions`.
   */
  source?: string;
  /** Reports user edits back out. Only meaningful when `source` is provided. */
  onChange?: (value: string) => void;
  /** Toggles readonly mode via an in-place compartment reconfiguration. */
  readonly?: boolean;
  /** Extra CodeMirror extensions (language, line numbers, theme, ...). */
  extensions?: Extension[];
}

// Marks a transaction whose change was pushed in from the bound ``source``
// prop (e.g. a chapter switch) rather than typed by the user. The update
// listener ignores these so it doesn't echo a programmatic change back
// out through ``onChange``.
const fromSource = Annotation.define<boolean>();

/**
 * Describe an external source update as one localized replacement. Keeping
 * the common prefix and suffix outside the change lets CodeMirror map the
 * existing selection through edits before or after the caret instead of
 * collapsing it to the start of a whole-document replacement.
 */
function sourceChange(currentText: string, nextText: string) {
  const sharedLength = Math.min(currentText.length, nextText.length);
  let from = 0;
  while (from < sharedLength && currentText[from] === nextText[from]) from += 1;

  let currentTo = currentText.length;
  let nextTo = nextText.length;
  while (
    currentTo > from
    && nextTo > from
    && currentText[currentTo - 1] === nextText[nextTo - 1]
  ) {
    currentTo -= 1;
    nextTo -= 1;
  }

  return { from, to: currentTo, insert: nextText.slice(from, nextTo) };
}

// Give up waiting for an enter animation to settle after this long, so a
// permanently scaled ancestor cannot keep the re-measure loop running.
const SCALE_SETTLE_TIMEOUT_MS = 1000;

/**
 * Whether `element` is currently drawn at a scale other than 1, i.e. some
 * ancestor applies a scaling transform. `offsetWidth` is the unscaled layout
 * width while `getBoundingClientRect()` reports the painted width, so they
 * diverge exactly while a transform is in effect. The 1px threshold matches
 * CodeMirror's own scale detection and keeps subpixel rounding from counting.
 */
function isVisuallyScaled(element: HTMLElement): boolean {
  return Math.abs(element.getBoundingClientRect().width - element.offsetWidth) >= 1;
}

const activeLineDecoration = Decoration.line({ class: 'cm-activeLine' });

/**
 * Line decorations for every bare cursor in `state`, and for nothing else.
 *
 * This replaces CodeMirror's `highlightActiveLine`, which decorates the line
 * holding each range's head even when that range spans text. The decoration
 * paints on the content, above the selection layer, and our `.cm-activeLine`
 * background is opaque (CodeMirror's own default is translucent for exactly
 * this reason), so the head's line came out looking unselected: dragging a
 * selection upwards puts the head on its first line, which then showed the
 * active-line colour instead of the selection colour.
 *
 * @param state Editor state to read the selection from.
 * @returns One decoration per line that holds a cursor, deduplicated.
 */
export function cursorLineDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let lastLineStart = -1;
  // Selection ranges are already in document order, which RangeSetBuilder needs.
  for (const range of state.selection.ranges) {
    if (!range.empty) continue;
    const lineStart = state.doc.lineAt(range.head).from;
    if (lineStart > lastLineStart) {
      builder.add(lineStart, lineStart, activeLineDecoration);
      lastLineStart = lineStart;
    }
  }
  return builder.finish();
}

const highlightCursorLine = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = cursorLineDecorations(view.state);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet) {
        this.decorations = cursorLineDecorations(update.state);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

function readonlyExtensions(isReadonly: boolean | undefined): Extension {
  if (isReadonly) {
    return [EditorState.readOnly.of(true), EditorView.editable.of(false)];
  }
  return [
    EditorState.readOnly.of(false),
    EditorView.editable.of(true),
    highlightCursorLine,
  ];
}

/**
 * Mount a CodeMirror editor into `container` and return a ref to the live view.
 *
 * @param container Ref to the element the editor mounts into.
 * @param options `source` / `onChange` two-way binding, `readonly`, and extra
 *   `extensions`.
 * @returns A ref holding the current `EditorView` (or `null` before mount).
 */
export function useCodeMirror(
  container: RefObject<HTMLElement | null>,
  { source, onChange, readonly, extensions = [] }: UseCodeMirrorOptions = {},
): RefObject<EditorView | null> {
  const viewRef = useRef<EditorView | null>(null);
  const readonlyCompartmentRef = useRef<Compartment | null>(null);

  // Reading `onChange` through a ref keeps the update listener stable: the view
  // is built once, but always calls the latest handler and never a stale one.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Whether the source watcher is active is fixed for the editor's lifetime
  // (a caller is in controlled or collaboration mode, not both), so capture it
  // once on the first render to keep the creation effect from re-running.
  const isSourceBound = useRef(source !== undefined).current;

  // Create the view exactly once per mount. StrictMode's mount/unmount/remount
  // is safe because the cleanup destroys the view and clears the ref, so the
  // remount starts from a clean slate rather than stacking a second view.
  useLayoutEffect(() => {
    const parent = container.current;
    if (!parent) return;

    const readonlyCompartment = new Compartment();
    readonlyCompartmentRef.current = readonlyCompartment;

    const filteredDefaultKeymap = defaultKeymap.filter(binding => binding.key !== 'Enter');
    const base: Extension[] = [
      history(),
      EditorView.editorAttributes.of({
        spellcheck: 'false',
        autocorrect: 'off',
        autocapitalize: 'off',
        translate: 'no',
      }),
      EditorView.contentAttributes.of({
        spellcheck: 'false',
        autocorrect: 'off',
        autocapitalize: 'off',
        translate: 'no',
      }),
      drawSelection(),
      bracketMatching(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([{ key: 'Enter', run: insertNewline }, ...filteredDefaultKeymap, ...historyKeymap, indentWithTab]),
      ...(isSourceBound ? [EditorView.updateListener.of(update => {
        if (!update.docChanged) return;
        // Only user edits propagate back out through ``onChange``. Changes we
        // dispatched from the ``source`` sync carry the ``fromSource``
        // annotation and must be ignored, or the echo would leave the
        // binding out of sync and swallow the next real update.
        const isFromSource = update.transactions.some(
          transaction => transaction.annotation(fromSource),
        );
        if (isFromSource) return;
        onChangeRef.current?.(update.state.doc.toString());
      })] : []),
      readonlyCompartment.of(readonlyExtensions(readonly)),
      ...extensions,
    ];

    const state = EditorState.create({
      doc: source ?? '',
      extensions: base,
    });
    const view = new EditorView({ state, parent });
    viewRef.current = view;

    // The editor can mount inside an element that is still running an enter
    // animation -- the dialog scales from 95% to 100% -- and CodeMirror derives
    // its character width and line height from getBoundingClientRect(), so a
    // first measure taken mid-animation caches metrics that are off by the
    // scale factor. That misplaces clicks (the caret lands right of the
    // pointer, drifting further the further right you click) and skews the
    // viewport line range (visible lines fall inside a spacer and render
    // blank). A transform does not change the border-box size, so the
    // ResizeObserver never fires and the stale metrics would otherwise survive
    // for the editor's lifetime. Keep asking for a measure until the element is
    // drawn unscaled: CodeMirror's own measure pass compares the scale against
    // the one it recorded and refreshes the text metrics when it changed.
    const settleDeadline = performance.now() + SCALE_SETTLE_TIMEOUT_MS;
    let settleFrame = requestAnimationFrame(function remeasureWhenSettled() {
      const stillScaled = isVisuallyScaled(parent);
      view.requestMeasure();
      if (stillScaled && performance.now() < settleDeadline) {
        settleFrame = requestAnimationFrame(remeasureWhenSettled);
      }
    });

    return () => {
      cancelAnimationFrame(settleFrame);
      view.destroy();
      viewRef.current = null;
      readonlyCompartmentRef.current = null;
    };
    // The editor is created once and reconfigured through effects below;
    // `source`/`onChange`/`readonly`/`extensions` changes are handled there
    // rather than by tearing down and rebuilding the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External ``source`` -> editor sync. Skipped entirely in collaboration mode.
  useEffect(() => {
    if (!isSourceBound) return;
    const view = viewRef.current;
    if (!view) return;
    const currentText = view.state.doc.toString();
    if (source !== undefined && source !== currentText) {
      view.dispatch({
        changes: sourceChange(currentText, source),
        // Mark the change as source-driven and keep it out of the undo
        // history: an external swap (e.g. switching chapters) isn't a
        // user edit, so Undo must not revert to the previous chapter's
        // text - and if it did, that text would echo back out.
        annotations: [fromSource.of(true), Transaction.addToHistory.of(false)],
      });
    }
  }, [source, isSourceBound]);

  // Readonly toggle via in-place compartment reconfiguration.
  useEffect(() => {
    const view = viewRef.current;
    const compartment = readonlyCompartmentRef.current;
    if (!view || !compartment) return;
    view.dispatch({
      effects: compartment.reconfigure(readonlyExtensions(readonly)),
    });
  }, [readonly]);

  return viewRef;
}
