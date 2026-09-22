/**
 * CodeMirror hover tooltip backed by the Lean LSP.
 *
 * Mirrors VSCode-Lean4's hover popup: pausing the pointer over an identifier
 * asks the language server for that position and renders the markdown it
 * returns (type signature, docstring, module of origin) in a floating card.
 *
 * The host supplies `fetchHover`; this module owns only the CodeMirror wiring —
 * request cancellation, anchoring the card to the symbol's range, and mounting
 * the markdown into the tooltip's DOM.
 */

import { createRoot, type Root } from 'react-dom/client';
import { EditorView, hoverTooltip, type Tooltip } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

import ChatMarkdown from '@/features/chat/components/ChatMarkdown';

/** Delay before a resting pointer triggers a hover request, in ms. */
const HOVER_DELAY_MS = 250;

/** Shape of the backend's ``POST /lean/hover`` payload. */
export interface LeanHoverResult {
  /** Markdown body of the hover, or null when Lean has nothing to say here. */
  contents: string | null;
  /** 1-indexed range of the symbol the hover describes. */
  start_line: number | null;
  start_column: number | null;
  end_line: number | null;
  end_column: number | null;
}

/**
 * Queries the Lean LSP for one position. Rejecting with an `ApiError` surfaces
 * the server's message in the card; aborting via `signal` is silent.
 */
export type LeanHoverFetcher = (
  line: number,
  column: number,
  signal: AbortSignal,
) => Promise<LeanHoverResult>;

/**
 * Mount `markdown` into a fresh tooltip element, returning the element and a
 * teardown that unmounts the React root.
 *
 * The root is unmounted asynchronously: CodeMirror destroys tooltips from
 * inside its own update cycle, and React 19 warns when a root is unmounted
 * while it is rendering.
 */
function renderTooltipDom(markdown: string): { dom: HTMLElement; destroy: () => void } {
  const dom = document.createElement('div');
  dom.className = 'lean-hover-tooltip';
  const body = document.createElement('div');
  body.className = 'lean-hover-body';
  dom.appendChild(body);

  let root: Root | null = createRoot(body);
  root.render(<ChatMarkdown text={markdown} />);

  return {
    dom,
    destroy: () => {
      const pending = root;
      root = null;
      if (pending) queueMicrotask(() => pending.unmount());
    },
  };
}

/** Build a plain-text tooltip, used for the error path. */
function textTooltipDom(message: string, className: string): HTMLElement {
  const dom = document.createElement('div');
  dom.className = className;
  dom.textContent = message;
  return dom;
}

export interface LeanHoverOptions {
  fetchHover: LeanHoverFetcher;
  /** Maps a rejected `fetchHover` to the message shown in the card. */
  errorMessage: (error: unknown) => string;
}

type CancellableHoverSource = {
  (view: EditorView, pos: number): Promise<Tooltip | null>;
  cancel: () => void;
};

/**
 * Build the tooltip source `hoverTooltip` drives. Exported so its behaviour —
 * cancellation, anchoring, the error card — is testable without simulating
 * pointer dwell in a headless DOM.
 */
export function leanHoverSource({
  fetchHover,
  errorMessage,
}: LeanHoverOptions): CancellableHoverSource {
  // Only the hover the user actually paused on should reach the server: a fast
  // pass across many tokens would otherwise queue N requests behind the Lean
  // LSP's per-file lock, and every one of them would resolve into a stale card.
  let inFlight: AbortController | null = null;

  const hoverSource = async (view: EditorView, pos: number): Promise<Tooltip | null> => {
    const line = view.state.doc.lineAt(pos);
    const column = pos - line.from + 1;

    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;

    let result: LeanHoverResult;
    try {
      result = await fetchHover(line.number, column, controller.signal);
    } catch (error: unknown) {
      // An abort means a newer hover superseded this one — not user-facing.
      if (controller.signal.aborted) return null;
      const message = errorMessage(error);
      return {
        pos,
        above: true,
        create: () => ({ dom: textTooltipDom(message, 'lean-hover-tooltip lean-hover-error') }),
      };
    } finally {
      if (inFlight === controller) inFlight = null;
    }

    // A response that lost the race to a newer hover describes a position the
    // pointer has already left; dropping it keeps a stale card off the screen.
    if (controller.signal.aborted) return null;
    if (!result.contents) return null;

    // Anchor the card to the whole symbol rather than the single character
    // under the pointer, so it stays open while the pointer crosses the
    // token — the same behaviour as VSCode-Lean4.
    let from = pos;
    let to = pos;
    if (result.start_line && result.end_line) {
      try {
        const startLine = view.state.doc.line(result.start_line);
        const endLine = view.state.doc.line(result.end_line);
        const startOffset = Math.max(0, (result.start_column ?? 1) - 1);
        const endOffset = Math.max(0, (result.end_column ?? 1) - 1);
        if (startOffset > startLine.length || endOffset > endLine.length) {
          throw new RangeError('Lean hover range falls outside the current line.');
        }
        const candidateFrom = startLine.from + startOffset;
        const candidateTo = endLine.from + endOffset;
        if (candidateFrom > pos || candidateTo < pos) {
          throw new RangeError('Lean hover range no longer contains the hovered position.');
        }
        from = candidateFrom;
        to = candidateTo;
      } catch {
        // A line or column from a response that predates an edit may no longer
        // fit the document. Fall back to a point anchor rather than returning
        // invalid CodeMirror positions or discarding otherwise usable content.
        from = pos;
        to = pos;
      }
    }

    const markdown = result.contents;
    return {
      pos: from,
      end: to,
      above: true,
      create: () => renderTooltipDom(markdown),
    };
  };

  return Object.assign(hoverSource, {
    cancel: () => {
      const pending = inFlight;
      inFlight = null;
      pending?.abort();
    },
  });
}

/**
 * Build the hover extension. Returns a CodeMirror `Extension` that can be
 * handed straight to the editor; the caller decides whether Lean hovers are
 * available at all (the public read-only share has no LSP, so it omits this).
 */
export function leanHoverExtension(options: LeanHoverOptions): Extension {
  const source = leanHoverSource(options);
  return [
    hoverTooltip(source, {
      hoverTime: HOVER_DELAY_MS,
      hideOnChange: true,
    }),
    EditorView.domEventHandlers({
      mouseleave: () => {
        source.cancel();
      },
    }),
  ];
}
