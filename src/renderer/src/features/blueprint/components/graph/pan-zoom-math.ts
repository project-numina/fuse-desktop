export interface Translate {
  x: number;
  y: number;
}

export interface ViewTransform {
  scale: number;
  translate: Translate;
}

export interface ViewSize {
  width: number;
  height: number;
}

export interface FitViewOptions {
  fitMargin: number;
  fitMaxScale: number;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 2.5;
const ZOOM_SMOOTHING = 0.18;

export function zoomAroundPoint(
  view: ViewTransform,
  anchor: Translate,
  factor: number,
): ViewTransform {
  const scale = clampScale(view.scale * factor);
  const ratio = scale / view.scale;
  return {
    scale,
    translate: {
      x: anchor.x - (anchor.x - view.translate.x) * ratio,
      y: anchor.y - (anchor.y - view.translate.y) * ratio,
    },
  };
}

export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const rawDelta = deltaMode === 1 ? deltaY * 16 : deltaY;
  const clampedDelta = Math.max(-80, Math.min(80, rawDelta));
  return Math.exp(-clampedDelta * 0.0014);
}

export function fitView(
  container: ViewSize,
  graph: ViewSize,
  options: FitViewOptions,
): ViewTransform | null {
  if (!graph.width || !graph.height || !container.width || !container.height) {
    return null;
  }
  const scale = Math.min(
    (container.width - options.fitMargin * 2) / graph.width,
    (container.height - options.fitMargin * 2) / graph.height,
    options.fitMaxScale,
  );
  return {
    scale,
    translate: {
      x: (container.width - graph.width * scale) / 2,
      y: (container.height - graph.height * scale) / 2,
    },
  };
}

export function smoothView(
  current: ViewTransform,
  target: ViewTransform,
): { view: ViewTransform; settled: boolean } {
  const scaleDelta = target.scale - current.scale;
  const xDelta = target.translate.x - current.translate.x;
  const yDelta = target.translate.y - current.translate.y;
  const settled = Math.abs(scaleDelta) < 0.0005
    && Math.abs(xDelta) < 0.5
    && Math.abs(yDelta) < 0.5;
  if (settled) return { view: cloneView(target), settled: true };
  return {
    settled: false,
    view: {
      scale: current.scale + scaleDelta * ZOOM_SMOOTHING,
      translate: {
        x: current.translate.x + xDelta * ZOOM_SMOOTHING,
        y: current.translate.y + yDelta * ZOOM_SMOOTHING,
      },
    },
  };
}

export function cloneView(view: ViewTransform): ViewTransform {
  return { scale: view.scale, translate: { ...view.translate } };
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}
