/**
 * Horizontal drag-to-resize for the chat panel. Returns the live width and a
 * mousedown handler to attach to the resize handle.
 *
 * `useState` (mirrored into a ref so the drag handler reads the current width
 * without re-binding); the transient document `mousemove`/`mouseup` listeners
 * are tracked in a ref so an unmount mid-drag tears them down (StrictMode-safe,
 * no setState-after-unmount).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_WIDTH = 240;
const MAX_WIDTH = 640;

export function usePanelResize(initialWidth = 360) {
  const [panelWidth, setPanelWidthState] = useState(initialWidth);

  const widthRef = useRef(initialWidth);
  const cleanupRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);

  const setPanelWidth = useCallback((next: number) => {
    widthRef.current = next;
    setPanelWidthState(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  const startResize = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault();
      // A prior drag's listeners are removed on mouseup, but guard against a
      // second mousedown arriving before that fires.
      cleanupRef.current?.();

      const startX = event.clientX;
      const startWidth = widthRef.current;

      function onMove(moveEvent: MouseEvent) {
        if (!mountedRef.current) return;
        const diff = moveEvent.clientX - startX;
        setPanelWidth(
          Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + diff)),
        );
      }

      function onUp() {
        cleanupRef.current?.();
        cleanupRef.current = null;
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      cleanupRef.current = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
    },
    [setPanelWidth],
  );

  return { panelWidth, startResize };
}
