import GitModeView from '@/features/blueprint/components/git/GitModeView';
import GitToolbar from '@/features/blueprint/components/git/GitToolbar';
import {
  useGitMode,
  type BlueprintContext,
  type GitBlueprint,
} from '@/features/blueprint/components/git/use-git-mode';

/** Read-only working-tree changes and commit history. */
export interface GitModeProps {
  blueprint: GitBlueprint;
  context: BlueprintContext | null;
  active?: boolean;
  hasUncommittedChanges?: boolean;
}

function GitMode({
  blueprint,
  context,
  active = true,
  hasUncommittedChanges,
}: GitModeProps) {
  const git = useGitMode({
    blueprint,
    context,
    active,
    hasUncommittedChanges,
  });

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1100px] flex-col box-border p-[var(--space-6)]">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--numina-border-light)] bg-[var(--numina-card-bg)]">
        <GitToolbar
          activeTab={git.activeTab}
          onTabChange={git.setActiveTab}
          changesCount={git.visibleDiffFiles.length}
          branchName={git.branchName}
        />
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1">
            <GitModeView git={git} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default GitMode;
