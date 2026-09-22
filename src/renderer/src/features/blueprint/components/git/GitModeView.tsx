import GitChangesView from '@/features/blueprint/components/git/GitChangesView';
import GitHistoryDetail from '@/features/blueprint/components/git/GitHistoryDetail';
import GitHistoryList from '@/features/blueprint/components/git/GitHistoryList';
import type { useGitMode } from '@/features/blueprint/components/git/use-git-mode';

interface GitModeViewProps {
  git: ReturnType<typeof useGitMode>;
}

function GitModeView({ git }: GitModeViewProps) {
  if (git.activeTab === 'changes') return <GitChangesView git={git} />;
  if (git.historyView === 'detail') return <GitHistoryDetail git={git} />;
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--numina-card-bg)]">
      <GitHistoryList git={git} />
    </main>
  );
}

export default GitModeView;
