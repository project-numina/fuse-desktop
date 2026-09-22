export interface GraphNodeDimensions {
  width: number;
  height: number;
}

export const GRAPH_NODE_WIDTH_REM = 13;
export const GRAPH_NODE_MIN_HEIGHT_REM = 5;

const DEFAULT_ROOT_FONT_SIZE_PIXELS = 16;

function normalizeRootFontSize(rootFontSizePixels: number): number {
  if (!Number.isFinite(rootFontSizePixels) || rootFontSizePixels <= 0) {
    return DEFAULT_ROOT_FONT_SIZE_PIXELS;
  }
  return rootFontSizePixels;
}

export function graphNodeFallbackDimensions(
  rootFontSizePixels = DEFAULT_ROOT_FONT_SIZE_PIXELS,
): GraphNodeDimensions {
  const normalizedRootFontSize = normalizeRootFontSize(rootFontSizePixels);
  return {
    width: GRAPH_NODE_WIDTH_REM * normalizedRootFontSize,
    height: GRAPH_NODE_MIN_HEIGHT_REM * normalizedRootFontSize,
  };
}

export function readRootFontSizePixels(): number {
  if (typeof window === 'undefined') return DEFAULT_ROOT_FONT_SIZE_PIXELS;

  const fontSize = Number.parseFloat(
    window.getComputedStyle(document.documentElement).fontSize,
  );
  return normalizeRootFontSize(fontSize);
}
