/**
 * Blueprint API helpers: reading blueprint data and chapters, editing
 * and committing content, branch sync, git history and diffs, settings,
 * creation, deletion, and PDF preflight.
 */

import { fetchApi, request } from '@/lib/api/core';
import type { RepositoryBlueprintFile } from '@/lib/api/repositories';
import type {
  ClaudePermissionMode,
  CodexSandboxMode,
  EffortLevel,
  ProviderId,
} from '@shared/agent-events';

/**
 * @param {string} owner Repository owner.
 * @param {string} repo Repository name.
 * @return {Promise<Object[]>} List of blueprint summaries.
 */
export function fetchBlueprints(owner: string, repo: string): Promise<unknown> {
  return request(`/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blueprints`);
}

/**
 * @param {string} owner Repository owner.
 * @param {string} repo Repository name.
 * @param {string} name Blueprint identifier.
 * @return {Promise<Object>} Full blueprint data with entries.
 */
export function fetchBlueprint(owner: string, repo: string, name: string): Promise<unknown> {
  return request(
    `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blueprints/${encodeURIComponent(name)}`,
    {
      timeoutMs: 20000,
      timeoutMessage: 'Blueprint loading is taking longer than expected. Please try again.',
    },
  );
}

/**
 * Live branch facts for the Git view: the checked-out branch (the desktop works
 * directly on the user's branch, not on a ``numina/<id>`` branch) and whether
 * the folder has a remote to sync with. Optional on the backend: callers treat
 * a failure as "unknown" and fall back to ``blueprint.branch_status``.
 */
export interface BlueprintBranchStatusResponse {
  /** Checked-out branch name, or null in a detached / non-git folder. */
  branch: string | null;
  /** Whether an ``origin`` remote exists (sync/push are only possible then). */
  has_remote: boolean;
  /** Same shape as ``BlueprintResponse.branch_status``; null without a remote. */
  status?: BlueprintBranchStatus | null;
}

export function fetchBlueprintBranchStatus(
  owner: string,
  repo: string,
  name: string,
): Promise<BlueprintBranchStatusResponse> {
  return request<BlueprintBranchStatusResponse>(
    `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    + `/blueprints/${encodeURIComponent(name)}/branch-status`,
  );
}

/**
 * @param {string} owner Repository owner.
 * @param {string} repo Repository name.
 * @param {string} name Blueprint identifier.
 * @return {Promise<{status: string}>} Persisted Lean build status.
 */
export function fetchBlueprintBuildStatus(
  owner: string,
  repo: string,
  name: string,
): Promise<unknown> {
  return request(
    `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    + `/blueprints/${encodeURIComponent(name)}/build-status`,
  );
}

/**
 * Persist a LaTeX edit to the blueprint's clone on disk.
 * @param {string} owner Repository owner.
 * @param {string} repo Repository name.
 * @param {string} name Blueprint identifier.
 * @param {string} latexSource Updated LaTeX content.
 * @return {Promise<null>} Resolves on success (204).
 */
export function updateBlueprintContent(owner: string, repo: string, name: string, latexSource: string): Promise<unknown> {
  const path = `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blueprints/${encodeURIComponent(name)}/content`;
  return request(path, {
    method: 'PUT',
    body: JSON.stringify({ latex_source: latexSource }),
  });
}

export type BlueprintChapterContent = {
  path: string;
  content: string;
};

/**
 * Fetch the raw .tex content for one of a blueprint's included chapter files.
 * The chapter path must be in the blueprint's included_files list (the
 * entrypoint plus everything reachable via \input / \include).
 */
