import { useCallback } from 'react';

import type { GitModeLoaders } from './use-git-mode-loaders';
import type { GitModeSelection } from './use-git-mode-selection';

export function useGitModeActions(selection: GitModeSelection, loaders: GitModeLoaders) {
  const {
    activeTabRef,
    beginCommitSelection,
    clearHistorySelection,
    selectedCommitShaRef,
    setHistoryView,
  } = selection;
  const { cancelCommitDetail, loadCommitDetail } = loaders;
  const selectCommit = useCallback(async (sha: string) => {
    beginCommitSelection(sha);
    const loaded = await loadCommitDetail(sha);
    if (
      loaded
      && selectedCommitShaRef.current === sha
      && activeTabRef.current === 'history'
    ) setHistoryView('detail');
  }, [activeTabRef, beginCommitSelection, loadCommitDetail, selectedCommitShaRef, setHistoryView]);

  const backToHistoryList = useCallback(() => {
    cancelCommitDetail();
    clearHistorySelection();
  }, [cancelCommitDetail, clearHistorySelection]);

  return { selectCommit, backToHistoryList };
}

export type GitModeActions = ReturnType<typeof useGitModeActions>;
