import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  getActiveTurnTarget,
  releaseScrollOwnership,
  setScrollTop,
  setTranscriptSlack,
  startScrollOwnership,
  updateMoreBelow,
  useTranscriptScrollMachine,
} from '@/features/chat/hooks/transcript-scroll/machine';

function geometry(
  element: HTMLElement,
  values: { scrollHeight: number; clientHeight: number; scrollTop?: number },
): void {
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: values.scrollHeight },
    clientHeight: { configurable: true, value: values.clientHeight },
    scrollTop: { configurable: true, writable: true, value: values.scrollTop ?? 0 },
  });
}

describe('transcript scroll machine', () => {
  it('keeps one machine while refreshing reactive inputs', () => {
    const firstBusy = () => false;
    const secondBusy = () => true;
    const { result, rerender } = renderHook(
      ({ id, busy }) => useTranscriptScrollMachine(id, busy),
      { initialProps: { id: 'first' as string | null, busy: firstBusy } },
    );
    const machine = result.current;

    rerender({ id: 'second', busy: secondBusy });

    expect(result.current).toBe(machine);
    expect(machine.latestTurnId.current).toBe('second');
    expect(machine.isBusy.current()).toBe(true);
  });

  it('bounds scrolling and resolves the latest turn anchor', () => {
    const { result } = renderHook(() => useTranscriptScrollMachine('turn-1', () => false));
    const container = document.createElement('div');
    const turn = document.createElement('section');
    const bubble = document.createElement('div');
    turn.dataset.turnId = 'turn-1';
    bubble.className = 'user-bubble';
    turn.append(bubble);
    container.append(turn);
    geometry(container, { scrollHeight: 600, clientHeight: 200 });
    Object.defineProperty(bubble, 'offsetTop', { configurable: true, value: 84 });
    Object.defineProperty(bubble, 'offsetParent', { configurable: true, value: container });
    container.scrollTo = vi.fn();

    expect(getActiveTurnTarget(result.current, container)).toBe(80);
    setScrollTop(container, 900, 'smooth');
    expect(container.scrollTo).toHaveBeenCalledWith({ top: 400, behavior: 'smooth' });
  });

  it('tracks slack, visibility, and explicit ownership changes', () => {
    const { result } = renderHook(() => useTranscriptScrollMachine(null, () => false));
    const machine = result.current;
    const scroll = document.createElement('div');
    const transcript = document.createElement('div');
    const setVisible = vi.fn();
    geometry(scroll, { scrollHeight: 500, clientHeight: 200, scrollTop: 100 });
    machine.scrollRef.current = scroll;
    machine.transcriptRef.current = transcript;

    expect(setTranscriptSlack(machine, 20.2)).toBe(true);
    expect(transcript.style.paddingBottom).toBe('calc(var(--space-8) + 21px)');
    updateMoreBelow(machine, setVisible);
    expect(setVisible).toHaveBeenLastCalledWith(true);

    startScrollOwnership(machine, 123);
    expect(machine.ownership.current).toBe('owned');
    releaseScrollOwnership(machine);
    expect(machine.ownership.current).toBe('released');
    expect(machine.autoFollow.current).toBe(false);
  });
});
