import type { Point } from './einstein-geometry';
import type { Hat } from './einstein-substitution';

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface CanvasSetup {
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
}

interface ViewportTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface TilingPalette {
  stroke: string;
  fill: Record<string, string>;
}

const LIGHT_PALETTE: TilingPalette = {
  stroke: 'rgba(204, 80, 52, 0.08)',
  fill: {
    H1: 'rgba(204, 80, 52, 0.065)',
    F: 'rgba(204, 80, 52, 0.045)',
    T: 'rgba(255, 153, 102, 0.05)',
    P: 'rgba(255, 153, 102, 0.035)',
  },
};

const DARK_PALETTE: TilingPalette = {
  stroke: 'rgba(231, 120, 65, 0.11)',
  fill: {
    H1: 'rgba(231, 120, 65, 0.065)',
    F: 'rgba(231, 120, 65, 0.04)',
    T: 'rgba(165, 199, 255, 0.08)',
    P: 'rgba(231, 120, 65, 0.035)',
  },
};

function computeBoundingBox(hats: Hat[]): Bounds {
  const bounds = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  };
  for (const hat of hats) {
    for (const point of hat.points) {
      if (point.x < bounds.minX) bounds.minX = point.x;
      if (point.x > bounds.maxX) bounds.maxX = point.x;
      if (point.y < bounds.minY) bounds.minY = point.y;
      if (point.y > bounds.maxY) bounds.maxY = point.y;
    }
  }
  return bounds;
}

function setupCanvas(canvas: HTMLCanvasElement): CanvasSetup {
  const context = canvas.getContext('2d')!;
  const devicePixelRatio = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * devicePixelRatio;
  canvas.height = height * devicePixelRatio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}

function resolvePalette(): TilingPalette {
  if (typeof document === 'undefined') return LIGHT_PALETTE;
  return document.documentElement.classList.contains('dark')
    || document.documentElement.dataset.theme === 'dark'
    ? DARK_PALETTE
    : LIGHT_PALETTE;
}

function calculateViewportTransform(
  hats: Hat[],
  width: number,
  height: number,
  fixedScale?: number,
): ViewportTransform {
  const bounds = computeBoundingBox(hats);
  const tilingWidth = bounds.maxX - bounds.minX;
  const tilingHeight = bounds.maxY - bounds.minY;
  const scale = fixedScale
    ?? Math.max(width / tilingWidth, height / tilingHeight) * 2.5;
  return {
    scale,
    offsetX: width / 2 - (bounds.minX + tilingWidth / 2) * scale,
    offsetY: height / 2 - (bounds.minY + tilingHeight / 2) * scale,
  };
}

function toScreen(point: Point, viewport: ViewportTransform): Point {
  return {
    x: point.x * viewport.scale + viewport.offsetX,
    y: point.y * viewport.scale + viewport.offsetY,
  };
}

function isVisible(
  hat: Hat,
  viewport: ViewportTransform,
  width: number,
  height: number,
): boolean {
  const screenBounds = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  };
  for (const point of hat.points) {
    const screenPoint = toScreen(point, viewport);
    if (screenPoint.x < screenBounds.minX) screenBounds.minX = screenPoint.x;
    if (screenPoint.x > screenBounds.maxX) screenBounds.maxX = screenPoint.x;
    if (screenPoint.y < screenBounds.minY) screenBounds.minY = screenPoint.y;
    if (screenPoint.y > screenBounds.maxY) screenBounds.maxY = screenPoint.y;
  }
  return screenBounds.maxX >= 0 && screenBounds.minX <= width
    && screenBounds.maxY >= 0 && screenBounds.minY <= height;
}

function traceHat(
  context: CanvasRenderingContext2D,
  hat: Hat,
  viewport: ViewportTransform,
): void {
  context.beginPath();
  const firstPoint = toScreen(hat.points[0], viewport);
  context.moveTo(firstPoint.x, firstPoint.y);
  for (let index = 1; index < hat.points.length; index++) {
    const point = toScreen(hat.points[index], viewport);
    context.lineTo(point.x, point.y);
  }
  context.closePath();
}

export function renderHats(
  canvas: HTMLCanvasElement,
  hats: Hat[],
  fixedScale?: number,
): void {
  const { context, width, height } = setupCanvas(canvas);
  const viewport = calculateViewportTransform(hats, width, height, fixedScale);
  const palette = resolvePalette();
  context.strokeStyle = palette.stroke;
  context.lineWidth = 0.6;

  for (const hat of hats) {
    if (!isVisible(hat, viewport, width, height)) continue;
    traceHat(context, hat, viewport);
    const fill = palette.fill[hat.label];
    if (fill) {
      context.fillStyle = fill;
      context.fill();
    }
    context.stroke();
  }
}
