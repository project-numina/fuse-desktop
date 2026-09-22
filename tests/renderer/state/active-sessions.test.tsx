import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ fetchActiveSessions: vi.fn(), cancelSession: vi.fn() }));
vi.mock('@/lib/api', () => ({ ...api, ApiError: class ApiError extends Error { constructor(message: string, public status: number) { super(message); } } }));
import { resetActiveSessionsState, useActiveSessions } from '@/state/active-sessions';

const session = { session_id: 's1', conversation_id: null, agent_job_id: null, repository_owner: 'o', repository_name: 'r', blueprint_name: null, workspace_label: 'o/r', status: 'running' as const, execution_mode: 'foreground' as const, turn_active: true, created_at: '', can_send: false, can_cancel: true, display_status: 'Running' };

describe('active-sessions state', () => {
  beforeEach(() => { vi.clearAllMocks(); resetActiveSessionsState(); });
  it('refreshes sessions, counts, and reason', async () => {
    api.fetchActiveSessions.mockResolvedValue({ sessions: [session], active_count: 1, max_active_sessions: 3 });
    const { result } = renderHook(() => useActiveSessions());
    act(() => result.current.setReason('cap_hit'));
    await act(() => result.current.refresh());
    expect(result.current.state).toMatchObject({ sessions: [session], activeCount: 1, maxActive: 3, reason: 'cap_hit', loading: false });
  });

  it('marks cancellation pending and refreshes after success', async () => {
    api.fetchActiveSessions.mockResolvedValueOnce({ sessions: [session], active_count: 1, max_active_sessions: 3 }).mockResolvedValueOnce({ sessions: [], active_count: 0, max_active_sessions: 3 });
    api.cancelSession.mockResolvedValue({ status: 'ok' });
    const { result } = renderHook(() => useActiveSessions());
    await act(() => result.current.refresh());
    await act(() => result.current.cancelOne('s1'));
    expect(api.cancelSession).toHaveBeenCalledWith('s1');
    expect(result.current.state.cancelRequestedIds.size).toBe(0);
    expect(result.current.state.sessions).toEqual([]);
  });

  it('rolls cancellation state back on failure', async () => {
    api.cancelSession.mockRejectedValue(new Error('cannot cancel'));
    const { result } = renderHook(() => useActiveSessions());
    await act(() => result.current.cancelOne('s1'));
    expect(result.current.state.error).toBe('cannot cancel');
    expect(result.current.state.cancelRequestedIds.has('s1')).toBe(false);
  });
});
