import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTranscriptScrollMachine } from '@/features/chat/hooks/transcript-scroll/machine';
import {
  disconnectTranscriptObservers,
  useTranscriptScrollObservers,
} from '@/features/chat/hooks/transcript-scroll/use-observers';

interface ObserverDouble {
  callback: ResizeObserverCallback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

const observers: ObserverDouble[] = [];

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(public callback: ResizeObserverCallback) {
      observers.push(this);
    }
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('useTranscriptScrollObservers', () => {
  it('observes the active turn and container and forwards owned resizes', async () => {
    const requestTurnSync = vi.fn();
    const { result } = renderHook(() => {
      const machine = useTranscriptScrollMachine('turn-1', () => true);
      return {
        machine,
        observers: useTranscriptScrollObservers(machine, requestTurnSync),
      };
    });
    const container = document.createElement('div');
    const turn = document.createElement('section');
    turn.dataset.turnId = 'turn-1';
    container.append(turn);
    result.current.machine.scrollRef.current = container;
    result.current.machine.autoFollow.current = true;
    result.current.machine.ownership.current = 'owned';

    act(() => {
      result.current.observers.connectActiveTurnObserver();
      result.current.observers.connectContainerObserver();
    });
    await act(async () => Promise.resolve());
    for (const observer of observers) {
      observer.callback([], observer as unknown as ResizeObserver);
    }

    expect(observers.some(({ observe }) => observe.mock.calls[0]?.[0] === turn)).toBe(true);
    expect(observers.some(({ observe }) => observe.mock.calls[0]?.[0] === container)).toBe(true);
    expect(requestTurnSync).toHaveBeenCalledWith('auto');

    disconnectTranscriptObservers(result.current.machine);
    expect(observers.every(({ disconnect }) => disconnect.mock.calls.length > 0)).toBe(true);
  });
});
