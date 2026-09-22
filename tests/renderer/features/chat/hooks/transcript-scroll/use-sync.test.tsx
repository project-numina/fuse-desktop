import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useTranscriptScrollMachine } from '@/features/chat/hooks/transcript-scroll/machine';
import { useTranscriptScrollSync } from '@/features/chat/hooks/transcript-scroll/use-sync';

afterEach(() => vi.restoreAllMocks());

describe('useTranscriptScrollSync', () => {
  it('defers alignment, updates the spacer, then releases one-shot ownership', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(performance.now());
      return null as unknown as number;
    });
    const setVisible = vi.fn();
    const { result } = renderHook(() => {
      const machine = useTranscriptScrollMachine('turn-1', () => false);
      return { machine, sync: useTranscriptScrollSync(machine, setVisible) };
    });
    const scroll = document.createElement('div');
    const transcript = document.createElement('div');
    const turn = document.createElement('section');
    const bubble = document.createElement('div');
    turn.dataset.turnId = 'turn-1';
    bubble.className = 'user-bubble';
    turn.append(bubble);
    scroll.append(turn);
    Object.defineProperties(scroll, {
      scrollHeight: { configurable: true, value: 500 },
      clientHeight: { configurable: true, value: 200 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 100 });
    Object.defineProperty(bubble, 'offsetTop', { configurable: true, value: 104 });
    Object.defineProperty(bubble, 'offsetParent', { configurable: true, value: scroll });
    scroll.scrollTo = vi.fn();
    result.current.machine.scrollRef.current = scroll;
    result.current.machine.transcriptRef.current = transcript;
    result.current.machine.mounted.current = true;

    act(() => result.current.sync.alignLatestTurnToTop('auto', false));
    await act(async () => Promise.resolve());

    expect(transcript.style.paddingBottom).toBe('calc(var(--space-8) + 200px)');
    expect(scroll.scrollTo).toHaveBeenCalledWith({ top: 100, behavior: 'auto' });
    expect(result.current.machine.ownership.current).toBe('released');
  });

  it('ignores queued synchronization after unmount', async () => {
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame');
    const { result } = renderHook(() => {
      const machine = useTranscriptScrollMachine(null, () => false);
      return { machine, sync: useTranscriptScrollSync(machine, vi.fn()) };
    });

    act(() => result.current.sync.requestTurnSync('smooth'));
    await act(async () => Promise.resolve());

    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});
