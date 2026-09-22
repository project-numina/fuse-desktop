import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { AppErrorProvider, clearApplicationError, showApplicationError, useAppError } from '@/state/app-error';

const wrapper = ({ children }: { children: ReactNode }) => <AppErrorProvider>{children}</AppErrorProvider>;

describe('application error state', () => {
  beforeEach(() => clearApplicationError());
  it('surfaces and clears generic application errors imperatively', () => {
    const { result } = renderHook(() => useAppError(), { wrapper });
    act(() => showApplicationError(new Error('secret detail')));
    expect(result.current.error).toBe('Something went wrong. Refresh the page and try again.');
    act(() => result.current.clearApplicationError()); expect(result.current.error).toBeNull();
  });
  it('gives stale lazy chunks an actionable refresh message', () => {
    const { result } = renderHook(() => useAppError(), { wrapper });
    act(() => showApplicationError(new Error('Loading chunk 42 failed')));
    expect(result.current.error).toMatch(/could not be loaded.*Refresh/i);
  });
  it('requires its provider', () => {
    expect(() => renderHook(() => useAppError())).toThrow('useAppError must be used within an AppErrorProvider');
  });
});
