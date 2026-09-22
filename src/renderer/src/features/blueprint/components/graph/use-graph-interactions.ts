import { useCallback, useEffect, useRef, type RefObject } from 'react';

import { usePanZoom } from '@/features/blueprint/components/graph/use-pan-zoom';
import type { Layout } from '@/features/blueprint/lib/graph-layout';

function useResizeFit(
  containerRef: RefObject<HTMLDivElement | null>,
  hasEntries: boolean,
  fit: () => void,
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const rafId = requestAnimationFrame(fit);
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [containerRef, hasEntries, fit]);
}

/** Native non-passive wheel handling is required for preventDefault. */
function useWheelListener(
  containerRef: RefObject<HTMLDivElement | null>,
  hasEntries: boolean,
  onWheel: (event: WheelEvent) => void,
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handler = (event: WheelEvent) => onWheel(event);
    container.addEventListener('wheel', handler, { passive: false });
    return () => container.removeEventListener('wheel', handler);
  }, [containerRef, hasEntries, onWheel]);
}

function useRefitLifecycle(
  layout: Layout,
  activeChapterPath: string,
  isActive: boolean,
  fit: () => void,
): void {
  useEffect(() => {
    const rafId = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(rafId);
  }, [layout.width, layout.height, layout.nodes.length, fit]);
  useEffect(() => {
    const rafId = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(rafId);
  }, [activeChapterPath, fit]);
  useEffect(() => {
    if (!isActive) return;
    const rafId = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(rafId);
  }, [isActive, fit]);
}

export function useGraphInteractions(
  layout: Layout,
  hasEntries: boolean,
  activeChapterPath: string,
  isActive: boolean,
  fitOptions: { fitMargin?: number; fitMaxScale?: number },
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const getLayoutSize = useCallback(
    () => ({ width: layoutRef.current.width, height: layoutRef.current.height }),
    [],
  );
  const controls = usePanZoom(
    containerRef,
    viewportRef,
    getLayoutSize,
    fitOptions,
  );
  useResizeFit(containerRef, hasEntries, controls.fit);
  useWheelListener(containerRef, hasEntries, controls.onWheel);
  useRefitLifecycle(layout, activeChapterPath, isActive, controls.fit);
  return { containerRef, viewportRef, ...controls };
}
