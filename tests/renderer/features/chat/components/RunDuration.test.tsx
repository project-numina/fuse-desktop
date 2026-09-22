import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RunDuration from '@/features/chat/components/RunDuration';

const START = Date.UTC(2026, 7, 31, 12, 0, 0);

describe('RunDuration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows nothing for a run whose start was never recorded', () => {
    const { container, unmount } = render(<RunDuration running />);
    expect(container).toBeEmptyDOMElement();
    unmount();
  });

  it('shows nothing for a settled run with no recorded end', () => {
    const { container, unmount } = render(
      <RunDuration startedAt={START - 60_000} running={false} />,
    );
    expect(container).toBeEmptyDOMElement();
    unmount();
  });

  it('reports a finished run without starting a clock for it', () => {
    const { unmount } = render(
      <RunDuration
        startedAt={START - 134_000}
        endedAt={START}
        running={false}
      />,
    );

    expect(screen.getByText('2m 14s')).toHaveClass('run-duration');
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });

  it('counts a running agent up without any user action', () => {
    const { unmount } = render(<RunDuration startedAt={START} running />);

    expect(screen.getByText('0s')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(45_000);
    });
    expect(screen.getByText('45s')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText('1m 15s')).toBeInTheDocument();
    unmount();
  });

  it('drives every running card in the transcript from one timer', () => {
    const { unmount } = render(
      <>
        <RunDuration startedAt={START} running />
        <RunDuration startedAt={START - 1_000} running />
        <RunDuration startedAt={START - 2_000} running />
      </>,
    );

    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText('1s')).toBeInTheDocument();
    expect(screen.getByText('2s')).toBeInTheDocument();
    expect(screen.getByText('3s')).toBeInTheDocument();
    unmount();
  });

  it('stops ticking once the last running agent settles', () => {
    const { rerender, unmount } = render(
      <>
        <RunDuration startedAt={START} running />
        <RunDuration startedAt={START} running />
      </>,
    );
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    rerender(
      <>
        <RunDuration startedAt={START} endedAt={START + 10_000} running={false} />
        <RunDuration startedAt={START} running />
      </>,
    );
    expect(vi.getTimerCount()).toBe(1);

    rerender(
      <>
        <RunDuration startedAt={START} endedAt={START + 10_000} running={false} />
        <RunDuration startedAt={START} endedAt={START + 10_000} running={false} />
      </>,
    );
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.getAllByText('10s')).toHaveLength(2);
    unmount();
  });

  it('stops ticking when the running cards leave the transcript', () => {
    const { unmount } = render(<RunDuration startedAt={START} running />);
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('measures from now, not from a reading left over by an idle clock', () => {
    const first = render(<RunDuration startedAt={START} running />);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    first.unmount();
    // Nothing ran for an hour; the stored reading is now an hour stale.
    act(() => {
      vi.advanceTimersByTime(3_600_000);
    });

    const restarted = render(
      <RunDuration startedAt={Date.now() - 7_000} running />,
    );
    expect(screen.getByText('7s')).toBeInTheDocument();
    restarted.unmount();
  });
});
