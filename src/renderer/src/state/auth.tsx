/**
 * Auth provider. Resolves the local user from the backend (`/auth/me`).
 *
 * There is no sign-in on the desktop: the local backend always answers with a
 * synthetic user built from the OS account and the display name in Settings.
 * The context keeps the web app's shape (`user`, `checked`, `login`,
 * `logout`, …) so every consumer compiles unchanged; `login` is a no-op and
 * `logout` only clears client-side caches.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, fetchCurrentUser } from '@/lib/api';
import type { UserGroup } from '@/lib/user-groups';
import { resetActiveSessionsState } from '@/state/active-sessions';
import { resetDashboardState } from '@/state/dashboard';
import { resetRepositoryPageState } from '@/state/repository-page';
import { resetBlueprintPageState } from '@/features/blueprint/state/blueprint-page';

export interface User {
  github_username: string;
  name: string | null;
  github_avatar_url: string | null;
  is_admin: boolean;
  can_use_oauth_token: boolean;
  user_group: UserGroup;
  can_configure_orchestrator_concurrency: boolean;
  orchestrator_concurrency_max: number;
}

/**
 * Extracts a human-readable message from an unknown thrown value.
 */
function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}

/**
 * Resets domain-store state that belongs to the authenticated client
 * (dashboard, active-sessions, repository-page, blueprint-page) so a user
 * change never leaks the previous user's data into the next session.
 */
function resetAuthenticatedClientState(): void {
  resetDashboardState();
  resetActiveSessionsState();
  resetRepositoryPageState();
  resetBlueprintPageState();
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  checked: boolean;
  error: string | null;
  checkSession: () => Promise<void>;
  logout: () => Promise<void>;
  login: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mirror of `user` for reading the current value inside async callbacks
  const userRef = useRef<User | null>(null);
  const applyUser = useCallback((next: User | null) => {
    userRef.current = next;
    setUser(next);
  }, []);

  /**
   * Checks the current session by calling GET /api/auth/me.
   * Sets the user if authenticated, null otherwise.
   */
  const checkSession = useCallback(async () => {
    setLoading(true);
    try {
      const nextUser = (await fetchCurrentUser()) as User;
      const previous = userRef.current;
      if (
        previous !== null &&
        previous.github_username !== nextUser.github_username
      ) {
        // The backend answered with a different identity. Locally the only
        // way that happens is a display-name change (`routes/auth.ts` maps
        // the display name into `github_username`), so this costs a cache
        // reload rather than guarding against another user's data; kept for
        // parity with the web client.
        resetAuthenticatedClientState();
      }
      applyUser(nextUser);
      setError(null);
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        (caught.status === 401 || caught.status === 403)
      ) {
        resetAuthenticatedClientState();
        applyUser(null);
        setError(null);
        return;
      }
      setError(errorMessage(caught, 'Could not verify your session.'));
      throw caught;
    } finally {
      setLoading(false);
      setChecked(true);
    }
  }, [applyUser]);

  // Provider-mount bootstrap so `checked` becomes true and authed routes stop
  // hanging on "Loading…". Failures are swallowed — a transient `/auth/me`
  // failure should not surface the global error fallback (`state.error` is
  // still set for any UI that wants it). The ref guard keeps React 19
  // StrictMode's double-mount from firing two concurrent `/auth/me` calls.
  const didBootstrapRef = useRef(false);
  useEffect(() => {
    if (didBootstrapRef.current) return;
    didBootstrapRef.current = true;
    void checkSession().catch(() => {});
  }, [checkSession]);

  /** No sign-in exists locally; kept so the context shape is unchanged. */
  const login = useCallback(() => {}, []);

  /**
   * Clears client-side caches and the user. There is no server session to
   * end; the next `checkSession()` restores the local user.
   */
  const logout = useCallback(async () => {
    resetAuthenticatedClientState();
    applyUser(null);
  }, [applyUser]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, checked, error, checkSession, logout, login }),
    [user, loading, checked, error, checkSession, logout, login],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
