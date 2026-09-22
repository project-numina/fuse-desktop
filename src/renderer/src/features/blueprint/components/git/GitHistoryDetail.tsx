import type { BlueprintCommitDetail } from '@/lib/api';
import { timeLabel } from '@/features/blueprint/lib/commit-history';
import CommitAvatar from '@/features/blueprint/components/git/CommitAvatar';
import DiffFileList from '@/features/blueprint/components/git/DiffFileList';
import DiffRows from '@/features/blueprint/components/git/DiffRows';
import GitPaneState from '@/features/blueprint/components/git/GitPaneState';
import HiddenFilesNotice from '@/features/blueprint/components/git/HiddenFilesNotice';
import type { useGitMode } from '@/features/blueprint/components/git/use-git-mode';

const METADATA_HIDDEN_TOOLTIP =
  'Generated metadata files are hidden from this view.';

type GitModeState = ReturnType<typeof useGitMode>;

interface GitHistoryDetailProps {
  git: GitModeState;
}

function DetailSidebarHeader({ git }: GitHistoryDetailProps) {
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-[var(--numina-border-light)] bg-[var(--numina-surface-sunken)] px-[var(--space-3)] py-[var(--space-2)]">
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-[var(--space-1)] border-none bg-transparent p-0 text-xs font-semibold text-[var(--numina-accent)] hover:text-[var(--numina-accent-hover)] hover:underline"
        onClick={git.backToHistoryList}
      >
        ← History
      </button>
      {git.commitDetail && (
        <span className="text-xs font-medium text-[var(--text-muted)]">
          {git.visibleCommitFiles.length}{' '}
          file{git.visibleCommitFiles.length === 1 ? '' : 's'}
        </span>
      )}
    </header>
  );
}

function DetailSidebarBody({ git }: GitHistoryDetailProps) {
  const emptyMessage = git.hiddenMetadataCommitFileCount > 0
    ? 'No visible files changed.'
    : 'No files changed.';
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {git.commitDetailError ? (
        <GitPaneState>{git.commitDetailError}</GitPaneState>
      ) : git.commitDetailLoading && !git.commitDetail ? (
        <GitPaneState>Loading…</GitPaneState>
      ) : !git.commitDetail || git.visibleCommitFiles.length === 0 ? (
        <GitPaneState>{emptyMessage}</GitPaneState>
      ) : (
        <DiffFileList
          files={git.visibleCommitFiles}
          selectedPath={git.selectedCommitFilePath}
          onSelect={git.setSelectedCommitFilePath}
        />
      )}
      {git.hiddenMetadataCommitFileCount > 0 && (
        <HiddenFilesNotice
          count={git.hiddenMetadataCommitFileCount}
          tooltip={METADATA_HIDDEN_TOOLTIP}
        />
      )}
    </div>
  );
}

function DetailSidebar({ git }: GitHistoryDetailProps) {
  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-[var(--numina-border-light)] min-h-0">
      <DetailSidebarHeader git={git} />
      <DetailSidebarBody git={git} />
    </aside>
  );
}

interface CommitReferenceProps {
  detail: BlueprintCommitDetail;
  shortSha: string;
}

function CommitReference({ detail, shortSha }: CommitReferenceProps) {
  const className =
    '[font-family:var(--numina-font-mono)] text-xs text-[var(--text-muted)]';
  if (!detail.html_url) {
    return <span className={className} title={detail.sha}>· {shortSha}</span>;
  }
  return (
    <a
      href={detail.html_url}
      target="_blank"
      rel="noopener noreferrer"
      className={`${className} no-underline hover:text-[var(--numina-accent)]`}
      title={detail.sha}
    >
      · {shortSha}
    </a>
  );
}

function DetailHeader({ git }: GitHistoryDetailProps) {
  if (!git.detailHeader) return null;
  return (
    <header className="flex shrink-0 items-center gap-[var(--space-2)] border-b border-[var(--numina-border-light)] bg-[var(--numina-card-bg)] px-[var(--space-3)] py-[var(--space-2)]">
      <CommitAvatar
        avatarUrl={git.detailHeader.avatarUrl}
        actor={git.detailHeader.actor}
      />
      <div className="flex min-w-0 flex-col gap-[0.1rem]">
        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold text-[var(--text-primary)]">
          {git.detailHeader.subject}
        </span>
        <span className="inline-flex flex-wrap items-center gap-1 text-xs text-[var(--text-muted)]">
          <span className="font-medium">{git.detailHeader.actor}</span>
          {git.detailHeader.timestamp && (
            <span>· {timeLabel(git.detailHeader.timestamp)}</span>
          )}
          {git.commitDetail && (
            <CommitReference
              detail={git.commitDetail}
              shortSha={git.detailHeader.shortSha}
            />
          )}
        </span>
      </div>
    </header>
  );
}

function CommitDiff({ git }: GitHistoryDetailProps) {
  if (!git.selectedCommitFile) {
    const message = git.commitDetail && git.commitDetail.files.length === 0
      ? 'This commit changed no files (likely a merge or empty commit).'
      : git.hiddenMetadataCommitFileCount > 0
        ? 'Only generated metadata changed in this commit.'
        : 'Select a file to see its diff.';
    return <GitPaneState spacious>{message}</GitPaneState>;
  }
  if (!git.selectedCommitFile.patch) {
    return (
      <GitPaneState spacious>
        No patch preview (binary, large file, or pure rename).
      </GitPaneState>
    );
  }
  return <DiffRows lines={git.selectedCommitFileLines} />;
}

function GitHistoryDetail({ git }: GitHistoryDetailProps) {
  return (
    <>
      <DetailSidebar git={git} />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
        <DetailHeader git={git} />
        <CommitDiff git={git} />
      </main>
    </>
  );
}

export default GitHistoryDetail;
