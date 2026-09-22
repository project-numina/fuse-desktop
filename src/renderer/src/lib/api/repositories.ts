/**
 * Repository API helpers: registering and listing opened folders, commit
 * activity, branch and blueprint-file discovery, project scaffolding, repo
 * details, and the (always empty) pull-request list.
 */

import { fetchApi, repoPath, request } from '@/lib/api/core';

export type RepositoryBranches = {
  default_branch: string;
  branches: string[];
};

export type RepositoryBlueprintFile = {
  path: string;
  name: string;
  size: number;
};

export type LakefileEntry = {
  directory: string;
  lakefile: string;
  path: string;
};

export type RepositoryLakefiles = {
  lakefiles: LakefileEntry[];
  truncated: boolean;
};

export type RepositorySetupResult = {
  default_branch: string;
  module_name: string;
  project_subdir: string;
  pull_request_url: string | null;
  pull_request_number: number | null;
};

/**
 * Per-source metadata bag returned by the backend. Optional flags scope a
 * source to a single blueprint workspace and mark legacy inline sources that
 * predate the repository-source model. Unscoped sources are repository-wide
 * only for the uploader.
 */
export type RepositorySourceMetadata = {
  project_scoped?: boolean;
  scoped_blueprint_id?: string | null;
  blueprint_id?: string | null;
  legacy?: boolean;
  [key: string]: unknown;
};

/**
 * A repository-level source file (paper, notes, PDF, …) tracked by the
 * backend alongside its derived artifacts (OCR, LaTeX, original).
 *
 * here is reconstructed from its consumers (source picker, upload modal,
 * blueprint page) and mirrors the backend's Pydantic source schema.
 */
export type RepositorySource = {
  id: string;
  display_name: string;
  source_type: string;
  status?: string;
  artifacts: string[];
  metadata?: RepositorySourceMetadata;
};

/**
 * List every registered repository (a local folder the user opened). The
 * backend does not scan folders for a lakefile here (discovery is deferred to
 * workspace creation), so every registered folder is returned.
 *
 * @return {Promise<{repositories: unknown[]}>} Repository list.
 */
export function fetchRepositories(): Promise<unknown> {
  return request('/repositories');
}

/**
 * The repository row the backend answers with after registering a folder.
 * `owner`/`name` are the route segments every other call is keyed on; the
 * shape otherwise matches the entries of {@link fetchRepositories}.
 */
export type RegisteredRepository = {
  id: number;
  owner: string;
  name: string;
  description?: string | null;
  updated_at?: string | null;
  visibility: string;
  weekly_commits?: number[];
  background_sessions?: unknown[];
  /** Absolute folder path, when the backend includes it. */
  path?: string;
};

/**
 * Register a local folder as a repository. Registering the same folder twice
 * returns the existing row, so callers can treat this as idempotent.
 *
 * @param {string} path Absolute path of the folder to open.
 * @return {Promise<RegisteredRepository>} The registered repository.
 */
