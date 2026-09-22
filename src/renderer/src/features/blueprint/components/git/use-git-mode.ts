/** Read-only working-tree diffs and commit history for the local folder. */

import { useCallback, useEffect, useRef } from 'react';

import type { BranchFreshness, BlueprintBranchStatus } from '@/lib/api';
import { useGitModeActions, type GitModeActions } from './use-git-mode-actions';
import { useGitModeDerived, type GitModeDerived } from './git-mode-derived';
import { useGitModeLoaders, type GitModeLoaders } from './use-git-mode-loaders';
import {
  useGitModeSelection,
  type GitModeSelection,
  type HistoryView as SelectionHistoryView,
  type TabKey as SelectionTabKey,
} from './use-git-mode-selection';

/** Page-owned repository and blueprint routing context. */
export interface BlueprintContext {
  owner: string;
  repo: string;
  blueprintId: string;
}

export type TabKey = SelectionTabKey;
export type HistoryView = SelectionHistoryView;

export interface GitBlueprint {
  id: string;
  branch_freshness?: BranchFreshness | null;
  branch_status?: BlueprintBranchStatus | null;
}

export interface UseGitModeOptions {
  blueprint: GitBlueprint;
  context: BlueprintContext | null;
  active: boolean;
  hasUncommittedChanges?: boolean;
}

function useLoadingEffects(
  active: boolean,
  activeTab: TabKey,
  hasUncommittedChanges: boolean,
  loadDiff: () => Promise<void>,
  loadCommits: () => Promise<void>,
  loadBranchStatus: () => Promise<void>,
): void {
  const activeRef = useRef(active);
  activeRef.current = active;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const loadActiveTab = useCallback(() => {
    if (activeTabRef.current === 'changes') void loadDiff();
    else void loadCommits();
  }, [activeTabRef, loadDiff, loadCommits]);

  useEffect(() => {
    if (active) loadActiveTab();
  }, [active, activeTab, loadActiveTab]);
  useEffect(() => {
    if (active) void loadBranchStatus();
  }, [active, loadBranchStatus]);

  const skipFirstDirtyRun = useRef(true);
  useEffect(() => {
    if (skipFirstDirtyRun.current) {
      skipFirstDirtyRun.current = false;
      return;
    }
    if (activeRef.current && activeTabRef.current === 'changes') void loadDiff();
    // A repeated true signal can represent a new autosave, so only this value triggers the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUncommittedChanges]);
}

function gitModeResult(
  selection: GitModeSelection,
  loaders: GitModeLoaders,
  actions: GitModeActions,
  derived: GitModeDerived,
) {
  return {
    activeTab: selection.activeTab, setActiveTab: selection.setActiveTab,
    historyView: selection.historyView,
    diffFiles: loaders.diffFiles, diffLoading: loaders.diffLoading, diffError: loaders.diffError,
    selectedDiffPath: selection.selectedDiffPath, setSelectedDiffPath: selection.setSelectedDiffPath,
    commits: loaders.commits, commitsLoading: loaders.commitsLoading, commitsError: loaders.commitsError,
    selectedCommitSha: selection.selectedCommitSha,
    commitDetail: loaders.commitDetail,
    commitDetailLoading: loaders.commitDetailLoading,
    commitDetailError: loaders.commitDetailError,
    selectedCommitFilePath: selection.selectedCommitFilePath,
    setSelectedCommitFilePath: selection.setSelectedCommitFilePath,
    selectCommit: actions.selectCommit, backToHistoryList: actions.backToHistoryList,
    selectedCommitFile: derived.selectedCommitFile,
    selectedCommitFileLines: derived.selectedCommitFileLines,
    branchName: derived.branchName,
    visibleDiffFiles: derived.visibleDiffFiles,
    hiddenMetadataDiffCount: derived.hiddenMetadataDiffCount,
    visibleCommitFiles: derived.visibleCommitFiles,
    hiddenMetadataCommitFileCount: derived.hiddenMetadataCommitFileCount,
    selectedDiffFile: derived.selectedDiffFile,
    selectedDiffLines: derived.selectedDiffLines,
    commitDays: derived.commitDays,
    detailHeader: derived.detailHeader,
  };
}

export function useGitMode({
  blueprint,
  context,
  active,
  hasUncommittedChanges = false,
}: UseGitModeOptions) {
  const selection = useGitModeSelection();
  const loaders = useGitModeLoaders(
    { owner: context?.owner, repo: context?.repo, blueprintId: context?.blueprintId },
    selection.setSelectedDiffPath,
    selection.setSelectedCommitFilePath,
  );
  const actions = useGitModeActions(selection, loaders);
  useLoadingEffects(
    active,
    selection.activeTab,
    hasUncommittedChanges,
    loaders.loadDiff,
    loaders.loadCommits,
    loaders.loadBranchStatus,
  );
  const derived = useGitModeDerived({
    blueprintBranch: blueprint.branch_status?.branch,
    liveBranch: loaders.liveBranch,
    diffFiles: loaders.diffFiles,
    selectedDiffPath: selection.selectedDiffPath,
    commits: loaders.commits,
    commitDetail: loaders.commitDetail,
    selectedCommitFilePath: selection.selectedCommitFilePath,
  });
  return gitModeResult(selection, loaders, actions, derived);
}
