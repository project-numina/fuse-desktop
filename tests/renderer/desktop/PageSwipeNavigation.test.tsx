import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageNavigationState } from '@shared/desktop';
import type { ShellRouter } from '@/desktop/DesktopIntegration';
import PageSwipeNavigation from '@/desktop/PageSwipeNavigation';

const bridge = vi.hoisted(() => ({ navigation: { state: vi.fn(), go: vi.fn() } }));
vi.mock('@/desktop/bridge', () => ({ desktopApi: () => bridge }));
const allowed: PageNavigationState = { swipeEnabled: true, canGoBack: true, canGoForward: true };
function router() {
  const unsubscribe = vi.fn();
  let listener!: () => void;
  const value = { subscribe: vi.fn(callback => { listener = callback; return unsubscribe; }) } as unknown as ShellRouter;
  return { value, unsubscribe, emit: () => listener() };
}
beforeEach(() => {
  vi.clearAllMocks();
  bridge.navigation.state.mockResolvedValue(allowed);
  bridge.navigation.go.mockResolvedValue(true);
});
afterEach(() => { vi.useRealTimers(); document.documentElement.style.overscrollBehaviorX = ''; });

describe('page swipe integration', () => {
  it('uses the native history bridge and restores scrolling policy on unmount', async () => {
    const r = router();
    document.documentElement.style.overscrollBehaviorX = 'contain';
    const view = render(<PageSwipeNavigation router={r.value} />);
    await waitFor(() => expect(document.documentElement.style.overscrollBehaviorX).toBe('none'));
    vi.useFakeTimers();
    fireEvent.wheel(document.body, { deltaX: -180 });
    const cue = view.container.querySelector('[aria-hidden="true"]');
    expect(cue).toHaveClass('left-0', 'rounded-r-full', 'h-32', 'w-16', 'bg-foreground/15');
    expect(cue).not.toHaveClass('border');
    expect(bridge.navigation.go).toHaveBeenCalledWith(-1);
    act(() => vi.advanceTimersByTime(200));
    expect(bridge.navigation.go).toHaveBeenCalledWith(-1);
    view.unmount();
    expect(r.unsubscribe).toHaveBeenCalledOnce();
    expect(document.documentElement.style.overscrollBehaviorX).toBe('contain');
  });
  it('refreshes on navigation and focus, and ignores stale state responses', async () => {
    let finish!: (value: PageNavigationState) => void;
    bridge.navigation.state.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const r = router();
    render(<PageSwipeNavigation router={r.value} />);
    act(() => r.emit());
    await waitFor(() => expect(document.documentElement.style.overscrollBehaviorX).toBe('none'));
    await act(async () => { finish({ ...allowed, swipeEnabled: false }); });
    expect(document.documentElement.style.overscrollBehaviorX).toBe('none');
    bridge.navigation.state.mockResolvedValue({ ...allowed, swipeEnabled: false });
    fireEvent.focus(window);
    await waitFor(() => expect(document.documentElement.style.overscrollBehaviorX).toBe(''));
  });
});
