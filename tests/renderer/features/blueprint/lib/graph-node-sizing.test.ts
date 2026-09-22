import { afterEach, describe, expect, it } from 'vitest';

import { graphNodeFallbackDimensions, readRootFontSizePixels } from '@/features/blueprint/lib/graph-node-sizing';

const originalRootFontSize = document.documentElement.style.fontSize;

afterEach(() => {
  document.documentElement.style.fontSize = originalRootFontSize;
});

describe('graph node sizing', () => {
  it.each([
    [16, { width: 208, height: 80 }],
    [20, { width: 260, height: 100 }],
    [Number.NaN, { width: 208, height: 80 }],
    [0, { width: 208, height: 80 }],
    [-10, { width: 208, height: 80 }],
  ])('calculates fallback dimensions for %s pixels', (fontSize, expected) => {
    expect(graphNodeFallbackDimensions(fontSize)).toEqual(expected);
  });

  it('reads the computed browser root font size', () => {
    document.documentElement.style.fontSize = '18px';
    expect(readRootFontSizePixels()).toBe(18);
  });

  it('falls back when the computed root font size is invalid', () => {
    document.documentElement.style.fontSize = '';
    expect(readRootFontSizePixels()).toBe(16);
  });
});
