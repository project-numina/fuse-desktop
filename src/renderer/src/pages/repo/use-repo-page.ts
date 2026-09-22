import { useCallback, useEffect, useMemo } from 'react';
import {
  useNavigate,
  useParams,
  type NavigateFunction,
} from 'react-router-dom';

import { isDesktop, showInFolder } from '@/desktop/bridge';
import { useStatus } from '@/hooks/use-status';
import { setDocumentTitle } from '@/lib/document-title';
import {
  activeBlueprints,
  blueprintPath,
  blueprintPullRequest,
  completedNuminaPullRequests,
  pullRequestBlueprint,
  type BlueprintSummary,
  type PullRequestSummary,
  type RepositoryDetails,
} from '@/pages/repo/repo-helpers';
import { usePendingBlueprintDeletes } from '@/pages/repo/use-pending-blueprint-deletes';
import { useRepositoryPage } from '@/state/repository-page';

function useRepositoryLifecycle(
  owner: string,
  repository: string,
  title: string,
  load: (
    owner: string,
    repository: string,
    options?: { force?: boolean },
  ) => Promise<void>,
  flushDeletes: () => void,
) {
  useEffect(() => setDocumentTitle(title), [title]);
  useEffect(() => {
    void load(owner, repository);
    return flushDeletes;
  }, [flushDeletes, load, owner, repository]);
}

function useRepoDerivedData(
  blueprints: BlueprintSummary[],
  pullRequests: PullRequestSummary[],
  recoveringDeletes: Set<string>,
) {
  const active = useMemo(
    () => activeBlueprints(blueprints, pullRequests, recoveringDeletes),
    [blueprints, pullRequests, recoveringDeletes],
  );
  const completed = useMemo(
    () => completedNuminaPullRequests(pullRequests),
    [pullRequests],
  );
  const findBlueprintPullRequest = useCallback(
    (blueprint: BlueprintSummary) => blueprintPullRequest(blueprint, pullRequests),
    [pullRequests],
  );
  const findPullRequestBlueprint = useCallback(
    (pullRequest: PullRequestSummary) => pullRequestBlueprint(pullRequest, blueprints),
    [blueprints],
  );
  return { active, completed, findBlueprintPullRequest, findPullRequestBlueprint };
}

function useRepoActions(
  owner: string,
  repositoryName: string,
  repository: RepositoryDetails | null,
  blueprints: BlueprintSummary[],
  navigate: NavigateFunction,
) {
  const pathForBlueprint = useCallback(
    (blueprint: BlueprintSummary) =>
      blueprintPath(owner, repositoryName, blueprint.id),
    [owner, repositoryName],
  );
  const createBlueprint = useCallback(() => {
    navigate(`/repo/${owner}/${repositoryName}/blueprint/new`);
  }, [navigate, owner, repositoryName]);
  const openPullRequestBlueprint = useCallback((pullRequest: PullRequestSummary) => {
    const blueprint = pullRequestBlueprint(pullRequest, blueprints);
    if (blueprint) navigate(pathForBlueprint(blueprint));
  }, [blueprints, navigate, pathForBlueprint]);
  const revealRepository = useCallback(() => {
    if (repository?.path) showInFolder(repository.path);
  }, [repository?.path]);
  return {
    createBlueprint,
    openPullRequestBlueprint,
    pathForBlueprint,
    revealRepository,
  };
}

/** Loads one repository route and exposes the actions consumed by its view. */
export function useRepoPage() {
  const params = useParams<{ owner: string; repo: string }>();
  const owner = params.owner ?? '';
  const repositoryName = params.repo ?? '';
  const navigate = useNavigate();
  const { pullRequestStatusLabel } = useStatus();
  const { state, load } = useRepositoryPage();
  const repository = state.repository as RepositoryDetails | null;
  const blueprints = state.blueprints as BlueprintSummary[];
  const pullRequests = state.pullRequests as PullRequestSummary[];
  const deletes = usePendingBlueprintDeletes({
    owner,
    repository: repositoryName,
    reload: load,
  });
  useRepositoryLifecycle(
    owner,
    repositoryName,
    repository?.name || repositoryName,
    load,
    deletes.flushCurrent,
  );
  const derived = useRepoDerivedData(
    blueprints,
    pullRequests,
    deletes.recoveringDeletes,
  );
  const actions = useRepoActions(
    owner,
    repositoryName,
    repository,
    blueprints,
    navigate,
  );

  return {
    blueprints: derived.active,
    canRevealRepository: Boolean(repository?.path && isDesktop()),
    completedPullRequests: derived.completed,
    createBlueprint: actions.createBlueprint,
    deleteError: deletes.deleteError,
    error: state.error,
    findBlueprintPullRequest: derived.findBlueprintPullRequest,
    findPullRequestBlueprint: derived.findPullRequestBlueprint,
    openPullRequestBlueprint: actions.openPullRequestBlueprint,
    pathForBlueprint: actions.pathForBlueprint,
    pendingDeletes: deletes.pendingDeletes,
    pullRequestStatusLabel,
    repository,
    requestDelete: deletes.requestDelete,
    revealRepository: actions.revealRepository,
    undoDelete: deletes.undoDelete,
  };
}

export type RepoPageModel = ReturnType<typeof useRepoPage>;
