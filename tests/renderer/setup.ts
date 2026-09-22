import '@testing-library/jest-dom/vitest';

// jsdom does not implement PointerEvent, while Base UI dispatches one when
// button-like controls (notably Switch) synchronize their hidden input.
if (typeof window.PointerEvent !== 'function') {
  window.PointerEvent = MouseEvent as unknown as typeof PointerEvent;
}
