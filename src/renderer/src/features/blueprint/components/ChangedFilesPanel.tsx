import { useCallback, useMemo, type ReactNode } from 'react';

import ChangedFilesPanelView from '@/features/blueprint/components/ChangedFilesPanelView';
import ChangedFilesTree from '@/features/blueprint/components/ChangedFilesTree';
import {
  buildDirectoryEntries,
  changedFilesDividerIndex,
  type BuildErrorCount,
  type DirectoryEntry,
  type FileDiffStats,
} from '@/features/blueprint/components/changed-files-tree';
import { useChangedFilesNavigation } from '@/features/blueprint/components/use-changed-files-navigation';

export type {
  BuildErrorCount,
  FileDiffStats,
} from '@/features/blueprint/components/changed-files-tree';

export interface ChangedFilesPanelProps {
  files?: string[];
  directories?: string[];
  loading?: boolean;
  onDirectoryChange?: (path: string) => void;
  /** Repo-relative directory that acts as the visible root of the tree. */
  rootPath?: string;
  diffStats?: Record<string, FileDiffStats>;
  buildErrorCounts?: Record<string, BuildErrorCount>;
  selectedFile?: string | null;
  collapsed?: boolean;
  /** Fill an enclosing workspace rail instead of rendering as a card. */
  rail?: boolean;
  infoview?: ReactNode;
  footer?: ReactNode;
  onSelectFile: (path: string) => void;
  onToggleCollapsed: () => void;
}

function ChangedFilesPanel({
  files = [],
  directories = [],
  loading = false,
  onDirectoryChange,
  rootPath = '',
  diffStats = {},
  buildErrorCounts = {},
  selectedFile = null,
  collapsed = false,
  rail = false,
  infoview,
  footer,
  onSelectFile,
  onToggleCollapsed,
}: ChangedFilesPanelProps) {
  const navigation = useChangedFilesNavigation({
    rootPath,
    selectedFile,
    onDirectoryChange,
  });
  const { breadcrumbs, currentPath, enterFolder, goHome, goUp } = navigation;
  const entries = useMemo(() => buildDirectoryEntries({
    files,
    directories,
    currentPath,
    diffStats,
    buildErrorCounts,
  }), [
    buildErrorCounts,
    diffStats,
    directories,
    files,
    currentPath,
  ]);
  const dividerIndex = useMemo(() => changedFilesDividerIndex(entries), [entries]);
  const onActivate = useCallback((entry: DirectoryEntry) => {
    if (entry.kind === 'folder') {
      enterFolder(entry.path);
    } else if (selectedFile !== entry.path) {
      onSelectFile(entry.path);
    }
  }, [enterFolder, onSelectFile, selectedFile]);
  const filesPane = (
    <ChangedFilesTree
      entries={entries}
      dividerIndex={dividerIndex}
      loading={loading}
      selectedFile={selectedFile}
      breadcrumbs={breadcrumbs}
      onGoUp={goUp}
      onGoHome={goHome}
      onEnterFolder={enterFolder}
      onActivate={onActivate}
      footer={footer}
    />
  );
  return (
    <ChangedFilesPanelView
      collapsed={collapsed}
      rail={rail}
      filesPane={filesPane}
      infoview={infoview}
      onToggleCollapsed={onToggleCollapsed}
    />
  );
}

export default ChangedFilesPanel;
