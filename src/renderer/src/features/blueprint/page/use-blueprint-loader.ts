import { useEffect, useRef, useState } from 'react';

import { useBlueprintPage } from '@/features/blueprint/state/blueprint-page';
import { formatBlueprintLabel } from '@/features/blueprint/lib/blueprint-helpers';
import { setDocumentTitle } from '@/lib/document-title';
import { stripInlineMathDelimiters } from '@/lib/inline-math-text';
import { runtimeRouteTag, setWorkspaceRuntimeTag } from '@/lib/runtime-routing';

import type { BlueprintData, BlueprintRouteIdentity } from './blueprint-page-types';

export function useBlueprintLoader(
  route: BlueprintRouteIdentity,
  chatSessionId: string | null,
) {
  const { owner, repo, blueprintId } = route;
  const { state: pageState, load } = useBlueprintPage();
  const cached = pageState.blueprint as BlueprintData | null;
  const [blueprint, setBlueprint] = useState<BlueprintData | null>(() =>
    cached?.id === blueprintId ? cached : null,
  );
  const [loading, setLoading] = useState(!blueprint);
  const [error, setError] = useState<string | null>(null);
  const blueprintRef = useRef<BlueprintData | null>(blueprint);
  blueprintRef.current = blueprint;

  const runtimeTag = runtimeRouteTag(chatSessionId)
    ?? blueprint?.runtime_route_tag
    ?? null;
  const blueprintLabel = blueprint?.name || formatBlueprintLabel(blueprintId);

  useEffect(() => {
    setWorkspaceRuntimeTag(owner, repo, blueprintId, runtimeTag);
    return () => setWorkspaceRuntimeTag(owner, repo, blueprintId, null);
  }, [owner, repo, blueprintId, runtimeTag]);

  useEffect(() => {
    setDocumentTitle(stripInlineMathDelimiters(blueprintLabel));
  }, [blueprintLabel]);

  useEffect(() => {
    const prefetched = pageState.blueprint as BlueprintData | null;
    if (prefetched?.id === blueprintId) return;
    setLoading(true);
    void load(owner, repo, blueprintId);
    // The stable store action is deliberately omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, blueprintId]);

  useEffect(() => {
    const prefetched = pageState.blueprint as BlueprintData | null;
    if (prefetched?.id === blueprintId) {
      setBlueprint((previous) => previous ?? prefetched);
      setError(null);
      setLoading(false);
    } else if (pageState.error) {
      setError(pageState.error);
      setLoading(false);
    }
  }, [pageState, blueprintId]);

  return {
    blueprint,
    blueprintRef,
    setBlueprint,
    loading,
    error,
    runtimeTag,
    blueprintLabel,
    canEdit: blueprint?.can_edit ?? true,
  };
}
