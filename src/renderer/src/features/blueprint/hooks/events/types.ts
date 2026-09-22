import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type { BlueprintBranchStatus, BranchFreshness } from '@/lib/api';
import type {
  BlueprintBuildStatus,
  BlueprintOcrStatus,
  BuildErrorCounts,
} from '@/features/blueprint/lib/blueprint-helpers';

export interface BlueprintEventCallbacks {
  collaboration: { connected: boolean; synced: boolean };
  blueprint: {
    blueprint_content?: string;
    ocr_phase?: string | null;
    branch_status?: BlueprintBranchStatus | null;
    branch_freshness?: BranchFreshness | null;
  } | null;
  isViewMounted: () => boolean;
  hasPendingLocalSave: () => boolean;
  deferRefreshUntilSaved: () => void;
  refreshBlueprintContent: () => Promise<void>;
  syncLatexSourceFromActiveChapter: () => Promise<boolean> | boolean;
  markBlueprintSynced: () => void;
  reloadOpenFile: () => Promise<boolean | undefined> | boolean | undefined;
  isSourceMounted?: () => boolean;
  refreshRepositorySources?: () => Promise<void>;
  onBranchStatus?: (status: BlueprintBranchStatus) => void;
  onBranchFreshness?: (freshness: BranchFreshness) => void;
}

export interface BlueprintEventOptions {
  owner: string;
  repo: string;
  blueprintId: string;
  runtimeTag?: string | null;
  callbacks: BlueprintEventCallbacks;
}

export interface ChatEventRegistry {
  on: (type: string, listener: (event: Event) => void) => void;
  off: (type: string, listener: (event: Event) => void) => void;
}

export interface BlueprintEventRefs {
  callbacks: MutableRefObject<BlueprintEventCallbacks>;
  ocrStatus: MutableRefObject<BlueprintOcrStatus>;
  runtimeTag: MutableRefObject<string | null>;
  chatRegistry: MutableRefObject<ChatEventRegistry>;
}

export interface BlueprintEventSetters {
  setBuildStatus: Dispatch<SetStateAction<BlueprintBuildStatus>>;
  setBuildErrors: Dispatch<SetStateAction<BuildErrorCounts>>;
  applyBuildPhase: (phase: string | null | undefined) => void;
  applyOcrPhase: (phase: string | null | undefined) => void;
}
