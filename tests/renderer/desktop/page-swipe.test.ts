import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageNavigationState } from '@shared/desktop';
import { installPageSwipe } from '@/desktop/page-swipe';

let remove: () => void;
let state: PageNavigationState;
const navigate = vi.fn();
const progress = vi.fn();
function wheel(deltaX: number, options: WheelEventInit = {}, target: Element = document.body) {
  const event = new WheelEvent('wheel', { deltaX, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(10_000); vi.clearAllMocks();
  state = { swipeEnabled: true, canGoBack: true, canGoForward: true };
  remove = installPageSwipe(() => state, navigate, progress);
});
afterEach(() => { remove(); document.body.replaceChildren(); vi.useRealTimers(); });

describe('trackpad page gestures', () => {
  it('navigates immediately at the threshold in either direction', () => {
    expect(wheel(-70).defaultPrevented).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    wheel(-80);
    expect(progress).toHaveBeenLastCalledWith({ offset: -1, progress: 1 });
    expect(navigate).toHaveBeenLastCalledWith(-1);
    vi.advanceTimersByTime(700);
    wheel(150);
    expect(navigate).toHaveBeenLastCalledWith(1);
  });
  it('ignores small/vertical gestures, pinch zoom, modified and line-mode wheel input', () => {
    for (const options of [{}, { deltaY: 200 }, { ctrlKey: true }, { shiftKey: true }, { deltaMode: 1 }]) {
      wheel(options.ctrlKey || options.shiftKey || options.deltaMode ? -200 : -30, options);
      vi.advanceTimersByTime(200);
    }
    expect(navigate).not.toHaveBeenCalled();
  });
  it('locks a gesture that began vertically, even when later movement is horizontal', () => {
    wheel(2, { deltaY: 25 });
    expect(wheel(-200).defaultPrevented).toBe(false);
    vi.advanceTimersByTime(200);
    expect(navigate).not.toHaveBeenCalled();
  });
  it('respects system preferences, history boundaries and other wheel handlers', () => {
    state.swipeEnabled = false;
    expect(wheel(-200).defaultPrevented).toBe(false);
    vi.advanceTimersByTime(200);
    state.swipeEnabled = true; state.canGoBack = false;
    expect(wheel(-200).defaultPrevented).toBe(false);
    vi.advanceTimersByTime(200);
    state.canGoBack = true;
    const canvas = document.createElement('div'); document.body.append(canvas);
    canvas.addEventListener('wheel', event => event.preventDefault());
    wheel(-200, {}, canvas);
    vi.advanceTimersByTime(200);
    expect(navigate).not.toHaveBeenCalled();
  });
  it('never steals a gesture from editors, controls, dialogs or horizontal scrollers', () => {
    for (const markup of ['<textarea></textarea>', '<input />', '<div contenteditable="true"></div>', '<div class="cm-editor"></div>', '<div role="dialog"></div>', '<div data-page-swipe="off"></div>']) {
      document.body.innerHTML = markup;
      expect(wheel(-200, {}, document.body.firstElementChild!).defaultPrevented).toBe(false);
      vi.advanceTimersByTime(200);
    }
    const scroller = document.createElement('div'); scroller.style.overflowX = 'auto'; document.body.append(scroller);
    Object.defineProperties(scroller, { scrollWidth: { value: 400 }, clientWidth: { value: 200 } });
    expect(wheel(-200, {}, scroller).defaultPrevented).toBe(false);
    vi.advanceTimersByTime(200);
    expect(navigate).not.toHaveBeenCalled();
  });
  it('allows reversal to cancel, and cancels on blur or a click', () => {
    wheel(-100); wheel(80);
    vi.advanceTimersByTime(200);
    wheel(-100); window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(200);
    wheel(-100); window.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(200);
    expect(navigate).not.toHaveBeenCalled();
  });
  it('prevents momentum from navigating multiple pages and cleans up listeners/timers', () => {
    wheel(-200);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(-1);
    for (let i = 0; i < 60; i++) { wheel(-20); vi.advanceTimersByTime(40); }
    expect(progress).toHaveBeenLastCalledWith(null);
    vi.advanceTimersByTime(200);
    expect(navigate).toHaveBeenCalledTimes(1);
    wheel(-70); remove(); vi.advanceTimersByTime(200);
    wheel(-200); vi.advanceTimersByTime(200);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('accepts a quick reverse swipe without waiting for the old momentum tail', () => {
    wheel(-150);
    for (const delta of [-50, -25, -10, -3]) { vi.advanceTimersByTime(16); wheel(delta); }
    wheel(30); wheel(60); wheel(70);
    expect(navigate.mock.calls).toEqual([[-1], [1]]);
  });

  it('accepts a second same-direction push after momentum decays', () => {
    wheel(-150);
    for (const delta of [-60, -40, -20, -8, -2, -6, -20, -60, -80]) {
      vi.advanceTimersByTime(16); wheel(delta);
    }
    expect(navigate.mock.calls).toEqual([[-1], [-1]]);
  });

  it('has no cooldown between separate bursts', () => {
    wheel(-150);
    vi.advanceTimersByTime(181);
    wheel(-150);
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('allows reversing at a history boundary without waiting for an idle gap', () => {
    state.canGoForward = false;
    wheel(25);
    wheel(-80); wheel(-80);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(-1);
  });

  it('does not latch a briefly stale history state for the rest of the gesture', () => {
    state.canGoForward = false;
    wheel(15);
    state.canGoForward = true;
    wheel(80); wheel(80);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('does not mistake a continuing push, decay, or tiny reversal for a second swipe', () => {
    wheel(-150);
    for (const delta of [-170, -190, -180, -150, -100, -60, -30, -8, -3, 1, -2, 2, -1]) {
      vi.advanceTimersByTime(16); wheel(delta);
    }
    expect(navigate).toHaveBeenCalledOnce();
  });
});
