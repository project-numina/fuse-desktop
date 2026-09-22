import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ThemeProvider, useTheme } from '@/state/theme';

const wrapper = ({ children }: { children: ReactNode }) => <ThemeProvider>{children}</ThemeProvider>;

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear(); document.documentElement.classList.remove('dark');
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
  });
  it('persists explicit themes and applies the dark class', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.setTheme('dark'));
    expect(result.current).toMatchObject({ theme: 'dark', resolvedTheme: 'dark' });
    expect(localStorage.getItem('numina-theme')).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');
  });
  it('toggle switches the currently resolved appearance', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.toggle()); expect(result.current.resolvedTheme).toBe('dark');
    act(() => result.current.toggle()); expect(result.current.resolvedTheme).toBe('light');
  });
  it('requires its provider', () => {
    expect(() => renderHook(() => useTheme())).toThrow('useTheme must be used within a ThemeProvider');
  });
});
