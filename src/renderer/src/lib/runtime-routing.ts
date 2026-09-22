/**
 * Release-routing affinity for API requests.
 *
 * The hosted service ran several backend releases side by side and pinned a
 * workspace's requests to the release that owned its live session by adding a
 * `runtime=<tag>` query parameter. The desktop app talks to exactly one local
 * backend, so there is never a tag to apply. The module keeps its exports so
 * the workspace page and the request core stay unchanged; every function is
 * the identity / null case.
 */

/** There is no release prefix in local session ids; always `null`. */
export function runtimeRouteTag(
  _sessionId: string | null | undefined,
): string | null {
  return null;
}

export type WorkspaceRuntimeIdentity = {
  owner: string;
  repository: string;
  blueprint: string;
};

/** No-op: a single local backend has no release routes to register. */
export function setWorkspaceRuntimeTag(
  _owner: string,
  _repository: string,
  _blueprint: string,
  _runtimeTag: string | null,
): void {}

/** Returns `path` unchanged: no affinity query is ever added locally. */
export function runtimeAffinedApiPath(
  path: string,
  _workspaceIdentity?: WorkspaceRuntimeIdentity,
): string {
  return path;
}
