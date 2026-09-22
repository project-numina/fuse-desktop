import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  fetchCurrentUser: vi.fn(),
  resetDashboardState: vi.fn(), resetActiveSessionsState: vi.fn(),
  resetRepositoryPageState: vi.fn(), resetBlueprintPageState: vi.fn(),
}));
const MockApiError = vi.hoisted(() => class ApiError extends Error { constructor(message: string, public status: number) { super(message); } });
vi.mock('@/lib/api', () => ({ ApiError: MockApiError, fetchCurrentUser: mocks.fetchCurrentUser }));
vi.mock('@/state/dashboard', () => ({ resetDashboardState: mocks.resetDashboardState }));
vi.mock('@/state/active-sessions', () => ({ resetActiveSessionsState: mocks.resetActiveSessionsState }));
vi.mock('@/state/repository-page', () => ({ resetRepositoryPageState: mocks.resetRepositoryPageState }));
vi.mock('@/features/blueprint/state/blueprint-page', () => ({ resetBlueprintPageState: mocks.resetBlueprintPageState }));
import { AuthProvider, useAuth } from '@/state/auth';

const user = (name: string) => ({ github_username: name, name: null, github_avatar_url: null, is_admin: false, can_use_oauth_token: true, user_group: 'numina' as const, can_configure_orchestrator_concurrency: true, orchestrator_concurrency_max: 4 });
const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

describe('AuthProvider', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('bootstraps the local user from /auth/me on mount', async () => {
    mocks.fetchCurrentUser.mockResolvedValue(user('ada'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.checked).toBe(true));
    expect(result.current.user).toEqual(user('ada'));
    expect(result.current.loading).toBe(false);
    expect(mocks.fetchCurrentUser).toHaveBeenCalledOnce();
  });

  it.each([401, 403])('treats HTTP %i as signed out and resets user data', async (status) => {
    mocks.fetchCurrentUser.mockRejectedValue(new MockApiError('not authenticated', status));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.checked).toBe(true));
    expect(result.current.user).toBeNull(); expect(result.current.error).toBeNull();
    expect(mocks.resetDashboardState).toHaveBeenCalled();
    expect(mocks.resetRepositoryPageState).toHaveBeenCalled();
  });

  it('keeps transient bootstrap failures available as a nonfatal error', async () => {
    mocks.fetchCurrentUser.mockRejectedValue(new MockApiError('service unavailable', 503));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.checked).toBe(true));
    expect(result.current.error).toBe('service unavailable');
    expect(result.current.user).toBeNull();
  });

  it('resets all user-scoped stores when the identity changes', async () => {
    mocks.fetchCurrentUser.mockResolvedValueOnce(user('old'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.user?.github_username).toBe('old'));
    mocks.fetchCurrentUser.mockResolvedValueOnce(user('new'));
    await act(() => result.current.checkSession());
    expect(result.current.user?.github_username).toBe('new');
    expect(mocks.resetBlueprintPageState).toHaveBeenCalledOnce();
    expect(mocks.resetActiveSessionsState).toHaveBeenCalledOnce();
  });

  it('logout clears caches and the user without a network call', async () => {
    mocks.fetchCurrentUser.mockResolvedValue(user('ada'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.user).not.toBeNull());
    await act(() => result.current.logout());
    expect(result.current.user).toBeNull();
    expect(mocks.resetActiveSessionsState).toHaveBeenCalled();
    expect(mocks.resetDashboardState).toHaveBeenCalled();
    expect(mocks.fetchCurrentUser).toHaveBeenCalledOnce();
    expect(() => result.current.login()).not.toThrow();
  });

  it('requires the provider', () => {
    expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used within an AuthProvider');
  });
});
