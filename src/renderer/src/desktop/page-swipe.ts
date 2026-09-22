import type { PageNavigationState } from '@shared/desktop';

const THRESHOLD = 140;
const IDLE_MS = 180;

/** Let editors, controls, horizontal scroll areas and custom canvases own their gesture. */
function ownsHorizontalGesture(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), .cm-editor, [role="dialog"], [role="menu"], [data-page-swipe="off"]')) return true;
  for (let element: Element | null = target; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (element.scrollWidth > element.clientWidth + 1 && /auto|scroll/.test(style.overflowX)) return true;
  }
  return false;
}

export interface SwipeProgress { offset: -1 | 1; progress: number }

/** Recognize pixel-mode horizontal trackpad swipes, not ordinary wheel/zoom input.
 * One navigation per burst; momentum cannot skip through multiple pages. Reversing
 * before the threshold cancels. Commit immediately rather than waiting through
 * the trackpad's momentum tail. Native browser overscroll is suppressed for a swipe
 * we own; all vertical/editor/canvas scrolling remains untouched.
 */
export function installPageSwipe(
  getState: () => PageNavigationState,
  navigate: (offset: -1 | 1) => void,
  showProgress: (progress: SwipeProgress | null) => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cueTimer: ReturnType<typeof setTimeout> | undefined;
  let mode: 'pending' | 'ignored' | 'tracking' | 'committed' = 'pending';
  let x = 0;
  let y = 0;
  let previousDelta = 0;
  let slowingSamples = 0;
  let acceleratingSamples = 0;
  let acceleration = 0;
  let reverseDistance = 0;
  const reset = () => {
    clearTimeout(cueTimer);
    mode = 'pending'; x = 0; y = 0; previousDelta = 0;
    slowingSamples = 0; acceleratingSamples = 0; acceleration = 0; reverseDistance = 0;
    showProgress(null);
  };
  const finish = () => {
    timer = undefined;
    reset();
  };
  const onWheel = (event: WheelEvent) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(finish, IDLE_MS);
    const state = getState();
    if (!state.swipeEnabled || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.deltaMode !== 0) mode = 'ignored';
    if (mode === 'committed') {
      // DOM wheel events don't expose macOS touch/momentum phases. A fading
      // tail must stay latched, but must not swallow a fresh push indefinitely.
      // Rearm on deliberate reversal or sustained acceleration after decay.
      // No wall-clock cooldown: two distinct quick swipes are valid input.
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 2) return;
      const magnitude = Math.abs(event.deltaX);
      const reversed = event.deltaX * x < 0;
      reverseDistance = reversed ? reverseDistance + magnitude : 0;
      const gain = magnitude - previousDelta;
      if (!reversed && gain < -0.5) slowingSamples++;
      if (!reversed && slowingSamples >= 3 && gain > 1) {
        acceleratingSamples++;
        acceleration += gain;
      } else {
        acceleratingSamples = 0;
        acceleration = 0;
      }
      previousDelta = magnitude;
      if (reverseDistance < 24 && !(acceleratingSamples >= 2 && acceleration >= 12)) return;
      reset();
    }
    if (mode === 'pending' && ownsHorizontalGesture(event.target)) mode = 'ignored';
    if (mode === 'ignored') return;
    x += event.deltaX;
    y += Math.abs(event.deltaY);
    if (mode === 'pending') {
      if (Math.max(Math.abs(x), y) < 12) return;
      mode = Math.abs(x) > y * 2 ? 'tracking' : 'ignored';
    }
    if (mode !== 'tracking') return;
    const offset = x < 0 ? -1 : 1;
    if (!(offset === -1 ? state.canGoBack : state.canGoForward)) {
      // History boundaries (and a briefly stale bridge snapshot) are not an
      // owned editor/vertical gesture. Keep listening so a reversal or refreshed
      // history can navigate immediately, without waiting out the momentum tail.
      x = 0;
      y = 0;
      showProgress(null);
      return;
    }
    if (event.cancelable) event.preventDefault();
    showProgress({ offset, progress: Math.min(Math.abs(x) / THRESHOLD, 1) });
    if (Math.abs(x) >= THRESHOLD) {
      mode = 'committed';
      previousDelta = Math.abs(event.deltaX);
      cueTimer = setTimeout(() => showProgress(null), IDLE_MS);
      navigate(offset);
    }
  };
  const cancel = () => { clearTimeout(timer); timer = undefined; reset(); };
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('blur', cancel);
  window.addEventListener('pointerdown', cancel);
  window.addEventListener('keydown', cancel);
  return () => {
    clearTimeout(timer);
    clearTimeout(cueTimer);
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('blur', cancel);
    window.removeEventListener('pointerdown', cancel);
    window.removeEventListener('keydown', cancel);
  };
}
