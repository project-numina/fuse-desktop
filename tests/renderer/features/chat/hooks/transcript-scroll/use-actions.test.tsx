import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useTranscriptScrollMachine } from '@/features/chat/hooks/transcript-scroll/machine';
import { useTranscriptScrollActions } from '@/features/chat/hooks/transcript-scroll/use-actions';

describe('useTranscriptScrollActions', () => {
  it('releases manual scrolling and resumes with smooth ownership', () => {
    const requestTurnSync = vi.fn();
    const updateIndicator = vi.fn();
    const { result } = renderHook(() => {
      const machine = useTranscriptScrollMachine('turn-1', () => true);
      return {
        machine,
        actions: useTranscriptScrollActions(machine, requestTurnSync, updateIndicator),
      };
    });
    const scroll = document.createElement('div');
    Object.defineProperties(scroll, {
      scrollHeight: { configurable: true, value: 600 },
      clientHeight: { configurable: true, value: 200 },
    });
    scroll.scrollTo = vi.fn();
    result.current.machine.scrollRef.current = scroll;

    act(() => result.current.actions.resumeTurnScroll());
    expect(result.current.machine.ownership.current).toBe('owned');
    expect(requestTurnSync).toHaveBeenCalledWith('smooth');

    act(() => result.current.actions.scrollDownOnePane());
    expect(result.current.machine.ownership.current).toBe('released');
    expect(scroll.scrollTo).toHaveBeenCalledWith({ top: 400, behavior: 'smooth' });
    expect(updateIndicator).toHaveBeenCalled();
  });

  it('waits for a new turn before post-send following begins', async () => {
    const requestTurnSync = vi.fn();
    const updateIndicator = vi.fn();
    const { result } = renderHook(() => {
      const machine = useTranscriptScrollMachine('turn-1', () => true);
      return {
        machine,
        actions: useTranscriptScrollActions(machine, requestTurnSync, updateIndicator),
      };
    });
    result.current.machine.mounted.current = true;
    const syncAfterSend = result.current.actions.createTurnScrollCallback();

    act(() => syncAfterSend());
    await act(async () => Promise.resolve());
    expect(requestTurnSync).not.toHaveBeenCalled();
    expect(updateIndicator).toHaveBeenCalledOnce();

    result.current.machine.latestTurnId.current = 'turn-2';
    act(() => syncAfterSend());
    await act(async () => Promise.resolve());
    expect(requestTurnSync).toHaveBeenCalledWith('smooth');
  });
});
