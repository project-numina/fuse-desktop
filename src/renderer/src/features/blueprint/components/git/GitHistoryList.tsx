import { cn } from '@/lib/utils';
import { timeLabel, type CommitDay, type CommitView } from '@/features/blueprint/lib/commit-history';
import CommitAvatar from '@/features/blueprint/components/git/CommitAvatar';
import GitPaneState from '@/features/blueprint/components/git/GitPaneState';
import type { useGitMode } from '@/features/blueprint/components/git/use-git-mode';

interface CommitEntryProps {
  view: CommitView;
  loading: boolean;
  onSelect: (sha: string) => void;
}

function CommitEntry({ view, loading, onSelect }: CommitEntryProps) {
  return (
    <li
      className={cn(
        'border-b border-[var(--numina-border-light)] last:border-b-0',
        loading && '[&>button]:bg-[var(--accent-overlay-soft)]',
      )}
    >
      <button
        type="button"
        className="grid w-full cursor-pointer grid-cols-[auto_1fr] items-center gap-[var(--space-2)] border-none bg-transparent px-[var(--space-3)] py-[var(--space-2)] text-left font-[inherit] text-[var(--text-primary)] hover:bg-[var(--numina-surface-sunken)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--numina-accent)]"
        onClick={() => onSelect(view.raw.sha)}
      >
        <CommitAvatar avatarUrl={view.avatarUrl} actor={view.actor} />
        <div className="min-w-0">
          <div className="flex items-center gap-[var(--space-1)] overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium text-[var(--text-primary)]">
            {view.subject}
            {view.isIncomplete && (
              <span className="inline-flex items-center rounded-full bg-[var(--status-unformalized-bg,var(--numina-surface-sunken))] px-2 py-[0.05em] text-[0.6rem] font-semibold uppercase tracking-[0.04em] text-[var(--status-unformalized-text,var(--text-muted))]">
                incomplete
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1 text-[0.7rem] text-[var(--text-muted)]">
            <span className="font-medium">{view.actor}</span>
            {view.timestamp && <span>· {timeLabel(view.timestamp)}</span>}
          </div>
        </div>
      </button>
    </li>
  );
}

interface CommitDayGroupProps {
  day: CommitDay;
  selectedSha: string | null;
  loading: boolean;
  onSelect: (sha: string) => void;
}

function CommitDayGroup({ day, selectedSha, loading, onSelect }: CommitDayGroupProps) {
  return (
    <li className="border-b border-[var(--numina-border-light)]">
      <header className="flex items-baseline justify-between border-b border-[var(--numina-border-light)] bg-[var(--numina-surface-sunken)] px-[var(--space-3)] py-1.5 leading-[1.2]">
        <span className="text-xs font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)]">
          {day.label}
        </span>
        <span className="text-xs text-[var(--text-muted)]">{day.entries.length}</span>
      </header>
      <ul className="m-0 list-none p-0">
        {day.entries.map(view => (
          <CommitEntry
            key={view.raw.sha}
            view={view}
            loading={loading && selectedSha === view.raw.sha}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </li>
  );
}

interface GitHistoryListProps {
  git: ReturnType<typeof useGitMode>;
}

function GitHistoryList({ git }: GitHistoryListProps) {
  if (git.commitsError) return <GitPaneState>{git.commitsError}</GitPaneState>;
  if (git.commitsLoading && git.commits.length === 0) {
    return <GitPaneState>Loading commits…</GitPaneState>;
  }
  if (git.commits.length === 0) return <GitPaneState>No commits yet.</GitPaneState>;

  return (
    <ol className="m-0 list-none p-0">
      {git.commitDays.map(day => (
        <CommitDayGroup
          key={day.key}
          day={day}
          selectedSha={git.selectedCommitSha}
          loading={git.commitDetailLoading}
          onSelect={git.selectCommit}
        />
      ))}
    </ol>
  );
}

export default GitHistoryList;
