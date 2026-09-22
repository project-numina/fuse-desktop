import type { BlueprintBranchStatus, BranchFreshness } from '@/lib/api';
import type { BuildErrorCounts } from '@/features/blueprint/lib/blueprint-helpers';
import {
  eventBuildSnapshot,
  eventFiles,
  eventLatexSource,
  eventPayload,
  eventPhase,
} from './normalization';
import type {
  BlueprintEventRefs,
  BlueprintEventSetters,
} from './types';

export interface BlueprintStreamHandlers {
  blueprintEdit: (event: Event) => void;
  buildSnapshot: (event: Event) => void;
  buildErrors: (event: Event) => void;
  buildStatus: (event: Event) => void;
  ocrPhase: (event: Event) => void;
  fullRefresh: () => Promise<void>;
  branchStatus: (event: Event) => void;
  branchFreshness: (event: Event) => void;
  refreshAfterGap: () => Promise<void>;
}

function handleBlueprintEdit(refs: BlueprintEventRefs, event: Event): void {
  const callbacks = refs.callbacks.current;
  if (callbacks.collaboration.connected) return;
  const latexSource = eventLatexSource(event);
  if (latexSource === null) return;
  if (callbacks.hasPendingLocalSave()) {
    callbacks.deferRefreshUntilSaved();
    return;
  }
  if (callbacks.blueprint) callbacks.blueprint.blueprint_content = latexSource;
  void callbacks.syncLatexSourceFromActiveChapter();
}

function handleBuildSnapshot(setters: BlueprintEventSetters, event: Event): void {
  const snapshot = eventBuildSnapshot(event);
  if (snapshot?.done) setters.setBuildStatus('done');
  else if (snapshot?.hasSteps) setters.setBuildStatus('running');
}

function handleBuildErrors(setters: BlueprintEventSetters, event: Event): void {
  const files = eventFiles(event);
  if (files) setters.setBuildErrors(files as BuildErrorCounts);
}

function handleBuildStatus(setters: BlueprintEventSetters, event: Event): void {
  const phase = eventPhase(event);
  if (phase !== false) setters.applyBuildPhase(phase);
}

function refreshSourcesAfterOcr(refs: BlueprintEventRefs): void {
  const callbacks = refs.callbacks.current;
  if (!callbacks.isSourceMounted?.() || !callbacks.refreshRepositorySources) return;
  void callbacks.refreshRepositorySources().catch(() => {
    // Reopening Source reloads the list after a transient failure.
  });
}

function handleOcrPhase(
  refs: BlueprintEventRefs,
  setters: BlueprintEventSetters,
  event: Event,
): void {
  const phase = eventPhase(event);
  if (phase === false) return;
  const becameComplete = phase === 'complete' && refs.ocrStatus.current !== 'complete';
  setters.applyOcrPhase(phase);
  if (!becameComplete) return;
  void refs.callbacks.current.refreshBlueprintContent().catch(() => {
    // A later sync or manual reload reconciles a transient failure.
  });
  refreshSourcesAfterOcr(refs);
}

async function refreshAfterGap(
  refs: BlueprintEventRefs,
  setters: BlueprintEventSetters,
): Promise<void> {
  try {
    await refs.callbacks.current.refreshBlueprintContent();
    setters.applyOcrPhase(refs.callbacks.current.blueprint?.ocr_phase);
  } catch {
    // Stream recovery remains useful even if the REST refresh fails.
  }
  if (refs.callbacks.current.isViewMounted()) {
    void refs.callbacks.current.reloadOpenFile();
  }
}

async function handleFullRefresh(
  refs: BlueprintEventRefs,
  setters: BlueprintEventSetters,
): Promise<void> {
  await refreshAfterGap(refs, setters);
  if (refs.callbacks.current.collaboration.synced) {
    refs.callbacks.current.markBlueprintSynced();
  }
}

function handleBranchStatus(refs: BlueprintEventRefs, event: Event): void {
  const status = eventPayload<BlueprintBranchStatus>(event);
  if (!status) return;
  const callbacks = refs.callbacks.current;
  if (callbacks.blueprint) callbacks.blueprint.branch_status = status;
  callbacks.onBranchStatus?.(status);
}

function handleBranchFreshness(refs: BlueprintEventRefs, event: Event): void {
  const freshness = eventPayload<BranchFreshness>(event);
  if (!freshness) return;
  const callbacks = refs.callbacks.current;
  if (callbacks.blueprint) callbacks.blueprint.branch_freshness = freshness;
  callbacks.onBranchFreshness?.(freshness);
}

export function createBlueprintStreamHandlers(
  refs: BlueprintEventRefs,
  setters: BlueprintEventSetters,
): BlueprintStreamHandlers {
  return {
    blueprintEdit: (event) => handleBlueprintEdit(refs, event),
    buildSnapshot: (event) => handleBuildSnapshot(setters, event),
    buildErrors: (event) => handleBuildErrors(setters, event),
    buildStatus: (event) => handleBuildStatus(setters, event),
    ocrPhase: (event) => handleOcrPhase(refs, setters, event),
    fullRefresh: () => handleFullRefresh(refs, setters),
    branchStatus: (event) => handleBranchStatus(refs, event),
    branchFreshness: (event) => handleBranchFreshness(refs, event),
    refreshAfterGap: () => refreshAfterGap(refs, setters),
  };
}
