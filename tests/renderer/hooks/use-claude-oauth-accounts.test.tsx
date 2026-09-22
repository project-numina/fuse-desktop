import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useClaudeOAuthAccounts } from '@/hooks/use-claude-oauth-accounts';

describe('useClaudeOAuthAccounts (desktop stub)', () => {
  it('exposes an empty, idle account list', async () => {
    const { result } = renderHook(() => useClaudeOAuthAccounts());
    expect(result.current.accounts).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.automaticFallback).toBe(false);
    await act(() => result.current.load());
    expect(result.current.error).toBeNull();
    await expect(result.current.addAccount()).resolves.toBe(false);
  });

  it('keeps the form field setters working', () => {
    const { result } = renderHook(() => useClaudeOAuthAccounts());
    act(() => result.current.setNewLabel('Personal'));
    expect(result.current.newLabel).toBe('Personal');
  });
});
