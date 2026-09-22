import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTranscriptScroll } from '@/features/chat/hooks/transcript-scroll';
import type { RenderedChatTurn } from '@/features/chat/hooks/chat-turns';

interface ResizeObserverTestDouble {
  callback: ResizeObserverCallback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

const observers: ResizeObserverTestDouble[] = [];

function turn(id = 'turn-0'): RenderedChatTurn {
  return {
    id, userText: 'hello', userContextAttachments: [], hasUser: true,
    assistantBlocks: [], frozenActivities: [],
    assistantRenderedBlocks: [], assistantPresent: false, assistantStreaming: false, assistantState: 'none',
  };
}

function elementGeometry(element: HTMLElement, values: { scrollHeight: number; clientHeight: number; scrollTop?: number }) {
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: values.scrollHeight },
    clientHeight: { configurable: true, value: values.clientHeight },
    scrollTop: { configurable: true, writable: true, value: values.scrollTop ?? 0 },
  });
}

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(public callback: ResizeObserverCallback) { observers.push(this); }
  });
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(performance.now());
    // Keep the hook's RAF ref clear after this synchronous test double runs.
    return null as unknown as number;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useTranscriptScroll', () => {
  it('reports when transcript content remains below the viewport', () => {
    const { result } = renderHook(() => useTranscriptScroll({ latestTurnId: null, renderedTurns: [], isBusy: () => false }));
    const scroll = document.createElement('div');
    elementGeometry(scroll, { scrollHeight: 500, clientHeight: 200, scrollTop: 100 });
    act(() => { result.current.scrollRef.current = scroll; result.current.handleScroll(); });
    expect(result.current.showMoreBelow).toBe(true);
    scroll.scrollTop = 300;
    act(() => result.current.handleScroll());
    expect(result.current.showMoreBelow).toBe(false);
  });

  it('scrolls one pane to the bottom and releases automatic following', () => {
    const { result } = renderHook(() => useTranscriptScroll({ latestTurnId: null, renderedTurns: [], isBusy: () => false }));
    const scroll = document.createElement('div');
    elementGeometry(scroll, { scrollHeight: 600, clientHeight: 200 });
    const scrollTo = vi.fn((options?: ScrollToOptions | number) => {
      if (typeof options === 'object' && typeof options.top === 'number') {
        scroll.scrollTop = options.top;
      }
    });
    scroll.scrollTo = scrollTo as typeof scroll.scrollTo;
    act(() => { result.current.scrollRef.current = scroll; result.current.scrollDownOnePane(); });
    expect(scrollTo).toHaveBeenCalledWith({ top: 400, behavior: 'smooth' });
  });

  it('aligns a newly active turn and observes both turn and container', async () => {
    const initialTurns = [turn()];
    const { result, rerender } = renderHook(({ turns }) => useTranscriptScroll({ latestTurnId: 'turn-0', renderedTurns: turns, isBusy: () => true }), { initialProps: { turns: [] as RenderedChatTurn[] } });
    const scroll = document.createElement('div');
    const transcript = document.createElement('div');
    const active = document.createElement('section');
    active.dataset.turnId = 'turn-0';
    const bubble = document.createElement('div');
    bubble.className = 'user-bubble';
    active.append(bubble);
    scroll.append(active);
    elementGeometry(scroll, { scrollHeight: 500, clientHeight: 200 });
    elementGeometry(transcript, { scrollHeight: 400, clientHeight: 400 });
    scroll.scrollTo = vi.fn();
    act(() => { result.current.scrollRef.current = scroll; result.current.transcriptRef.current = transcript; });
    rerender({ turns: initialTurns });
    await act(async () => Promise.resolve());
    expect(scroll.scrollTo).toHaveBeenCalled();
    expect(observers.some((observer) => observer.observe.mock.calls.some(([target]) => target === active))).toBe(true);
    expect(observers.some((observer) => observer.observe.mock.calls.some(([target]) => target === scroll))).toBe(true);
  });

  it('does not realign a completed transcript when the composer resizes', async () => {
    const initialTurns = [turn()];
    const { result, rerender } = renderHook(
      ({ turns }) => useTranscriptScroll({
        latestTurnId: 'turn-0',
        renderedTurns: turns,
        isBusy: () => false,
      }),
      { initialProps: { turns: [] as RenderedChatTurn[] } },
    );
    const scroll = document.createElement('div');
    const transcript = document.createElement('div');
    const active = document.createElement('section');
    active.dataset.turnId = 'turn-0';
    const bubble = document.createElement('div');
    bubble.className = 'user-bubble';
    active.append(bubble);
    scroll.append(active);
    elementGeometry(scroll, { scrollHeight: 500, clientHeight: 200, scrollTop: 120 });
    elementGeometry(transcript, { scrollHeight: 500, clientHeight: 500 });
    scroll.scrollTo = vi.fn();
    act(() => {
      result.current.scrollRef.current = scroll;
      result.current.transcriptRef.current = transcript;
    });

    rerender({ turns: initialTurns });
    await act(async () => Promise.resolve());
    expect(scroll.scrollTo).toHaveBeenCalled();
    vi.mocked(scroll.scrollTo).mockClear();

    const containerObserver = observers.find((observer) =>
      observer.observe.mock.calls.some(([target]) => target === scroll)
    );
    expect(containerObserver).toBeDefined();
    act(() => containerObserver?.callback([], containerObserver as unknown as ResizeObserver));
    await act(async () => Promise.resolve());

    expect(scroll.scrollTo).not.toHaveBeenCalled();
  });

  it('resumes across a continuation gap unless the user releases it', async () => {
    const activeTurns = [turn()];
    const { result, rerender } = renderHook(
      ({ busy, turns }) => useTranscriptScroll({
        latestTurnId: 'turn-0',
        renderedTurns: turns,
        isBusy: () => busy,
      }),
      {
        initialProps: {
          busy: true,
          turns: [] as RenderedChatTurn[],
        },
      },
    );
    const scroll = document.createElement('div');
    const transcript = document.createElement('div');
    const active = document.createElement('section');
    active.dataset.turnId = 'turn-0';
    const bubble = document.createElement('div');
    bubble.className = 'user-bubble';
    active.append(bubble);
    scroll.append(active);
    elementGeometry(scroll, { scrollHeight: 500, clientHeight: 200 });
    elementGeometry(transcript, { scrollHeight: 500, clientHeight: 500 });
    scroll.scrollTo = vi.fn();
    act(() => {
      result.current.scrollRef.current = scroll;
      result.current.transcriptRef.current = transcript;
    });

    rerender({ busy: true, turns: activeTurns });
    await act(async () => Promise.resolve());
    vi.mocked(scroll.scrollTo).mockClear();

    rerender({ busy: false, turns: activeTurns });
    rerender({ busy: true, turns: activeTurns });
    await act(async () => Promise.resolve());
    expect(scroll.scrollTo).toHaveBeenCalled();

    vi.mocked(scroll.scrollTo).mockClear();
    rerender({ busy: false, turns: activeTurns });
    act(() => result.current.releaseTurnScroll());
    rerender({ busy: true, turns: activeTurns });
    await act(async () => Promise.resolve());
    expect(scroll.scrollTo).not.toHaveBeenCalled();
  });

  it('waits for a new turn before taking scroll ownership after send', async () => {
    const initialTurns = [turn()];
    const { result, rerender } = renderHook(
      ({ latestTurnId, turns }) => useTranscriptScroll({
        latestTurnId,
        renderedTurns: turns,
        isBusy: () => false,
      }),
      {
        initialProps: {
          latestTurnId: 'turn-0' as string,
          turns: [] as RenderedChatTurn[],
        },
      },
    );
    const scroll = document.createElement('div');
    const transcript = document.createElement('div');
    const firstTurn = document.createElement('section');
    firstTurn.dataset.turnId = 'turn-0';
    const firstBubble = document.createElement('div');
    firstBubble.className = 'user-bubble';
    firstTurn.append(firstBubble);
    scroll.append(firstTurn);
    elementGeometry(scroll, { scrollHeight: 500, clientHeight: 200, scrollTop: 120 });
    elementGeometry(transcript, { scrollHeight: 500, clientHeight: 500 });
    scroll.scrollTo = vi.fn();
    act(() => {
      result.current.scrollRef.current = scroll;
      result.current.transcriptRef.current = transcript;
    });
    rerender({ latestTurnId: 'turn-0', turns: initialTurns });
    await act(async () => Promise.resolve());
    vi.mocked(scroll.scrollTo).mockClear();

    const syncAfterSend = result.current.createTurnScrollCallback();
    act(() => syncAfterSend());
    await act(async () => Promise.resolve());
    expect(scroll.scrollTo).not.toHaveBeenCalled();

    const secondTurn = document.createElement('section');
    secondTurn.dataset.turnId = 'turn-1';
    const secondBubble = document.createElement('div');
    secondBubble.className = 'user-bubble';
    secondTurn.append(secondBubble);
    scroll.append(secondTurn);
    rerender({ latestTurnId: 'turn-1', turns: [...initialTurns, turn('turn-1')] });
    act(() => syncAfterSend());
    await act(async () => Promise.resolve());
    expect(scroll.scrollTo).toHaveBeenCalled();
  });

  it('resumes following with ArrowDown only while sending and outside inputs', async () => {
    let sending = true;
    const { result } = renderHook(() => useTranscriptScroll({ latestTurnId: 'turn-0', renderedTurns: [turn()], isBusy: () => sending }));
    const scroll = document.createElement('div');
    const active = document.createElement('section');
    active.dataset.turnId = 'turn-0';
    const row = document.createElement('div');
    row.className = 'chat-turn-agent-row';
    active.append(row);
    scroll.append(active);
    elementGeometry(scroll, { scrollHeight: 500, clientHeight: 200 });
    scroll.scrollTo = vi.fn();
    act(() => { result.current.scrollRef.current = scroll; result.current.releaseTurnScroll(); });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
    await act(async () => Promise.resolve());
    expect(scroll.scrollTo).toHaveBeenCalled();
    vi.mocked(scroll.scrollTo).mockClear();
    sending = false;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    await act(async () => Promise.resolve());
    expect(scroll.scrollTo).not.toHaveBeenCalled();
  });

  it('disconnects every observer and cancels pending work on unmount', () => {
    const { unmount } = renderHook(() => useTranscriptScroll({ latestTurnId: 'turn-0', renderedTurns: [turn()], isBusy: () => false }));
    unmount();
    expect(observers.every((observer) => observer.disconnect.mock.calls.length > 0)).toBe(true);
  });
});
