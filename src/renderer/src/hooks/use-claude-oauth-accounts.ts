/**
 * Linked Claude accounts — empty stub.
 *
 * The hosted app let a user link several `claude setup-token` values and
 * rotated between them. Fuse Desktop runs the user's own `claude` CLI, which
 * manages its own login, so there is nothing to link. The hook keeps the web
 * hook's return shape so the Settings page compiles without the section;
 * every action is a no-op and the list is always empty.
 */

import { useCallback, useState } from 'react';

/** A linked Claude account, as the hosted backend returned it (no secret). */
export interface ClaudeOAuthAccount {
  id: string;
  label: string;
  enabled: boolean;
  exhausted_until: string | null;
  last_used_at: string | null;
  created_at: string;
}

export function useClaudeOAuthAccounts() {
  const [newLabel, setNewLabel] = useState('');
  const [newToken, setNewToken] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const load = useCallback(async () => {}, []);
  const toggleAutomaticFallback = useCallback(async (_enabled: boolean) => {}, []);
  const addAccount = useCallback(async () => false, []);
  const toggleAccount = useCallback(async (_account: ClaudeOAuthAccount) => {}, []);
  const removeAccount = useCallback(async (_account: ClaudeOAuthAccount) => {}, []);

  return {
    accounts: [] as ClaudeOAuthAccount[],
    automaticFallback: false,
    fallbackPending: false,
    loading: false,
    error: null as string | null,
    newLabel,
    setNewLabel,
    newToken,
    setNewToken,
    adding: false,
    addError,
    setAddError,
    pendingId: null as string | null,
    load,
    addAccount,
    toggleAccount,
    toggleAutomaticFallback,
    removeAccount,
  };
}
