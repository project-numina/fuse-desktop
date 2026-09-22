import { act, renderHook } from '@testing-library/react';
import type { SessionAttention } from '@shared/session-attention';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  notifyHistoryChanged: vi.fn(),
}));

vi.mock('@/lib/api/core', () => ({ request: mocks.request }));
vi.mock('@/lib/session-events', () => ({
  notifySessionHistoryChanged: mocks.notifyHistoryChanged,
}));

let attentionModule: typeof import('@/hooks/use-session-attention');

function entry(overrides: Partial<SessionAttention> = {}): SessionAttention {
  return {
    id: 'session-1',
    owner: 'numina',
    repository: 'math',
    blueprint: 'froda',
    revision: 'response-1',
    unread: true,
    state: 'idle',
    ...overrides,
  };
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(async () => {
  vi.useFakeTimers();
  mocks.request.mockReset().mockResolvedValue([]);
  mocks.notifyHistoryChanged.mockReset();
  vi.resetModules();
  attentionModule = await import('@/hooks/use-session-attention');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useSessionAttention', () => {
  it('loads attention on subscription and polls for state changes', async () => {
    const first = entry();
    const second = entry({ state: 'needs_input', revision: 'response-2' });
    mocks.request
      .mockResolvedValueOnce([first])
      .mockResolvedValueOnce([second]);

    const { result, unmount } = renderHook(() => attentionModule.useSessionAttention());
    await flushPromises();
    expect(result.current).toEqual([first]);
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith('/sessions/attention');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current).toEqual([second]);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('shares one timer across subscribers and stops only after the last cleanup', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const first = renderHook(() => attentionModule.useSessionAttention());
    const second = renderHook(() => attentionModule.useSessionAttention());
    await flushPromises();

    expect(setIntervalSpy).toHaveBeenCalledOnce();
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);

    first.unmount();
    expect(clearIntervalSpy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);

    second.unmount();
    expect(clearIntervalSpy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('deduplicates an in-flight refresh', async () => {
    let resolve!: (value: SessionAttention[]) => void;
    mocks.request.mockImplementation(() => new Promise<SessionAttention[]>((done) => {
      resolve = done;
    }));

    const first = attentionModule.refreshSessionAttention();
    const second = attentionModule.refreshSessionAttention();

    expect(second).toBe(first);
    expect(mocks.request).toHaveBeenCalledOnce();
    resolve([entry()]);
    await first;
  });

  it('ignores a stale response after the final subscriber unmounts', async () => {
    let resolve!: (value: SessionAttention[]) => void;
    mocks.request.mockImplementationOnce(() => new Promise<SessionAttention[]>((done) => {
      resolve = done;
    }));
    const first = renderHook(() => attentionModule.useSessionAttention());
    expect(first.result.current).toEqual([]);
    first.unmount();

    await act(async () => resolve([entry()]));

    mocks.request.mockResolvedValueOnce([]);
    const second = renderHook(() => attentionModule.useSessionAttention());
    expect(second.result.current).toEqual([]);
    await flushPromises();
    expect(second.result.current).toEqual([]);
    second.unmount();
  });

  it('preserves the last valid snapshot for malformed and failed refreshes', async () => {
    const valid = entry();
    mocks.request.mockResolvedValueOnce([valid]);
    const { result, unmount } = renderHook(() => attentionModule.useSessionAttention());
    await flushPromises();
    expect(result.current).toEqual([valid]);

    mocks.request.mockResolvedValueOnce({ unexpected: true });
    await act(async () => attentionModule.refreshSessionAttention());
    expect(result.current).toEqual([valid]);

    mocks.request.mockRejectedValueOnce(new Error('offline'));
    await expect(attentionModule.refreshSessionAttention()).resolves.toBeUndefined();
    expect(result.current).toEqual([valid]);
    unmount();
  });

  it('marks only the matching revision seen and notifies history listeners', async () => {
    const matching = entry();
    const newer = entry({ revision: 'response-2' });
    const other = entry({ id: 'other', revision: 'response-1' });
    mocks.request.mockResolvedValueOnce([matching, newer, other]);
    const { result, unmount } = renderHook(() => attentionModule.useSessionAttention());
    await flushPromises();

    mocks.request.mockResolvedValueOnce({ ok: true });
    await act(async () => attentionModule.markSessionSeen('session/1', 'response-1'));

    expect(mocks.request).toHaveBeenLastCalledWith(
      '/sessions/history/session%2F1/seen',
      { method: 'POST', body: JSON.stringify({ revision: 'response-1' }) },
    );
    // The encoded request id intentionally differs from the stored id, so no
    // local entry should be altered by this first call.
    expect(result.current.every(item => item.unread)).toBe(true);
    expect(mocks.notifyHistoryChanged).toHaveBeenLastCalledWith('session/1');

    mocks.request.mockResolvedValueOnce({ ok: true });
    await act(async () => attentionModule.markSessionSeen('session-1', 'response-1'));
    expect(result.current).toEqual([
      { ...matching, unread: false },
      newer,
      other,
    ]);
    expect(mocks.notifyHistoryChanged).toHaveBeenLastCalledWith('session-1');
    unmount();
  });

  it('does not mutate or notify when marking a session fails', async () => {
    const valid = entry();
    mocks.request.mockResolvedValueOnce([valid]);
    const { result, unmount } = renderHook(() => attentionModule.useSessionAttention());
    await flushPromises();

    mocks.request.mockRejectedValueOnce(new Error('write failed'));
    await expect(attentionModule.markSessionSeen(valid.id, valid.revision)).rejects.toThrow(
      'write failed',
    );
    expect(result.current).toEqual([valid]);
    expect(mocks.notifyHistoryChanged).not.toHaveBeenCalled();
    unmount();
  });
});