export function fetchBlueprintChapter(
  owner: string,
  repo: string,
  name: string,
  chapterPath: string,
): Promise<BlueprintChapterContent> {
  const params = new URLSearchParams({ path: chapterPath });
  const path = `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    + `/blueprints/${encodeURIComponent(name)}/chapter?${params.toString()}`;
  return request(path) as Promise<BlueprintChapterContent>;
}

/**
 * Persist an edit to one of a blueprint's chapter files.
 * The chapter path must be in the blueprint's included_files list.
 */
export function updateBlueprintChapter(
  owner: string,
  repo: string,
  name: string,
  chapterPath: string,
  content: string,
): Promise<unknown> {
  const params = new URLSearchParams({ path: chapterPath });
  const path = `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    + `/blueprints/${encodeURIComponent(name)}/chapter?${params.toString()}`;
  return request(path, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
}

/**
 * Commit the current saved blueprint changes to the local branch.
 * @param {string} owner Repository owner.
 * @param {string} repo Repository name.
 * @param {string} name Blueprint identifier.
 * @param {string=} message Optional commit subject.
 * @return {Promise<Object>} Commit result.
 */
export function commitBlueprintChanges(
  owner: string,
  repo: string,
  name: string,
  message?: string,
): Promise<BlueprintCommitResult> {
  const path = `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blueprints/${encodeURIComponent(name)}/commit`;
  return request(path, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

export interface BlueprintCommitResult {
  status:
    | 'build_failed'
    | 'committed'
    | 'content_blocked'
    | 'no_changes'
    | 'push_failed'
    | 'verification_unavailable';
  commit_sha: string | null;
  message: string | null;
}

export interface BlueprintSyncResult {
  status: 'updated' | 'up_to_date';
  before_sha: string | null;
  after_sha: string | null;
}

export interface BranchFreshness {
  default_branch: string;
  base_sha: string | null;
  current_default_sha: string | null;
  commits_behind: number;
  is_stale: boolean;
}

/**
 * The local blueprint clone's relationship to its own remote branch
 * (distinct from BranchFreshness, which compares against the selected
 * PR target branch). `needs_reconcile` is true when the remote advanced outside
 * Fuse and the clone cannot cleanly fast-forward.
 */
export interface BlueprintBranchStatus {
  branch: string;
  is_dirty: boolean;
  commits_ahead: number;
  commits_behind: number;
  is_diverged: boolean;
  needs_reconcile: boolean;
}

export interface BlueprintMainSyncResult extends BlueprintSyncResult {
  freshness: BranchFreshness | null;
}

/**
 * Fast-forward the workspace branch from its remote counterpart. The backend
 * answers 409 (with a human-readable detail) when the folder has no remote.
 */
export function syncBlueprintBranch(
  owner: string,
  repo: string,
  name: string,
): Promise<BlueprintSyncResult> {
  const path = `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blueprints/${encodeURIComponent(name)}/sync`;
  return request(path, { method: 'POST' }) as Promise<BlueprintSyncResult>;
}

/**
 * Merge the repository default branch into the blueprint branch.
 */
export function syncBlueprintFromMain(
  owner: string,
  repo: string,
  name: string,
): Promise<BlueprintMainSyncResult> {
  const path = `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blueprints/${encodeURIComponent(name)}/sync-main`;
  return request(path, { method: 'POST' }) as Promise<BlueprintMainSyncResult>;
}

export interface BlueprintCommit {
  sha: string;
  message: string;
  author_name: string | null;
  author_login: string | null;
  author_avatar_url: string | null;
  authored_at: string | null;
  html_url: string | null;
}

/**
 * Fetch the commit history of the workspace's checked-out branch. Returns an
 * empty list when the folder has no commits yet.
 *
 * @param {string} owner Repository owner.
 * @param {string} repo Repository name.
 * @param {string} name Blueprint identifier.
 * @param {number=} limit Maximum number of commits (1-100, default 50).
 * @return {Promise<{commits: BlueprintCommit[]}>}
 */
export function fetchBlueprintCommits(
  owner: string,
  repo: string,
  name: string,
  limit = 50,
): Promise<{ commits: BlueprintCommit[] }> {
  const path = `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    + `/blueprints/${encodeURIComponent(name)}/commits?limit=${limit}`;
  return request(path) as Promise<{ commits: BlueprintCommit[] }>;
}

export type BlueprintDiffStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked';

export interface BlueprintDiffFile {
  path: string;
  status: BlueprintDiffStatus;
  old_path: string | null;
  additions: number;
  deletions: number;
  diff: string | null;
  truncated: boolean;
  binary: boolean;
}

/**
 * Fetch per-file diffs of the blueprint working tree against HEAD.
 * Used by the Git tab's Changes view to preview a pending commit.
 *
 * @param {string} owner Repository owner.
 * @param {string} repo Repository name.
 * @param {string} name Blueprint identifier.
 * @return {Promise<{files: BlueprintDiffFile[]}>}
 */
export function fetchBlueprintDiff(
  owner: string,
  repo: string,
  name: string,
): Promise<{ files: BlueprintDiffFile[] }> {
  const path = `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    + `/blueprints/${encodeURIComponent(name)}/diff`;
  return request(path) as Promise<{ files: BlueprintDiffFile[] }>;
}

export interface BlueprintCommitDetailFile {
  path: string;
  status: string;
  old_path: string | null;
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface BlueprintCommitDetail {
  sha: string;
  message: string;
  author_name: string | null;
  author_login: string | null;
  author_avatar_url: string | null;
  authored_at: string | null;
  html_url: string | null;
  files: BlueprintCommitDetailFile[];
}

/**
 * Fetch one commit's metadata + per-file patches. Used by the Git
 * tab's History view when a commit is selected.
 */
export function fetchBlueprintCommit(
  owner: string,
  repo: string,
  name: string,
  sha: string,
): Promise<BlueprintCommitDetail> {
  const path = `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    + `/blueprints/${encodeURIComponent(name)}/commits/${encodeURIComponent(sha)}`;
  return request(path) as Promise<BlueprintCommitDetail>;
}

/**
 * Per-workspace agent configuration: which CLI runs the chat and how it is
 * launched. Stored on the workspace row and echoed back in the blueprint
 * payload as ``agent``.
 */
export interface BlueprintAgentConfig {
  provider: ProviderId;
  /** '' means the CLI's own default model. */
  model: string;
  effort: EffortLevel | null;
  claude_permission_mode: ClaudePermissionMode;
  codex_sandbox: CodexSandboxMode;
}

export const DEFAULT_BLUEPRINT_AGENT_CONFIG: BlueprintAgentConfig = {
  provider: 'claude',
  model: '',
  effort: null,
  claude_permission_mode: 'acceptEdits',
  codex_sandbox: 'workspace-write',
};

/** Fields ``PATCH …/settings`` accepts; anything omitted is left unchanged. */
export interface BlueprintSettingsUpdate {
  title?: string;
  description?: string;
  pr_mode?: 'off' | 'draft' | 'ready';
  auto_commit?: boolean;
  orchestrator_child_concurrency?: number;
  /** Desktop-only: the CLI agent configuration for this workspace. */
  agent?: BlueprintAgentConfig;
}

export function setBlueprintLeanProject(owner: string, repo: string, name: string, lakefile: string): Promise<{ project_subdir: string }> {
  return request(`/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blueprints/${encodeURIComponent(name)}/lean-project`, {
    method: 'PUT', body: JSON.stringify({ lakefile }),
  });
}

export interface BlueprintSettingsResponse {
  name: string;
  description: string;
  pr_mode: 'off' | 'draft' | 'ready';
  auto_commit: boolean;
  orchestrator_child_concurrency: number;
  pr_number: number | null;
  pr_error: string | null;
  pushed: boolean;
  /** Echoed when the backend stores agent settings. */
  agent?: BlueprintAgentConfig;
}

/**
 * Patch editable blueprint settings (name, description, auto-commit, agent).
 *
 * Any field omitted from ``body`` is left unchanged.
 *
 * @param {string} owner Repository owner.
 * @param {string} repo Repository name.
 * @param {string} name Blueprint identifier.
 * @param {Object} body Fields to update.
 * @return {Promise<Object>} The updated settings echoed back by the server.
 */
export function updateBlueprintSettings(
  owner: string,
  repo: string,
  name: string,
  body: BlueprintSettingsUpdate,
): Promise<unknown> {
  const path = `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blueprints/${encodeURIComponent(name)}/settings`;
  return request(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/**
 * Point a blueprint at an existing ``.tex`` entrypoint in the repository.
 *
 * Adopts an existing leanblueprint from inside the workspace: records the
 * chosen repo-relative ``.tex`` as the blueprint's entrypoint, re-parses the
 * include chain, and re-mirrors the live editor to that file's content.
 *
 * @param {string} owner Repository owner.
 * @param {string} repo Repository name.
 * @param {string} name Blueprint identifier.
 * @param {string} blueprintFile Repo-relative ``.tex`` entrypoint path.
 * @return {Promise<{blueprint_file: string, included_files: string[],
 *   entry_count: number}>} The refreshed source summary.
 */
export function setBlueprintSourceFile(
  owner: string,
  repo: string,
  name: string,
  blueprintFile: string,
): Promise<{ blueprint_file: string; included_files: string[]; entry_count: number }> {
  const path = `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blueprints/${encodeURIComponent(name)}/source-file`;
  return request(path, {
    method: 'PUT',
    body: JSON.stringify({ blueprint_file: blueprintFile }),
  }) as Promise<{ blueprint_file: string; included_files: string[]; entry_count: number }>;
}

/**
 * List leanblueprint ``.tex`` entrypoints present in this workspace's clone.
 *
 * Scans the workspace's own working tree — the same place the adopt endpoint
 * validates against — so every candidate it returns can actually be adopted.
 *
 * @param {string} owner Repository owner.
 * @param {string} repo Repository name.
 * @param {string} name Blueprint identifier.
 * @return {Promise<{files: RepositoryBlueprintFile[]}>} Candidate entrypoints.
 */
export function fetchWorkspaceBlueprintCandidates(
  owner: string,
  repo: string,
  name: string,
): Promise<{ files: RepositoryBlueprintFile[] }> {
  const path = `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blueprints/${encodeURIComponent(name)}/source-candidates`;
  return request(path) as Promise<{ files: RepositoryBlueprintFile[] }>;
}

/**
 * Create a new blueprint for a workspace that has none.
 *
 * Writes a starter ``blueprint/src/content.tex`` (or adopts the repo's own
 * if it already ships one), records it as the entrypoint, and mirrors the
 * editor. The workspace then has a blueprint to edit or ask Fuse to draft.
 *
 * @param {string} owner Repository owner.
 * @param {string} repo Repository name.
 * @param {string} name Blueprint identifier.
 * @return {Promise<{blueprint_file: string, included_files: string[],
 *   entry_count: number}>} The new blueprint's source summary.
 */
export function createBlueprint(
  owner: string,
  repo: string,
  name: string,
): Promise<{ blueprint_file: string; included_files: string[]; entry_count: number }> {
  const path = `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blueprints/${encodeURIComponent(name)}/create-blueprint`;
  return request(path, {
    method: 'POST',
  }) as Promise<{ blueprint_file: string; included_files: string[]; entry_count: number }>;
}

/**
 * Delete a blueprint and all associated data.
 * @param {string} owner Repository owner.
 * @param {string} repo Repository name.
 * @param {string} name Blueprint identifier.
 * @return {Promise<null>} Resolves on success (204).
 */
export function deleteBlueprint(owner: string, repo: string, name: string): Promise<unknown> {
  const path = `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blueprints/${encodeURIComponent(name)}`;
  return request(path, { method: 'DELETE' });
}

/**
 * Create a new workspace (branch + metadata row) via multipart form upload.
 *
 * This does not write a blueprint file; it creates the working branch and
 * backend metadata. The blueprint .tex is created later via createBlueprint.
 * @param {string} owner Repository owner.
 * @param {string} repo Repository name.
 * @param {FormData} formData Form data with title, latex_content, and optional file.
 * @return {Promise<Object>} Created workspace response.
 */
export async function createWorkspace(owner: string, repo: string, formData: FormData): Promise<unknown> {
  const path = `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blueprints/create-workspace`;
  return fetchApi(path, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
}

/**
 * Return the page count of a PDF file before uploading it as a blueprint.
 * @param {string} owner Repository owner.
 * @param {string} repo Repository name.
 * @param {File} file The PDF file to inspect.
 * @return {Promise<{page_count: number}>} Page count response.
 */
export async function getPdfInfo(owner: string, repo: string, file: File): Promise<{ page_count: number }> {
  const path = `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blueprints/pdf-info`;
  const formData = new FormData();
  formData.append('file', file);
  return fetchApi(path, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  }) as Promise<{ page_count: number }>;
}
