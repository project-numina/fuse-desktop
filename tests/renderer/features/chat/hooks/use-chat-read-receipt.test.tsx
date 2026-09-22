import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatReadReceipt } from '@/features/chat/hooks/use-chat-read-receipt';

const mocks = vi.hoisted(() => ({ seen: vi.fn(), revision: 'response-1', unread: true }));
vi.mock('@/hooks/use-session-attention', () => ({
  markSessionSeen: mocks.seen,
  useSessionAttention: () => [{ id: 'chat', revision: mocks.revision, unread: mocks.unread, state: 'idle' }],
}));
let intersect: (visible: boolean) => void;
function View({ enabled = true, revision = 'response-1' }) {
  const ref = useChatReadReceipt('chat', enabled, revision);
  return <div ref={ref} />;
}
beforeEach(() => {
  vi.useFakeTimers();
  mocks.seen.mockReset().mockResolvedValue(undefined);
  mocks.revision = 'response-1';
  mocks.unread = true;
  intersect = () => {};
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) {
      intersect = (visible) => callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('chat read receipts', () => {
  it('waits for the response end to become visible, then acknowledges only that response', async () => {
    render(<View />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(mocks.seen).not.toHaveBeenCalled();
    await act(async () => { intersect(true); await vi.advanceTimersByTimeAsync(400); });
    expect(mocks.seen).toHaveBeenCalledExactlyOnceWith('chat', 'response-1');
  });
  it('does not clear a badge just because the window is focused', async () => {
    render(<View />);
    await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(1000); });
    expect(mocks.seen).not.toHaveBeenCalled();
  });
  it('waits for focus even when the response is visible', async () => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    render(<View />);
    await act(async () => { intersect(true); await vi.advanceTimersByTimeAsync(1000); });
    expect(mocks.seen).not.toHaveBeenCalled();
    vi.mocked(document.hasFocus).mockReturnValue(true);
    await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(400); });
    expect(mocks.seen).toHaveBeenCalledOnce();
  });
  it('does not acknowledge a newer response that is not in the rendered transcript', async () => {
    mocks.revision = 'response-2';
    render(<View />);
    await act(async () => { intersect(true); await vi.advanceTimersByTimeAsync(1000); });
    expect(mocks.seen).not.toHaveBeenCalled();
  });
  it('cancels receipts while working, switching away, or scrolling offscreen', async () => {
    const view = render(<View enabled={false} />);
    await act(async () => { intersect(true); await vi.advanceTimersByTimeAsync(1000); });
    expect(mocks.seen).not.toHaveBeenCalled();
    view.rerender(<View />);
    act(() => { intersect(true); });
    act(() => { intersect(false); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(mocks.seen).not.toHaveBeenCalled();
    act(() => { intersect(true); });
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(mocks.seen).not.toHaveBeenCalled();
  });
});
