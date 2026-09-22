export interface BlueprintSummary {
  id: string;
  name: string;
  updated_at?: string | null;
  can_edit?: boolean;
}

export interface PullRequestSummary {
  number: number;
  title: string;
  branch: string;
  status: string;
  merged_at?: string | null;
}

export interface RepositoryDetails {
  name?: string;
  owner?: string;
  description?: string | null;
  path?: string | null;
}

export const PENDING_BLUEPRINT_DELETE_KEY = 'pendingBlueprintDelete';

export function readPendingBlueprintDeletes(
  owner: string,
  repository: string,
): string[] {
  const raw = sessionStorage.getItem(PENDING_BLUEPRINT_DELETE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as {
      owner?: string;
      repo?: string;
      ids?: unknown;
    };
    if (parsed.owner !== owner || parsed.repo !== repository) return [];
    return Array.isArray(parsed.ids)
      ? parsed.ids.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

export function writePendingBlueprintDeletes(
  ids: Set<string>,
  owner: string,
  repository: string,
): void {
  if (ids.size === 0) {
    sessionStorage.removeItem(PENDING_BLUEPRINT_DELETE_KEY);
    return;
  }
  sessionStorage.setItem(
    PENDING_BLUEPRINT_DELETE_KEY,
    JSON.stringify({ owner, repo: repository, ids: Array.from(ids) }),
  );
}

export function blueprintPath(
  owner: string,
  repository: string,
  blueprintId: string,
): string {
  return `/repo/${owner}/${repository}/blueprint/${blueprintId}`;
}

export function blueprintPullRequest(
  blueprint: BlueprintSummary,
  pullRequests: PullRequestSummary[],
): PullRequestSummary | null {
  return pullRequests.find(
    (pullRequest) => pullRequest.branch === `numina/${blueprint.id}`,
  ) ?? null;
}

export function pullRequestBlueprint(
  pullRequest: PullRequestSummary,
  blueprints: BlueprintSummary[],
): BlueprintSummary | null {
  return blueprints.find(
    (blueprint) => `numina/${blueprint.id}` === pullRequest.branch,
  ) ?? null;
}

export function activeBlueprints(
  blueprints: BlueprintSummary[],
  pullRequests: PullRequestSummary[],
  recoveringDeletes: Set<string>,
): BlueprintSummary[] {
  return [...blueprints]
    .filter((blueprint) => !recoveringDeletes.has(blueprint.id))
    .filter(
      (blueprint) => blueprintPullRequest(blueprint, pullRequests)?.status !== 'merged',
    )
    .sort((left, right) => {
      const leftDate = left.updated_at ? new Date(left.updated_at) : new Date(0);
      const rightDate = right.updated_at ? new Date(right.updated_at) : new Date(0);
      return rightDate.getTime() - leftDate.getTime();
    });
}

export function completedNuminaPullRequests(
  pullRequests: PullRequestSummary[],
): PullRequestSummary[] {
  return pullRequests.filter(
    (pullRequest) => pullRequest.branch.startsWith('numina/')
      && pullRequest.status === 'merged',
  );
}
