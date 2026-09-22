import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchRepositories: vi.fn(),
  fetchRepositoryActivity: vi.fn(),
  fetchRepositoryBackgroundSessions: vi.fn(),
}));
vi.mock('@/lib/api', () => api);
import { getDashboardRepository, resetDashboardState, useDashboard } from '@/state/dashboard';

const repo = (id: number, weekly_commits: number[] = []) => ({
  id, owner: 'numina', name: `repo-${id}`, visibility: 'private', weekly_commits, background_sessions: [],
});

describe('dashboard state', () => {
  beforeEach(() => { vi.clearAllMocks(); resetDashboardState(); });

  it('loads repositories and exposes errors without throwing', async () => {
    api.fetchRepositories.mockResolvedValue({ repositories: [repo(1)] });
    const { result } = renderHook(() => useDashboard());
    await act(() => result.current.load());
    expect(result.current.state).toMatchObject({ repositories: [repo(1)], loading: false, error: null });
    expect(getDashboardRepository('NUMINA', 'REPO-1')).toEqual({
      id: 1,
      owner: 'numina',
      name: 'repo-1',
      description: undefined,
      updated_at: undefined,
      visibility: 'private',
    });
    expect(getDashboardRepository('numina', 'missing')).toBeNull();

    act(() => resetDashboardState());
    api.fetchRepositories.mockRejectedValue(new Error('offline'));
    await act(() => result.current.load());
    expect(result.current.state).toMatchObject({ loading: false, error: 'offline' });
  });

  it('fails closed on a malformed repository-list payload', async () => {
    api.fetchRepositories.mockResolvedValue({ repositories: null });
    const { result } = renderHook(() => useDashboard());

    await act(() => result.current.load());

    expect(result.current.state).toMatchObject({
      repositories: [],
      loading: false,
      error: 'Invalid repository list response.',
    });
  });

  it('deduplicates concurrent loads and merges background activity by id', async () => {
    let resolve!: (value: unknown) => void;
    api.fetchRepositories.mockReturnValue(new Promise((done) => { resolve = done; }));
    const { result } = renderHook(() => useDashboard());
    let first!: Promise<void>; let second!: Promise<void>;
    act(() => { first = result.current.load(); second = result.current.load(); });
    expect(first).toBe(second);
    await act(async () => { resolve({ repositories: [repo(1), repo(2)] }); await first; });
    api.fetchRepositoryActivity.mockResolvedValue([repo(1, [3, 2])]);
    act(() => result.current.loadActivityInBackground());
    await waitFor(() => expect(result.current.state.repositories[0].weekly_commits).toEqual([3, 2]));
    expect(result.current.state.repositories[1].weekly_commits).toEqual([]);
  });

  it('reuses a loaded repository list across dashboard remounts', async () => {
    api.fetchRepositories.mockResolvedValue({ repositories: [repo(1)] });
    const { result } = renderHook(() => useDashboard());

    await act(() => result.current.load());
    await act(() => result.current.load());

    expect(api.fetchRepositories).toHaveBeenCalledTimes(1);
  });

  it('refreshes stale repositories without hiding cached list decorations', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T12:00:00Z'));
    api.fetchRepositories.mockResolvedValueOnce({ repositories: [repo(1, [4, 2])] });
    const { result } = renderHook(() => useDashboard());
    try {
      await act(() => result.current.load());
      vi.advanceTimersByTime(30_001);
      let resolveRefresh!: (value: unknown) => void;
      api.fetchRepositories.mockReturnValueOnce(new Promise((done) => {
        resolveRefresh = done;
      }));

      let refresh!: Promise<void>;
      act(() => { refresh = result.current.load(); });
      expect(result.current.state).toMatchObject({
        repositories: [repo(1, [4, 2])],
        loading: false,
      });
      await act(async () => {
        resolveRefresh({ repositories: [repo(2)] });
        await refresh;
      });
      expect(result.current.state.repositories).toEqual([repo(2)]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves activity when a stale list refresh returns the same repository', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T12:00:00Z'));
    api.fetchRepositories
      .mockResolvedValueOnce({ repositories: [repo(1, [4, 2])] })
      .mockResolvedValueOnce({ repositories: [repo(1)] });
    const { result } = renderHook(() => useDashboard());
    try {
      await act(() => result.current.load());
      vi.advanceTimersByTime(30_001);

      await act(() => result.current.load());

      expect(result.current.state.repositories[0].weekly_commits).toEqual([4, 2]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('can force a repository refresh inside the freshness window', async () => {
    api.fetchRepositories
      .mockResolvedValueOnce({ repositories: [repo(1)] })
      .mockResolvedValueOnce({ repositories: [repo(1), repo(2)] });
    const { result } = renderHook(() => useDashboard());

    await act(() => result.current.load());
    await act(() => result.current.load({ force: true }));

    expect(api.fetchRepositories).toHaveBeenCalledTimes(2);
    expect(result.current.state.repositories.map(({ id }) => id)).toEqual([1, 2]);
  });

  it('queues a forced refresh behind an in-flight repository load', async () => {
    let resolveInitial!: (value: unknown) => void;
    api.fetchRepositories
      .mockReturnValueOnce(new Promise((done) => { resolveInitial = done; }))
      .mockResolvedValueOnce({ repositories: [repo(1), repo(2)] });
    const { result } = renderHook(() => useDashboard());
    let initial!: Promise<void>;
    let forced!: Promise<void>;

    act(() => {
      initial = result.current.load();
      forced = result.current.load({ force: true });
    });
    expect(api.fetchRepositories).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveInitial({ repositories: [repo(1)] });
      await initial;
      await forced;
    });

    expect(api.fetchRepositories).toHaveBeenCalledTimes(2);
    expect(result.current.state.repositories.map(({ id }) => id)).toEqual([1, 2]);
  });

  it('ignores a stale load after reset', async () => {
    let resolve!: (value: unknown) => void;
    api.fetchRepositories.mockReturnValue(new Promise((done) => { resolve = done; }));
    const { result } = renderHook(() => useDashboard());
    let pending!: Promise<void>;
    act(() => { pending = result.current.load(); resetDashboardState(); });
    await act(async () => { resolve({ repositories: [repo(9)] }); await pending; });
    expect(result.current.state.repositories).toEqual([]);
  });

  it('ignores stale activity after the user-scoped store resets', async () => {
    api.fetchRepositories.mockResolvedValue({ repositories: [repo(1)] });
    let resolveActivity!: (value: unknown) => void;
    api.fetchRepositoryActivity.mockReturnValue(new Promise((done) => {
      resolveActivity = done;
    }));
    const { result } = renderHook(() => useDashboard());
    await act(() => result.current.load());

    act(() => {
      result.current.loadActivityInBackground();
      resetDashboardState();
    });
    await act(async () => {
      resolveActivity([repo(1, [9, 9])]);
      await Promise.resolve();
    });

    expect(result.current.state.repositories).toEqual([]);
    expect(api.fetchRepositoryActivity).toHaveBeenCalledTimes(1);
  });

  it('ignores malformed activity instead of corrupting repository state', async () => {
    api.fetchRepositories.mockResolvedValue({ repositories: [repo(1)] });
    api.fetchRepositoryActivity.mockResolvedValue([{
      ...repo(1),
      weekly_commits: ['not-a-number'],
    }]);
    const { result } = renderHook(() => useDashboard());
    await act(() => result.current.load());

    act(() => result.current.loadActivityInBackground());
    await act(() => Promise.resolve());

    expect(result.current.state.repositories[0].weekly_commits).toEqual([]);
  });

  it('does not repeat repository activity enumeration after it succeeds', async () => {
    api.fetchRepositories.mockResolvedValue({ repositories: [repo(1)] });
    api.fetchRepositoryActivity.mockResolvedValue([repo(1, [3, 2])]);
    const { result } = renderHook(() => useDashboard());
    await act(() => result.current.load());

    act(() => result.current.loadActivityInBackground());
    await waitFor(() => expect(result.current.state.repositories[0].weekly_commits).toEqual([3, 2]));
    act(() => result.current.loadActivityInBackground());

    expect(api.fetchRepositoryActivity).toHaveBeenCalledTimes(1);
  });

  it('allows activity to refresh after the repository list refreshes', async () => {
    const initialTime = new Date('2026-09-08T12:00:00Z').getTime();
    const now = vi.spyOn(Date, 'now').mockReturnValue(initialTime);
    api.fetchRepositories.mockResolvedValue({ repositories: [repo(1)] });
    api.fetchRepositoryActivity
      .mockResolvedValueOnce([repo(1, [3, 2])])
      .mockResolvedValueOnce([repo(1, [5, 4])]);
    const { result } = renderHook(() => useDashboard());
    try {
      await act(() => result.current.load());
      act(() => result.current.loadActivityInBackground());
      await waitFor(() => expect(result.current.state.repositories[0].weekly_commits).toEqual([3, 2]));
      now.mockReturnValue(initialTime + 30_001);

      await act(() => result.current.load());
      act(() => result.current.loadActivityInBackground());
      await waitFor(() => expect(result.current.state.repositories[0].weekly_commits).toEqual([5, 4]));

      expect(api.fetchRepositoryActivity).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });

  it.each(['resolve', 'reject'] as const)(
    'refreshes activity for a newer repository list after the old request settles (%s)',
    async (outcome) => {
      let resolveActivity!: (value: unknown) => void;
      let rejectActivity!: (reason: Error) => void;
      api.fetchRepositories
        .mockResolvedValueOnce({ repositories: [repo(1)] })
        .mockResolvedValueOnce({ repositories: [repo(1), repo(2)] });
      api.fetchRepositoryActivity
        .mockReturnValueOnce(new Promise((resolve, reject) => {
          resolveActivity = resolve;
          rejectActivity = reject;
        }))
        .mockResolvedValueOnce([repo(1, [5, 4]), repo(2, [6, 2])]);
      const { result } = renderHook(() => useDashboard());
      await act(() => result.current.load());
      act(() => result.current.loadActivityInBackground());

      await act(() => result.current.load({ force: true }));
      act(() => result.current.loadActivityInBackground());
      expect(api.fetchRepositoryActivity).toHaveBeenCalledTimes(1);
      await act(async () => {
        if (outcome === 'resolve') resolveActivity([repo(1, [3, 2])]);
        else rejectActivity(new Error('Temporary activity failure'));
      });

      await waitFor(() => {
        expect(result.current.state.repositories).toEqual([repo(1, [5, 4]), repo(2, [6, 2])]);
      });
      act(() => result.current.loadActivityInBackground());
      expect(api.fetchRepositoryActivity).toHaveBeenCalledTimes(2);
    },
  );

  it('reloads activity after the initial repository request recovers', async () => {
    api.fetchRepositories
      .mockRejectedValueOnce(new Error('Temporary repository failure'))
      .mockResolvedValueOnce({ repositories: [repo(1)] });
    api.fetchRepositoryActivity
      .mockResolvedValueOnce([repo(1, [3, 2])])
      .mockResolvedValueOnce([repo(1, [5, 4])]);
    const { result } = renderHook(() => useDashboard());
    await act(() => result.current.load());
    await act(async () => result.current.loadActivityInBackground());
    expect(result.current.state.repositories).toEqual([]);

    await act(() => result.current.load());
    act(() => result.current.loadActivityInBackground());

    await waitFor(() => expect(result.current.state.repositories[0].weekly_commits).toEqual([5, 4]));
    expect(api.fetchRepositoryActivity).toHaveBeenCalledTimes(2);
  });

  it('refreshes background cards without replacing repository metadata', async () => {
    api.fetchRepositories.mockResolvedValue({ repositories: [repo(1), repo(2)] });
    api.fetchRepositoryBackgroundSessions.mockResolvedValue({
      'numina/repo-1': [{
        id: 'session-1',
        blueprint_name: 'bp',
        tier: 'active',
        background_updates: [],
        roadblocks: [],
      }],
    });
    const { result } = renderHook(() => useDashboard());
    await act(() => result.current.load());

    await act(() => result.current.refreshBackgroundSessions());

    expect(result.current.state.loading).toBe(false);
    expect(result.current.state.repositories[0]).toMatchObject({
      id: 1,
      name: 'repo-1',
      background_sessions: [{ id: 'session-1', tier: 'active' }],
    });
    expect(result.current.state.repositories[1].background_sessions).toEqual([]);
  });

  it('retains background cards when a refresh payload is malformed', async () => {
    const existing = {
      id: 'session-1',
      blueprint_name: 'bp',
      tier: 'active' as const,
      background_updates: [],
      roadblocks: [],
    };
    api.fetchRepositories.mockResolvedValue({
      repositories: [{ ...repo(1), background_sessions: [existing] }],
    });
    api.fetchRepositoryBackgroundSessions.mockResolvedValue({
      'numina/repo-1': [{ ...existing, tier: 'unexpected' }],
    });
    const { result } = renderHook(() => useDashboard());
    await act(() => result.current.load());

    await act(() => result.current.refreshBackgroundSessions());

    expect(result.current.state.repositories[0].background_sessions).toEqual([existing]);
  });
});
