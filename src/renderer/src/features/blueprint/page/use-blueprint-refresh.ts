import { useCallback, useEffect, useRef } from 'react';

import { useBlueprintEvents } from '@/features/blueprint/hooks/events';
import { useCollaboration } from '@/features/blueprint/hooks/use-collaboration';
import { fetchBlueprint } from '@/lib/api';

import type { BlueprintData, BlueprintRouteIdentity } from './blueprint-page-types';
import type { useBlueprintEditing } from './use-blueprint-editing';
import type { useBlueprintFiles } from './use-blueprint-files';
import type { useBlueprintLoader } from './use-blueprint-loader';
import type { useBlueprintModeRouting } from './use-blueprint-mode-routing';
import type { useRepositorySources } from './use-repository-sources';

export function useBlueprintRefresh({
  route,
  loader,
  modeRouting,
  editing,
  files,
  sources,
}: {
  route: BlueprintRouteIdentity;
  loader: ReturnType<typeof useBlueprintLoader>;
  modeRouting: ReturnType<typeof useBlueprintModeRouting>;
  editing: ReturnType<typeof useBlueprintEditing>;
  files: ReturnType<typeof useBlueprintFiles>;
  sources: ReturnType<typeof useRepositorySources>;
}) {
  const { owner, repo, blueprintId } = route;
  const collaboration = useCollaboration({ owner, repo, blueprintName: blueprintId });
  const collaborationSyncedRef = useRef(collaboration.synced);
  collaborationSyncedRef.current = collaboration.synced;
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);

  const refreshBlueprintContent = useCallback(async (): Promise<void> => {
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      return;
    }
    refreshInFlightRef.current = true;
    try {
      const next = await fetchBlueprint(owner, repo, blueprintId) as BlueprintData;
      loader.setBlueprint(next);
      loader.blueprintRef.current = next;
      if (!collaborationSyncedRef.current) {
        if (editing.pendingSaveRef.current) editing.refreshAfterPendingSaveRef.current = true;
        else if (await editing.syncSourceFromActiveChapter()) editing.markBlueprintSynced();
      }
    } finally {
      refreshInFlightRef.current = false;
    }
    if (refreshQueuedRef.current) {
      refreshQueuedRef.current = false;
      await refreshBlueprintContent();
    }
  }, [owner, repo, blueprintId, loader, editing]);

  useEffect(() => {
    if (editing.pendingSave || !editing.refreshAfterPendingSaveRef.current) return;
    editing.refreshAfterPendingSaveRef.current = false;
    void refreshBlueprintContent().catch(() => undefined);
  }, [editing, refreshBlueprintContent]);

  const events = useBlueprintEvents({
    owner,
    repo,
    blueprintId,
    runtimeTag: loader.runtimeTag,
    callbacks: {
      collaboration: { connected: collaboration.connected, synced: collaboration.synced },
      blueprint: loader.blueprint,
      isViewMounted: () => modeRouting.modeRef.current === 'view',
      hasPendingLocalSave: () => editing.pendingSaveRef.current,
      deferRefreshUntilSaved: () => { editing.refreshAfterPendingSaveRef.current = true; },
      refreshBlueprintContent,
      syncLatexSourceFromActiveChapter: editing.syncSourceFromActiveChapter,
      markBlueprintSynced: editing.markBlueprintSynced,
      reloadOpenFile: () => files.loadOpenFile({ silent: true }),
      isSourceMounted: () => modeRouting.modeRef.current === 'view',
      refreshRepositorySources: () => sources.loadSources(sources.selectedSourceIdRef.current),
      onBranchStatus: (branchStatus) => loader.setBlueprint((previous) =>
        previous ? { ...previous, branch_status: branchStatus } : previous),
      onBranchFreshness: (branchFreshness) => loader.setBlueprint((previous) =>
        previous ? { ...previous, branch_freshness: branchFreshness } : previous),
    },
  });

  useEffect(() => {
    if (loader.blueprint) editing.initializeBlueprint(loader.blueprint, events.applyOcrPhase);
  }, [loader.blueprint, editing, events.applyOcrPhase]);

  const handleSourceUpdated = useCallback(() => {
    void refreshBlueprintContent().catch(() => undefined);
  }, [refreshBlueprintContent]);

  return { events, refreshBlueprintContent, handleSourceUpdated };
}
