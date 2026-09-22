/**
 * Git tab reads: commit list and commit detail. Runs against ``HEAD`` of the
 * user's folder (the web reads ``origin/numina/<name>``; a local app must
 * show unpushed commits).
 */

import type { BlueprintCommit, BlueprintCommitDetail } from '@shared/api-types';
import { GitError, runGit } from './run';
import { isValidCommitSha } from './pathspecs';
import { avatarUrlForLogin, DEFAULT_MAX_PATCH_BYTES, deriveGithubLogin, LOG_FORMAT, parseCommitPatch, parseLogEntry, type CommitInfo } from './parse';
import type { GithubRemote } from './status';

export interface HistoryOptions {
  /** When the folder's origin is a GitHub repository, commits get click-through URLs. */
  github?: GithubRemote | null;
}

function toCommit(info: CommitInfo, github: GithubRemote | null | undefined): BlueprintCommit {
  const login = deriveGithubLogin(info.authorName, info.authorEmail);
  return {
    sha: info.sha,
    message: info.message,
    author_name: info.authorName,
    author_login: login,
    author_avatar_url: avatarUrlForLogin(login),
    authored_at: info.authoredAt,
    html_url: github ? `https://github.com/${github.owner}/${github.name}/commit/${info.sha}` : null,
  };
}

/**
 * Up to ``limit`` commits reachable from ``ref``. A missing ref (no commits
 * yet) yields an empty list rather than an error.
 */
export async function listCommits(cwd: string, ref: string, limit: number, options: HistoryOptions = {}): Promise<BlueprintCommit[]> {
  if (!Number.isInteger(limit) || limit <= 0) throw new RangeError('limit must be a positive integer');
  if (!ref || ref.startsWith('-') || ref.includes('\0')) throw new RangeError('reference must be a non-option string without NUL');
  let output: string;
  try {
    output = await runGit(['log', ref, `-n${limit}`, '-z', `--pretty=format:${LOG_FORMAT}`], { cwd });
  } catch (error) {
    if (error instanceof GitError) return [];
    throw error;
  }
  const commits: BlueprintCommit[] = [];
  for (const raw of output.split('\0')) {
    const info = parseLogEntry(raw);
    if (info) commits.push(toCommit(info, options.github));
  }
  return commits;
}

/** One commit's metadata and bounded per-file patches; null when unavailable. */
export async function commitDetail(cwd: string, sha: string, options: HistoryOptions = {}): Promise<BlueprintCommitDetail | null> {
  if (!isValidCommitSha(sha)) return null;
  let metadata: string;
  let patch: string;
  try {
    metadata = await runGit(['show', '--no-patch', `--pretty=format:${LOG_FORMAT}`, sha], { cwd });
    patch = await runGit(['show', '--no-color', '--format=', sha], { cwd });
  } catch (error) {
    if (error instanceof GitError) return null;
    throw error;
  }
  const info = parseLogEntry(metadata);
  if (!info) return null;
  return { ...toCommit(info, options.github), files: parseCommitPatch(patch, DEFAULT_MAX_PATCH_BYTES) };
}
