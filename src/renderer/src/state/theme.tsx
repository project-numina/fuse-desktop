/**
 * Theme provider. Manages light/dark/system preference for the app.
 *
 * in localStorage under `numina-theme`. When set to `system` the resolved
 * theme tracks the OS-level `prefers-color-scheme` media query.
 *
 * The resolved value is applied to the document root as the `.dark` class
 * (studio's dark variant is `@custom-variant dark (&:is(.dark *))`), replacing
 * paint, the persisted preference is read and applied synchronously at module
 * { immediate: true })` at setup.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'numina-theme';

function readStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored;
  }
  return 'system';
}

function readSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function resolvePreference(
  preference: ThemePreference,
  systemTheme: ResolvedTheme,
): ResolvedTheme {
  return preference === 'system' ? systemTheme : preference;
}

/** Applies the resolved theme to the document root via the `.dark` class. */
function applyTheme(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

// Apply the persisted preference synchronously at import time so the correct
// theme is on the document root before React's first paint (no light flash).
applyTheme(resolvePreference(readStoredPreference(), readSystemTheme()));

interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (preference: ThemePreference) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(
    readStoredPreference,
  );
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(readSystemTheme);

  const resolvedTheme = resolvePreference(preference, systemTheme);

  // Keep `preference: 'system'` in sync with OS-level changes.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? 'dark' : 'light');
    };
    if (media.addEventListener) {
      media.addEventListener('change', handleChange);
      return () => media.removeEventListener('change', handleChange);
    }
    // Safari < 14 fallback.
    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, []);

  // Apply the resolved theme whenever it changes.
  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  // Persist the preference whenever it changes.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, preference);
  }, [preference]);

  const setTheme = useCallback((next: ThemePreference) => {
    setPreference(next);
  }, []);

  const toggle = useCallback(() => {
    // Toggling snaps to the opposite of whatever is currently showing — the
    // gesture that matches user expectation, even when on `system`.
    setPreference((prev) =>
      resolvePreference(prev, readSystemTheme()) === 'dark' ? 'light' : 'dark',
    );
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme: preference, resolvedTheme, setTheme, toggle }),
    [preference, resolvedTheme, setTheme, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === null) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
