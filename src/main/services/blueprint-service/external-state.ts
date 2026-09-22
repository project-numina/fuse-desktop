import type { BlueprintBranchStatus, BranchFreshness } from '@shared/api-types';
import type { AppContext } from '../../server/context';
import type { RepositoryRow } from '../../store/rows';
import type { RepositorySourceView } from '../blueprint';
import { branchFreshness, branchStatus, currentBranch, isGitRepository } from '../git';
import type { OpenProject } from '../types';

interface SourceServiceLike {
  canonicalSourceView(repository: RepositoryRow, blueprintName: string): Promise<RepositorySourceView | null>;
}

export async function sourceView(ctx: AppContext, project: OpenProject): Promise<RepositorySourceView | null> {
  const sources = ctx.services.sources as SourceServiceLike | undefined;
  if (!sources?.canonicalSourceView) return null;
  try {
    return await sources.canonicalSourceView(project.repository, project.blueprint.id);
  } catch (error) {
    console.warn(`[blueprints] source view unavailable for ${project.roomKey}:`, error);
    return null;
  }
}

/** Git metadata is best-effort and must never block a blueprint detail read. */
export async function branchState(
  project: OpenProject,
): Promise<{ status: BlueprintBranchStatus | null; freshness: BranchFreshness | null }> {
  try {
    if (!(await isGitRepository(project.clonePath))) return { status: null, freshness: null };
    const branch = await currentBranch(project.clonePath);
    const [status, freshness] = await Promise.all([
      branch ? branchStatus(project.clonePath, branch).catch(() => null) : Promise.resolve(null),
      branchFreshness(project.clonePath).catch(() => null),
    ]);
    return { status, freshness };
  } catch (error) {
    console.warn(`[blueprints] branch state unavailable for ${project.roomKey}:`, error);
    return { status: null, freshness: null };
  }
}
