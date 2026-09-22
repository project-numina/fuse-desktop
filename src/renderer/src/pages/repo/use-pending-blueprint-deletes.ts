import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import { deleteBlueprint } from '@/lib/api';
import {
  PENDING_BLUEPRINT_DELETE_KEY,
  readPendingBlueprintDeletes,
  writePendingBlueprintDeletes,
} from '@/pages/repo/repo-helpers';

interface PendingDeleteOptions {
  owner: string;
  repository: string;
  reload: (
    owner: string,
    repository: string,
    options?: { force?: boolean },
  ) => Promise<void>;
}

function useStagedDeletes(owner: string, repository: string) {
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const requestDelete = useCallback((blueprintId: string) => {
    if (pendingDeletes.has(blueprintId)) return;
    setDeleteError(null);
    const next = new Set(pendingDeletes);
    next.add(blueprintId);
    setPendingDeletes(next);
    writePendingBlueprintDeletes(next, owner, repository);
  }, [owner, pendingDeletes, repository]);
  const undoDelete = useCallback((blueprintId: string) => {
    const next = new Set(pendingDeletes);
    next.delete(blueprintId);
    setPendingDeletes(next);
    writePendingBlueprintDeletes(next, owner, repository);
    setDeleteError(null);
  }, [owner, pendingDeletes, repository]);
  return {
    deleteError,
    pendingDeletes,
    requestDelete,
    setDeleteError,
    setPendingDeletes,
    undoDelete,
  };
}

function useDeleteFlusher(
  pendingDeletes: Set<string>,
  setPendingDeletes: Dispatch<SetStateAction<Set<string>>>,
  owner: string,
  repository: string,
) {
  const pendingRef = useRef(pendingDeletes);
  const routeRef = useRef({ owner, repository });
  pendingRef.current = pendingDeletes;
  routeRef.current = { owner, repository };
  const flushCurrent = useCallback(() => {
    const ids = Array.from(pendingRef.current);
    if (ids.length === 0) return;
    pendingRef.current = new Set();
    setPendingDeletes(new Set());
    sessionStorage.removeItem(PENDING_BLUEPRINT_DELETE_KEY);
    const route = routeRef.current;
    const prefix = `/api/repositories/${encodeURIComponent(route.owner)}`
      + `/${encodeURIComponent(route.repository)}/blueprints`;
    for (const id of ids) {
      void fetch(`${prefix}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
        keepalive: true,
      });
    }
  }, [setPendingDeletes]);
  useEffect(() => {
    window.addEventListener('pagehide', flushCurrent);
    return () => window.removeEventListener('pagehide', flushCurrent);
  }, [flushCurrent]);
  return flushCurrent;
}

async function recoverDeletes(
  ids: string[],
  owner: string,
  repository: string,
  reload: PendingDeleteOptions['reload'],
  onComplete: (failedCount: number) => void,
): Promise<void> {
  const results = await Promise.allSettled(
    ids.map((id) => deleteBlueprint(owner, repository, id)),
  );
  await reload(owner, repository, { force: true });
  onComplete(results.filter((result) => result.status === 'rejected').length);
}

function useRecoveredDeletes(
  { owner, repository, reload }: PendingDeleteOptions,
  setDeleteError: Dispatch<SetStateAction<string | null>>,
) {
  const [recoveringDeletes, setRecoveringDeletes] = useState<Set<string>>(
    () => new Set(readPendingBlueprintDeletes(owner, repository)),
  );
  const didRecoverRef = useRef(false);
  useEffect(() => {
    if (didRecoverRef.current) return;
    didRecoverRef.current = true;
    const ids = Array.from(recoveringDeletes);
    if (ids.length === 0) return;
    sessionStorage.removeItem(PENDING_BLUEPRINT_DELETE_KEY);
    void recoverDeletes(ids, owner, repository, reload, (failedCount) => {
      setRecoveringDeletes(new Set());
      if (failedCount === 0) return;
      setDeleteError(
        failedCount === ids.length
          ? 'Could not delete pending blueprints. Try again from the list.'
          : 'Some pending blueprints could not be deleted. Try again from the list.',
      );
    });
    // Recovery is a one-time mount sweep of the initial storage snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return recoveringDeletes;
}

/** Stages undoable deletes and flushes them on refresh, navigation, or unload. */
export function usePendingBlueprintDeletes(options: PendingDeleteOptions) {
  const staged = useStagedDeletes(options.owner, options.repository);
  const recoveringDeletes = useRecoveredDeletes(options, staged.setDeleteError);
  const flushCurrent = useDeleteFlusher(
    staged.pendingDeletes,
    staged.setPendingDeletes,
    options.owner,
    options.repository,
  );
  return {
    deleteError: staged.deleteError,
    flushCurrent,
    pendingDeletes: staged.pendingDeletes,
    recoveringDeletes,
    requestDelete: staged.requestDelete,
    undoDelete: staged.undoDelete,
  };
}
