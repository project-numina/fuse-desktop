import { useState } from 'react';

import { deleteBlueprint } from '@/lib/api';

import { removeErrorMessage } from './helpers';

interface UseRemoveWorkspaceOptions {
  owner: string;
  repo: string;
  blueprintId: string;
  onRemoved?: () => void;
}

export function useRemoveWorkspace(options: UseRemoveWorkspaceOptions) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setError(null);
    setDialogOpen(true);
  }

  function cancel() {
    if (!removing) setDialogOpen(false);
  }

  async function confirm() {
    if (removing) return;
    setRemoving(true);
    setError(null);
    try {
      await deleteBlueprint(options.owner, options.repo, options.blueprintId);
      setDialogOpen(false);
      options.onRemoved?.();
    } catch (removeError) {
      setDialogOpen(false);
      setError(removeErrorMessage(removeError));
    } finally {
      setRemoving(false);
    }
  }

  return { dialogOpen, removing, error, openDialog, cancel, confirm };
}

export type RemoveWorkspaceState = ReturnType<typeof useRemoveWorkspace>;
