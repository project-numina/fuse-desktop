import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ fetchRepository: vi.fn(), fetchBlueprints: vi.fn(), fetchPullRequests: vi.fn() }));
const dashboard = vi.hoisted(() => ({ getDashboardRepository: vi.fn() }));
vi.mock('@/lib/api', () => api);
vi.mock('@/state/dashboard', () => dashboard);
import { loadRepositoryPage, resetRepositoryPageState, useRepositoryPage } from '@/state/repository-page';

describe('repository-page state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dashboard.getDashboardRepository.mockReturnValue(null);
    resetRepositoryPageState();
  });
  it('loads all repository resources in parallel and caches the result', async () => {
    api.fetchRepository.mockResolvedValue({ full_name: 'o/r' });
    api.fetchBlueprints.mockResolvedValue([{ id: 'bp' }]);
    api.fetchPullRequests.mockResolvedValue([{ number: 1 }]);
    const { result } = renderHook(() => useRepositoryPage());
    await act(() => loadRepositoryPage('o', 'r'));
    expect(result.current.state).toEqual({ repository: { full_name: 'o/r' }, blueprints: [{ id: 'bp' }], pullRequests: [{ number: 1 }], error: null });
    await act(() => loadRepositoryPage('o', 'r'));
    expect(api.fetchRepository).toHaveBeenCalledTimes(1);
    await act(() => loadRepositoryPage('o', 'r', { force: true }));
    expect(api.fetchRepository).toHaveBeenCalledTimes(2);
  });

  it('reuses repository metadata already loaded by the dashboard', async () => {
    const repository = { owner: 'o', name: 'r', description: 'cached' };
    dashboard.getDashboardRepository.mockReturnValue(repository);
    api.fetchRepository.mockResolvedValue({
      owner: 'o',
      name: 'r',
      description: 'fresh',
    });
    api.fetchBlueprints.mockResolvedValue([{ id: 'bp' }]);
    api.fetchPullRequests.mockResolvedValue([]);
    const { result } = renderHook(() => useRepositoryPage());

    await act(() => loadRepositoryPage('o', 'r'));

    expect(result.current.state.repository).toBe(repository);
    expect(api.fetchRepository).not.toHaveBeenCalled();

    await act(() => loadRepositoryPage('o', 'r', { force: true }));

    expect(api.fetchRepository).toHaveBeenCalledOnce();
    expect(result.current.state.repository).toEqual({
      owner: 'o',
      name: 'r',
      description: 'fresh',
    });
  });

  it('records fetch errors and reset clears user-scoped data', async () => {
    api.fetchRepository.mockRejectedValue('offline');
    api.fetchBlueprints.mockResolvedValue([]); api.fetchPullRequests.mockResolvedValue([]);
    const { result } = renderHook(() => useRepositoryPage());
    await act(() => loadRepositoryPage('o', 'r'));
    expect(result.current.state.error).toBe('offline');
    act(() => resetRepositoryPageState());
    expect(result.current.state).toEqual({ repository: null, blueprints: [], pullRequests: [], error: null });
  });
});
