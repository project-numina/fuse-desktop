import { cn } from '@/lib/utils';
import type { TabKey } from '@/features/blueprint/components/git/use-git-mode';

/** Read-only view selector and checked-out branch label. */
export interface GitToolbarProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  changesCount: number;
  branchName: string;
}

const tabClass = (active: boolean) =>
  cn(
    'inline-flex items-center gap-[var(--space-1)] -mb-px cursor-pointer border-0 border-b-2 bg-transparent px-[var(--space-1)] py-[var(--space-2)] text-sm font-medium',
    active
      ? 'border-[var(--numina-accent)] text-[var(--numina-accent)]'
      : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-body)]',
  );

function GitToolbar({
  activeTab,
  onTabChange,
  changesCount,
  branchName,
}: GitToolbarProps) {
  return (
    <nav
      className="flex shrink-0 items-center gap-[var(--space-3)] border-b border-[var(--numina-border-light)] bg-[var(--numina-card-bg)] px-[var(--space-3)]"
      role="tablist"
    >
      <button
        type="button"
        role="tab"
        className={tabClass(activeTab === 'changes')}
        aria-selected={activeTab === 'changes'}
        onClick={() => onTabChange('changes')}
      >
        Changes
        {changesCount > 0 && (
          <span
            className={cn(
              'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[0.4em] text-[0.7rem] font-semibold',
              activeTab === 'changes'
                ? 'bg-[var(--accent-overlay-soft)] text-[var(--numina-accent)]'
                : 'bg-[var(--numina-border-light)] text-[var(--text-muted)]',
            )}
          >
            {changesCount}
          </span>
        )}
      </button>
      <button
        type="button"
        role="tab"
        className={tabClass(activeTab === 'history')}
        aria-selected={activeTab === 'history'}
        onClick={() => onTabChange('history')}
      >
        History
      </button>

      <div className="flex-1" />

      <span className="min-w-0 max-w-[220px] truncate text-xs text-[var(--text-muted)]" title={branchName}>
        {branchName}
      </span>
    </nav>
  );
}

export default GitToolbar;
