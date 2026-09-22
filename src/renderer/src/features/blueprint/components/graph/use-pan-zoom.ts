import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';

import { PanZoomEngine } from './pan-zoom-engine';
import { centeredZoomTarget, wheelTarget } from './pan-zoom-events';
import { fitView, type ViewSize } from './pan-zoom-math';

export interface PanZoomController {
  fit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  onCanvasMouseDown: (event: ReactMouseEvent | MouseEvent) => void;
  onWheel: (event: WheelEvent) => void;
}

export interface PanZoomOptions {
  /** Inset in pixels kept around the graph when fitting it to the viewport. */
  fitMargin?: number;
  /** Maximum automatic fit scale; defaults to the graph's natural size. */
  fitMaxScale?: number;
}

interface PanCallbacks {
  onCanvasMouseDown: PanZoomController['onCanvasMouseDown'];
  onWindowMouseMove: (event: MouseEvent) => void;
  onWindowMouseUp: () => void;
}

/** Bind compositor-driven pan and zoom controls without React render churn. */
export function usePanZoom(
  containerRef: RefObject<HTMLElement | null>,
  viewportRef: RefObject<HTMLElement | null>,
  getLayoutSize: () => ViewSize,
  options: PanZoomOptions = {},
): PanZoomController {
  const optionsRef = useLatest(options);
  const getLayoutSizeRef = useLatest(getLayoutSize);
  const engine = usePanZoomEngine(viewportRef);
  const pan = usePanCallbacks(engine);
  const fit = useFitCallback(engine, containerRef, getLayoutSizeRef, optionsRef);
  const zoom = useZoomCallbacks(engine, containerRef);
  usePanLifecycle(engine, viewportRef, pan);
  return {
    fit,
    zoomIn: zoom.zoomIn,
    zoomOut: zoom.zoomOut,
    onCanvasMouseDown: pan.onCanvasMouseDown,
    onWheel: zoom.onWheel,
  };
}

function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function usePanZoomEngine(
  viewportRef: RefObject<HTMLElement | null>,
): PanZoomEngine {
  const engineRef = useRef<PanZoomEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new PanZoomEngine(() => viewportRef.current);
  }
  engineRef.current.setViewportAccessor(() => viewportRef.current);
  return engineRef.current;
}

function usePanCallbacks(engine: PanZoomEngine): PanCallbacks {
  const onCanvasMouseDown = useCallback((event: ReactMouseEvent | MouseEvent) => {
    if (event.button !== 0) return;
    engine.startPan({ x: event.clientX, y: event.clientY });
  }, [engine]);
  const onWindowMouseMove = useCallback((event: MouseEvent) => {
    engine.movePan({ x: event.clientX, y: event.clientY });
  }, [engine]);
  const onWindowMouseUp = useCallback(() => engine.endPan(), [engine]);
  return { onCanvasMouseDown, onWindowMouseMove, onWindowMouseUp };
}

function useFitCallback(
  engine: PanZoomEngine,
  containerRef: RefObject<HTMLElement | null>,
  getLayoutSizeRef: RefObject<() => ViewSize>,
  optionsRef: RefObject<PanZoomOptions>,
): () => void {
  return useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const view = fitView(
      { width: rect.width, height: rect.height },
      getLayoutSizeRef.current(),
      {
        fitMargin: optionsRef.current.fitMargin ?? 48,
        fitMaxScale: optionsRef.current.fitMaxScale ?? 1,
      },
    );
    if (view) engine.setView(view);
  }, [containerRef, engine, getLayoutSizeRef, optionsRef]);
}

function useZoomCallbacks(
  engine: PanZoomEngine,
  containerRef: RefObject<HTMLElement | null>,
): Pick<PanZoomController, 'onWheel' | 'zoomIn' | 'zoomOut'> {
  const onWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    engine.setTarget(wheelTarget(
      event,
      container.getBoundingClientRect(),
      engine.getTargetView(),
    ));
  }, [containerRef, engine]);
  const zoomBy = useCallback((factor: number) => {
    const container = containerRef.current;
    if (!container) return;
    engine.setTarget(centeredZoomTarget(
      container.getBoundingClientRect(),
      engine.getTargetView(),
      factor,
    ));
  }, [containerRef, engine]);
  const zoomIn = useCallback(() => zoomBy(1.35), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(1 / 1.35), [zoomBy]);
  return { onWheel, zoomIn, zoomOut };
}

function usePanLifecycle(
  engine: PanZoomEngine,
  viewportRef: RefObject<HTMLElement | null>,
  pan: PanCallbacks,
): void {
  useEffect(() => {
    window.addEventListener('mousemove', pan.onWindowMouseMove);
    window.addEventListener('mouseup', pan.onWindowMouseUp);
    const viewport = viewportRef.current;
    return () => {
      window.removeEventListener('mousemove', pan.onWindowMouseMove);
      window.removeEventListener('mouseup', pan.onWindowMouseUp);
      engine.cleanup(viewport);
    };
  }, [engine, pan.onWindowMouseMove, pan.onWindowMouseUp, viewportRef]);
}
