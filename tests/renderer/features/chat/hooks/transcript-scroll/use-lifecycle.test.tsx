import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTranscriptScrollMachine } from '@/features/chat/hooks/transcript-scroll/machine';
import { useTranscriptScrollMount } from '@/features/chat/hooks/transcript-scroll/use-lifecycle';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn();
    disconnect = vi.fn();
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('useTranscriptScrollMount', () => {
  it('resumes on ArrowDown while busy, except from an editable target', () => {
    const updateIndicator = vi.fn();
    const resume = vi.fn();
    const { result } = renderHook(() => {
      const machine = useTranscriptScrollMachine(null, () => true);
      useTranscriptScrollMount(machine, updateIndicator, resume);
      return machine;
    });
    const input = document.createElement('input');

    act(() => input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    })));
    const windowEvent = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
    act(() => window.dispatchEvent(windowEvent));

    expect(updateIndicator).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledOnce();
    expect(windowEvent.defaultPrevented).toBe(true);
    expect(result.current.mounted.current).toBe(true);
  });

  it('cancels pending animation work and marks the machine unmounted', () => {
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const { result, unmount } = renderHook(() => {
      const machine = useTranscriptScrollMachine(null, () => false);
      useTranscriptScrollMount(machine, vi.fn(), vi.fn());
      return machine;
    });
    result.current.scrollRaf.current = 42;

    unmount();

    expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
    expect(result.current.mounted.current).toBe(false);
  });
});
