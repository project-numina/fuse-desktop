import { useCallback, useRef, useState } from 'react';

export type TabKey = 'changes' | 'history';
export type HistoryView = 'list' | 'detail';

export function useGitModeSelection() {
  const [activeTab, setActiveTab] = useState<TabKey>('changes');
  const [historyView, setHistoryView] = useState<HistoryView>('list');
  const [selectedDiffPath, setSelectedDiffPath] = useState<string | null>(null);
  const [selectedCommitSha, setSelectedCommitSha] = useState<string | null>(null);
  const [selectedCommitFilePath, setSelectedCommitFilePath] = useState<string | null>(null);

  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const selectedCommitShaRef = useRef(selectedCommitSha);
  selectedCommitShaRef.current = selectedCommitSha;

  const beginCommitSelection = useCallback((sha: string) => {
    setSelectedCommitSha(sha);
    selectedCommitShaRef.current = sha;
  }, []);

  const clearHistorySelection = useCallback(() => {
    setHistoryView('list');
    setSelectedCommitSha(null);
    setSelectedCommitFilePath(null);
  }, []);

  return {
    activeTab,
    setActiveTab,
    activeTabRef,
    historyView,
    setHistoryView,
    selectedDiffPath,
    setSelectedDiffPath,
    selectedCommitSha,
    selectedCommitShaRef,
    selectedCommitFilePath,
    setSelectedCommitFilePath,
    beginCommitSelection,
    clearHistorySelection,
  };
}

export type GitModeSelection = ReturnType<typeof useGitModeSelection>;
