import DiffFileList from '@/features/blueprint/components/git/DiffFileList';
import GitDiffPreview from '@/features/blueprint/components/git/GitDiffPreview';
import GitPaneState from '@/features/blueprint/components/git/GitPaneState';
import HiddenFilesNotice from '@/features/blueprint/components/git/HiddenFilesNotice';
import type { useGitMode } from '@/features/blueprint/components/git/use-git-mode';

const METADATA_HIDDEN_TOOLTIP =
  'Generated metadata files are hidden from this view.';

interface GitChangesViewProps {
  git: ReturnType<typeof useGitMode>;
}

function ChangesSidebar({ git }: GitChangesViewProps) {
  const emptyMessage = git.hiddenMetadataDiffCount > 0
    ? 'No visible changes.'
    : 'No pending changes.';
  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-[var(--numina-border-light)] min-h-0">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {git.diffError ? (
          <GitPaneState>{git.diffError}</GitPaneState>
        ) : git.diffLoading && git.diffFiles.length === 0 ? (
          <GitPaneState>Loading…</GitPaneState>
        ) : git.visibleDiffFiles.length === 0 ? (
          <GitPaneState>{emptyMessage}</GitPaneState>
        ) : (
          <DiffFileList
            files={git.visibleDiffFiles}
            selectedPath={git.selectedDiffPath}
            onSelect={git.setSelectedDiffPath}
          />
        )}
        {git.hiddenMetadataDiffCount > 0 && (
          <HiddenFilesNotice
            count={git.hiddenMetadataDiffCount}
            tooltip={METADATA_HIDDEN_TOOLTIP}
          />
        )}
      </div>
    </aside>
  );
}

function GitChangesView({ git }: GitChangesViewProps) {
  return (
    <>
      <ChangesSidebar git={git} />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
        <GitDiffPreview
          file={git.selectedDiffFile}
          lines={git.selectedDiffLines}
          visibleFileCount={git.visibleDiffFiles.length}
          hiddenMetadataCount={git.hiddenMetadataDiffCount}
        />
      </main>
    </>
  );
}

export default GitChangesView;
