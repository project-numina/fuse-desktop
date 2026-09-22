import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useHistoryMode } from '@/features/blueprint/components/use-history-mode';
import type { SessionHistorySummary } from '@/features/blueprint/components/history-mode-model';

const api = vi.hoisted(() => ({
  fetchSessionHistory: vi.fn(),
  fetchNativeHistoryStatus: vi.fn(),
  deleteSessionHistory: vi.fn(),
  refreshSessionAttention: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  fetchSessionHistory: api.fetchSessionHistory,
  fetchNativeHistoryStatus: api.fetchNativeHistoryStatus,
  deleteSessionHistory: api.deleteSessionHistory,
}));
vi.mock('@/hooks/use-session-attention', () => ({ refreshSessionAttention: api.refreshSessionAttention }));

const entry: SessionHistorySummary = {
  id: 's1', title: 'Session', status: 'completed', tier: 'completed', blueprint_name: 'bp',
  created_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T00:01:00Z',
  first_message: 'hello', last_message: 'done', last_message_at: '2026-01-01T00:01:00Z',
};

describe('useHistoryMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchSessionHistory.mockResolvedValue([entry]);
    api.fetchNativeHistoryStatus.mockResolvedValue({ warnings: [] });
    api.deleteSessionHistory.mockResolvedValue(undefined);
  });

  it('loads the first page and exposes selection safely', async () => {
    const onSelectSession = vi.fn();
    const { result } = renderHook(() => useHistoryMode({ owner: 'o', repo: 'r', blueprintId: 'bp', onSelectSession }));
    await waitFor(() => expect(result.current.sessions).toEqual([entry]));
    expect(api.fetchSessionHistory).toHaveBeenCalledWith('o', 'r', 'bp', 20, 0, true);
    await act(async () => result.current.selectSession(entry));
    expect(onSelectSession).toHaveBeenCalledWith('s1');
  });

  it('deletes locally and resets the active chat', async () => {
    const onNewChat = vi.fn();
    const { result } = renderHook(() => useHistoryMode({ owner: 'o', repo: 'r', blueprintId: 'bp', activeSessionId: 's1', onNewChat }));
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    await act(async () => result.current.deleteSession('s1'));
    expect(api.deleteSessionHistory).toHaveBeenCalledWith('s1');
    expect(result.current.sessions).toEqual([]);
    expect(onNewChat).toHaveBeenCalledOnce();
  });
});
