/** React state adapter for the blueprint EventSource lifecycle. */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  buildStatusForPhase,
  ocrStatusForPhase,
  type BlueprintBuildStatus,
  type BlueprintOcrStatus,
  type BuildErrorCounts,
} from '@/features/blueprint/lib/blueprint-helpers';
import { useChat } from '@/state/chat';
import { createBlueprintStreamHandlers } from './handlers';
import { createLeanInvalidationController } from './invalidation';
import { createBlueprintEventSubscription } from './subscription';
import type {
  BlueprintEventOptions,
  BlueprintEventRefs,
} from './types';

export type { BlueprintEventCallbacks } from './types';

function useLatestEventRefs(
  options: BlueprintEventOptions,
  ocrStatus: BlueprintOcrStatus,
): BlueprintEventRefs {
  const callbacks = useRef(options.callbacks);
  callbacks.current = options.callbacks;
  const currentOcrStatus = useRef(ocrStatus);
  currentOcrStatus.current = ocrStatus;
  const runtimeTag = useRef(options.runtimeTag ?? null);
  runtimeTag.current = options.runtimeTag ?? null;
  const { on, off } = useChat();
  const chatRegistry = useRef({ on, off });
  chatRegistry.current = { on, off };
  return { callbacks, ocrStatus: currentOcrStatus, runtimeTag, chatRegistry };
}

export function useBlueprintEvents(options: BlueprintEventOptions) {
  const { owner, repo, blueprintId } = options;
  const [buildStatus, setBuildStatus] = useState<BlueprintBuildStatus>(null);
  const [buildErrors, setBuildErrors] = useState<BuildErrorCounts>({});
  const [ocrStatus, setOcrStatus] = useState<BlueprintOcrStatus>(null);
  const refs = useLatestEventRefs(options, ocrStatus);

  const applyBuildPhase = useCallback((phase: string | null | undefined) => {
    setBuildStatus((current) => buildStatusForPhase(phase, current));
  }, []);
  const applyOcrPhase = useCallback((phase: string | null | undefined) => {
    setOcrStatus((current) => ocrStatusForPhase(phase, current));
  }, []);

  useEffect(() => {
    const handlers = createBlueprintStreamHandlers(refs, {
      setBuildStatus,
      setBuildErrors,
      applyBuildPhase,
      applyOcrPhase,
    });
    const invalidation = createLeanInvalidationController(refs);
    const subscription = createBlueprintEventSubscription(
      { owner, repo, blueprintId },
      refs,
      handlers,
      invalidation,
    );
    subscription.mount();
    return () => subscription.unmount();
    // Latest callbacks, runtime affinity, and chat registry are read via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, blueprintId, applyBuildPhase, applyOcrPhase]);

  return { buildStatus, buildErrors, ocrStatus, applyOcrPhase };
}
