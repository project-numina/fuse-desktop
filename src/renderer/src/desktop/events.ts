/**
 * Window-level custom events the desktop shell dispatches for native menu
 * commands that target whichever chat is on screen. The workspace listens
 * with `window.addEventListener(FOCUS_COMPOSER_EVENT, …)`; the shell does not
 * know which composer is mounted, so a broadcast keeps the two decoupled.
 */

export const FOCUS_COMPOSER_EVENT = 'fuse:focus-composer';
export const STOP_TURN_EVENT = 'fuse:stop-turn';

export function dispatchShellEvent(name: typeof FOCUS_COMPOSER_EVENT | typeof STOP_TURN_EVENT): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name));
}