export function registerRepository(path: string): Promise<RegisteredRepository> {
  return request<RegisteredRepository>('/repositories', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

/**
 * Forget a registered folder (desktop-only). Nothing on disk is touched, but
 * Fuse drops its record of the folder and of the workspaces it created there;
 * opening the folder again starts from scratch.
 *
 * @param {string} owner Repository owner.
 * @param {string} repo Repository name.
 */
export function unregisterRepository(owner: string, repo: string): Promise<void> {
  return request<null>(repoPath(owner, repo), { method: 'DELETE' }).then(() => undefined);
}

/**
 * Discover the Lean projects (lakefiles) in a repository's working tree.
 *
 * Backs the workspace-creation lakefile picker. An empty result means the
 * folder has no Lean project yet and the caller should offer to scaffold one.
 *
 * Desktop: a workspace always runs in the folder on its checked-out branch,
 * so `ref` is accepted for signature compatibility but never sent — listing
 * another branch would offer projects that do not exist in the tree the
 * workspace builds in.
 *
 * @param {string} owner Repository owner.
 * @param {string} repo Repository name.
 * @param {string} [_ref] Ignored; the working tree is always scanned.
 * @return {Promise<RepositoryLakefiles>} Discovered lakefiles.
 */
export function discoverLakefiles(
  owner: string,
  repo: string,
  _ref?: string,
): Promise<RepositoryLakefiles> {
  return request<RepositoryLakefiles>(`${repoPath(owner, repo)}/lakefiles`);
}

/** @return {Promise<Object[]>} Repositories with weekly commit activity. */
export function fetchRepositoryActivity(): Promise<unknown> {
  return request('/repositories/activity');
}

/** Poll lightweight background-session cards without re-listing folders. */
export function fetchRepositoryBackgroundSessions(): Promise<unknown> {
  return request('/repositories/background-sessions');
}

/**
 * @param {string} owner Repository owner.
 * @param {string} repo Repository name.
 * @return {Promise<{ default_branch: string, branches: string[] }>} Branch list
 *   used for blueprint creation.
 */
export function fetchRepositoryBranches(
  owner: string,
  repo: string,
): Promise<RepositoryBranches> {
  const path = `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`;
  return request(path) as Promise<RepositoryBranches>;
}

/**
 * Scaffold a Lean blueprint project into a registered folder.
 *
 * Used by the New Project wizard. The backend writes a minimal project
 * skeleton (lakefile, lean-toolchain, root module, Basic.lean) into the folder
 * and commits it on the current branch when the folder is a git repository.
 * Locally the result never carries a pull request: `pull_request_url` and
 * `pull_request_number` are always null.
 *
 * @param {string} owner Repository owner.
 * @param {string} repo Repository name.
 * @param {string} moduleName Lean module name to scaffold (e.g. "FLT").
 * @param {string} [leanVersion] Optional Lean release tag (e.g. "v4.13.0").
 *   When omitted, the scaffolded toolchain mirrors Mathlib's current pin.
 * @param {string} [targetSubdir] Optional repo-relative subfolder to scaffold
 *   into. When omitted, the project lands at the repo root.
 * @param {string} [baseBranch] Branch the scaffold should land on (carried
 *   from the New Workspace flow); defaults to the current branch.
 * @return {Promise<RepositorySetupResult>} The target branch and subfolder.
 */
export function setupRepository(
  owner: string,
  repo: string,
  moduleName: string,
  leanVersion?: string,
  targetSubdir?: string,
  baseBranch?: string,
): Promise<RepositorySetupResult> {
  const path = `${repoPath(owner, repo)}/setup`;
  const body: Record<string, string> = { module_name: moduleName };
  if (leanVersion) body.lean_version = leanVersion;
  if (targetSubdir) body.target_subdir = targetSubdir;
  if (baseBranch) body.base_branch = baseBranch;
  return request<RepositorySetupResult>(
    path,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
}

/**
 * @param {string} owner Repository owner.
 * @param {string} repo Repository name.
 * @return {Promise<Object>} Repository details.
 */
export function fetchRepository(owner: string, repo: string): Promise<unknown> {
  return request(`/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
}

/**
 * @param {string} owner Repository owner.
 * @param {string} repo Repository name.
 * @return {Promise<Object[]>} List of pull requests. There is no hosting
 *   service behind a local folder, so the backend always answers `[]`; the
 *   call stays so the repository page and merged-status hook are unchanged.
 */
export function fetchPullRequests(owner: string, repo: string): Promise<unknown> {
  return request(`/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pull-requests`);
}

/**
 * List sources visible in a blueprint context. The current user's
 * repository-wide sources are returned alongside sources owned by
 * `blueprintId`. Omit `blueprintId` to list only that user's repository-wide
 * sources.
 *
 * @param {string} owner Repository owner.
 * @param {string} repo Repository name.
 * @param {string} [blueprintId] Current blueprint, for visibility scoping.
 * @return {Promise<{sources: RepositorySource[]}>} Visible sources.
 */
export function fetchRepositorySources(
  owner: string,
  repo: string,
  blueprintId?: string,
): Promise<{ sources: RepositorySource[] }> {
  const base = `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/sources`;
  const path = blueprintId
    ? `${base}?blueprint_id=${encodeURIComponent(blueprintId)}`
    : base;
  return request(path) as Promise<{ sources: RepositorySource[] }>;
}

/**
 * One attachable file in the workspace folder.
 */
export type RepositoryFileEntry = {
  path: string;
  name: string;
  size: number;
};

/**
 * Workspace file listing for the chat attachment picker.
 *
 * `clone_ready: false` (with no files) means the workspace folder is not
 * readable yet; the picker should say so instead of "no matches".
 */
export type RepositoryFilesResponse = {
  files: RepositoryFileEntry[];
  truncated: boolean;
  clone_ready: boolean;
};

/**
 * List the workspace folder's files for the chat attachment picker.
 *
 * @param {string} owner Repository owner.
 * @param {string} repo Repository name.
 * @param {string} blueprintName The blueprint whose workspace to list.
 * @return {Promise<RepositoryFilesResponse>} Attachable repo files.
 */
export function fetchRepositoryFiles(
  owner: string,
  repo: string,
  blueprintName: string,
): Promise<RepositoryFilesResponse> {
  const path = `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    + `/repo-files?blueprint_name=${encodeURIComponent(blueprintName)}`;
  return request(path) as Promise<RepositoryFilesResponse>;
}

/** Fetch only the immediate children of a folder for the Files rail. */
export function fetchRepositoryDirectory(owner: string, repo: string, blueprintName: string, directory: string, signal?: AbortSignal): Promise<RepositoryFilesResponse & { directories: string[] }> {
  return request(`/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blueprints/${encodeURIComponent(blueprintName)}/directory?path=${encodeURIComponent(directory)}`, { signal });
}

/**
 * Delete one repository-level source and its backend-owned artifacts.
 *
 * @param {string} [blueprintId] Current blueprint; required to delete a
 *   workspace source, which is only visible in its own context.
 */
export function deleteRepositorySource(
  owner: string,
  repo: string,
  sourceId: string,
  blueprintId?: string,
): Promise<unknown> {
  const base = `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    + `/sources/${encodeURIComponent(sourceId)}`;
  const path = blueprintId
    ? `${base}?blueprint_id=${encodeURIComponent(blueprintId)}`
    : base;
  return request(path, { method: 'DELETE' });
}

/**
 * Options for {@link uploadRepositorySource}.
 *
 * @property displayName Optional user-chosen label; falls back to the
 *   file's own name server-side when omitted or blank.
 * @property projectScoped When true, the source is private to
 *   {@link UploadSourceOptions.blueprintId}; otherwise it is available in the
 *   uploader's workspaces throughout this repository.
 * @property blueprintId The blueprint the source belongs to; required when
 *   {@link UploadSourceOptions.projectScoped} is set.
 */
export type UploadSourceOptions = {
  displayName?: string;
  projectScoped?: boolean;
  blueprintId?: string;
};

/**
 * Upload one repository-level source file.
 */
export function uploadRepositorySource(
  owner: string,
  repo: string,
  file: File,
  options: UploadSourceOptions = {},
): Promise<RepositorySource> {
  const path = `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/sources`;
  const formData = new FormData();
  formData.append('file', file);
  const trimmedName = options.displayName?.trim();
  if (trimmedName) formData.append('display_name', trimmedName);
  if (options.projectScoped) {
    formData.append('project_scoped', 'true');
    if (options.blueprintId) formData.append('blueprint_id', options.blueprintId);
  }
  return fetchApi(path, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  }) as Promise<RepositorySource>;
}

/** Copy one supported workspace repository file into managed Sources. */
export function importRepositorySource(
  owner: string,
  repo: string,
  blueprintId: string,
  repoPath: string,
): Promise<RepositorySource> {
  const path = `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    + '/sources/import';
  return fetchApi(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blueprint_id: blueprintId, repo_path: repoPath }),
    workspaceRuntimeIdentity: {
      owner,
      repository: repo,
      blueprint: blueprintId,
    },
  }) as Promise<RepositorySource>;
}
