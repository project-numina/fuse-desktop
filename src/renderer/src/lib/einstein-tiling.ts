import { renderHats } from './einstein-rendering';
import { generateHats, type Hat } from './einstein-substitution';

export function generateTiling(iterations: number): Hat[] {
  return generateHats(iterations);
}

export function renderTiling(
  canvas: HTMLCanvasElement,
  hats: Hat[],
  fixedScale?: number,
): void {
  renderHats(canvas, hats, fixedScale);
}
