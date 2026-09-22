/**
 * Resizable right-rail (Files/Infoview) panel state for the Lean view.
 *
 * Owns the panel width and collapsed flag, both persisted in localStorage,
 * plus the drag handlers. A drag that pulls the panel narrower than a grace
 * threshold snaps it closed (VS Code style) so the user can reopen it via the
 * edge handle.
 *
 * Persistence skips the first render so mounting does not rewrite the loaded
 * value. Stable drag handlers read live width through a ref, and all listeners
 * and body-style side effects are torn down on unmount.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const LEAN_CARD_WIDTH_KEY = 'leanCardWidth';
const LEAN_CARD_COLLAPSED_KEY = 'leanCardCollapsed';
const LEAN_CARD_MIN_WIDTH = 240;
const LEAN_CARD_MAX_WIDTH = 560;
const LEAN_CARD_DEFAULT_WIDTH = 320;
// Collapse only after the drag has pulled the cursor roughly half the
// minimum past the edge, matching VS Code's grace zone so the panel
// doesn't snap shut the instant the user reaches the min.
const LEAN_CARD_COLLAPSE_THRESHOLD = LEAN_CARD_MIN_WIDTH / 2;

function loadLeanCardWidth(): number {
  const raw = Number(localStorage.getItem(LEAN_CARD_WIDTH_KEY));
  if (!Number.isFinite(raw) || raw < LEAN_CARD_MIN_WIDTH) {
    return LEAN_CARD_DEFAULT_WIDTH;
  }
  return Math.min(raw, LEAN_CARD_MAX_WIDTH);
}

function loadLeanCardCollapsed(): boolean {
  return localStorage.getItem(LEAN_CARD_COLLAPSED_KEY) === 'true';
}

export function useLeanCardPanel() {
  const [leanCardCollapsed, setLeanCardCollapsed] = useState(loadLeanCardCollapsed);
  const [leanCardWidth, setLeanCardWidth] = useState(loadLeanCardWidth);

  // Live width for the drag math: the window listeners are registered once per
  // drag and must read the current width, not the one captured at registration.
  const widthRef = useRef(leanCardWidth);
  widthRef.current = leanCardWidth;

  // Persist on change. Skip the first render so a freshly-mounted panel doesn't
  // rewrite the value it just read back.
  const didMountCollapsed = useRef(false);
  useEffect(() => {
    if (!didMountCollapsed.current) {
      didMountCollapsed.current = true;
      return;
    }
    localStorage.setItem(LEAN_CARD_COLLAPSED_KEY, String(leanCardCollapsed));
  }, [leanCardCollapsed]);

  const didMountWidth = useRef(false);
  useEffect(() => {
    if (!didMountWidth.current) {
      didMountWidth.current = true;
      return;
    }
    localStorage.setItem(LEAN_CARD_WIDTH_KEY, String(Math.round(leanCardWidth)));
  }, [leanCardWidth]);

  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);
  // Stable handler identities so ``stopLeanResize`` removes exactly what
  // ``onLeanResizeStart`` added.
  const moveRef = useRef<(event: MouseEvent) => void>(() => {});
  const endRef = useRef<() => void>(() => {});

  const stopLeanResize = useCallback(() => {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', moveRef.current);
    window.removeEventListener('mouseup', endRef.current);
  }, []);

  const onLeanResizeMove = useCallback(
    (event: MouseEvent) => {
      // Panel sits on the right edge, so dragging left grows it.
      const delta = resizeStartXRef.current - event.clientX;
      const proposed = resizeStartWidthRef.current + delta;
      // VS Code-style collapse: once the proposed width would go below the
      // minimum the panel sticks at the minimum, and only fully collapses if
      // the cursor keeps pulling inward past a second, larger threshold.
      // Without this the panel snaps shut the moment the user touches the
      // minimum, which feels abrupt.
      if (proposed < LEAN_CARD_COLLAPSE_THRESHOLD) {
        setLeanCardCollapsed(true);
        stopLeanResize();
        return;
      }
      setLeanCardWidth(
        Math.max(LEAN_CARD_MIN_WIDTH, Math.min(LEAN_CARD_MAX_WIDTH, proposed)),
      );
    },
    [stopLeanResize],
  );
  moveRef.current = onLeanResizeMove;
  endRef.current = stopLeanResize;

  const onLeanResizeStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    resizeStartXRef.current = event.clientX;
    resizeStartWidthRef.current = widthRef.current;
    // Keep the cursor pinned and suppress text selection until the drag ends,
    // even if the pointer leaves the thin handle hit target.
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', moveRef.current);
    window.addEventListener('mouseup', endRef.current);
  }, []);

  // Safety net: a drag interrupted by an unmount must not leave global
  // listeners or body styles behind.
  useEffect(() => stopLeanResize, [stopLeanResize]);

  return {
    leanCardCollapsed,
    setLeanCardCollapsed,
    leanCardWidth,
    onLeanResizeStart,
    stopLeanResize,
  };
}
