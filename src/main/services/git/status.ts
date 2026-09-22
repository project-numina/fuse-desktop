/**
 * Read-only probes on a repository folder: is it a git repo, which branch is
 * checked out, which content paths are dirty, remotes and default branch,
 * and the identity commits should carry.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { GitError, runGit, tryGit } from './run';
import { isSafeBranchName, LOCAL_GENERATED_PATHSPECS } from './pathspecs';

export interface GitIdentity {
  name: string;
  email: string;
}

/** Author and committer of agent autocommits; the ``[bot]`` suffix drives the UI badge. */
export const BOT_NAME = 'fuse-desktop[bot]';
export const BOT_EMAIL = 'fuse-desktop[bot]@users.noreply.github.com';
export const BOT_IDENTITY: GitIdentity = { name: BOT_NAME, email: BOT_EMAIL };

/** Used for human commits when git has no ``user.name`` / ``user.email``. */
export const FALLBACK_IDENTITY: GitIdentity = { name: 'Fuse Desktop', email: 'fuse-desktop@localhost' };

export async function isGitRepository(cwd: string): Promise<boolean> {
  if (!existsSync(cwd)) return false;
  const output = await tryGit(['rev-parse', '--is-inside-work-tree'], { cwd });
  return output === 'true';
}

/** True once the repository has at least one commit. */
export async function hasHead(cwd: string): Promise<boolean> {
  return (await tryGit(['rev-parse', '--verify', 'HEAD'], { cwd })) !== null;
}

export async function revParseHead(cwd: string): Promise<string | null> {
  const output = await tryGit(['rev-parse', 'HEAD'], { cwd });
  return output?.trim() || null;
}

/** The checked-out branch, or null when detached / not a repository. */
export async function currentBranch(cwd: string): Promise<string | null> {
  const output = await tryGit(['symbolic-ref', '--short', '-q', 'HEAD'], { cwd });
  const branch = output?.trim() ?? '';
  return branch || null;
}

/**
 * Content paths with uncommitted changes (porcelain v1 scoped to the
 * generated-path policy). Non-empty means the working tree is dirty.
 */
export async function dirtyContentPaths(cwd: string): Promise<string[]> {
  const output = await runGit(['status', '--porcelain', '--', ...LOCAL_GENERATED_PATHSPECS], { cwd });
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => (line.length > 3 ? line.slice(3) : line.trim()));
}

export async function hasRemote(cwd: string, remote = 'origin'): Promise<boolean> {
  return (await tryGit(['remote', 'get-url', remote], { cwd })) !== null;
}

export async function remoteUrl(cwd: string, remote = 'origin'): Promise<string | null> {
  const output = await tryGit(['remote', 'get-url', remote], { cwd });
  return output?.trim() || null;
}

export interface GithubRemote {
  owner: string;
  name: string;
}

/** ``owner/name`` when the origin URL points at github.com, else null. */
export function parseGithubRemote(url: string | null): GithubRemote | null {
  if (!url) return null;
  const match = /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(url.trim());
  if (!match) return null;
  return { owner: match[1], name: match[2] };
}

export async function githubRemote(cwd: string): Promise<GithubRemote | null> {
  return parseGithubRemote(await remoteUrl(cwd));
}

export async function refExists(cwd: string, ref: string): Promise<boolean> {
  return (await tryGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd })) !== null;
}

/** ``refs/remotes/<remote>/<branch>`` is present locally. */
export async function remoteRefExists(cwd: string, branch: string, remote = 'origin'): Promise<boolean> {
  if (!isSafeBranchName(branch)) return false;
  return refExists(cwd, `refs/remotes/${remote}/${branch}`);
}

export async function localBranchExists(cwd: string, branch: string): Promise<boolean> {
  if (!isSafeBranchName(branch)) return false;
  return (await tryGit(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd })) !== null;
}

/** The branch ``HEAD`` tracks (``origin/main``), or null when none is configured. */
export async function upstreamRef(cwd: string): Promise<string | null> {
  const output = await tryGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { cwd });
  return output?.trim() || null;
}

/** Local commits ahead of ``remote/branch``; null when that cannot be determined. */
export async function countUnpushedCommits(cwd: string, branch: string, remote = 'origin'): Promise<number | null> {
  if (!isSafeBranchName(branch) || !remote || remote.startsWith('-')) return null;
  const output = await tryGit(['rev-list', `${remote}/${branch}..HEAD`, '--count'], { cwd });
  if (output === null) return null;
  const count = Number.parseInt(output.trim(), 10);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

/** ``git rev-list --left-right --count HEAD...<ref>`` as ``[ahead, behind]``. */
export async function aheadBehind(cwd: string, ref: string): Promise<[number, number] | null> {
  const output = await tryGit(['rev-list', '--left-right', '--count', `HEAD...${ref}`], { cwd });
  if (output === null) return null;
  const [ahead, behind] = output.trim().split(/\s+/).map((value) => Number.parseInt(value, 10));
  if (!Number.isInteger(ahead) || !Number.isInteger(behind)) return null;
  return [ahead, behind];
}

export async function listLocalBranches(cwd: string): Promise<string[]> {
  const output = await tryGit(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], { cwd });
  if (output === null) return [];
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** ``origin/HEAD`` as a short branch name when the ref is present locally. */
export async function resolveLocalDefaultBranch(cwd: string, remote = 'origin'): Promise<string | null> {
  const output = await tryGit(['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`], { cwd });
  if (output === null) return null;
  const prefix = `${remote}/`;
  const remoteRef = output.trim();
  if (!remoteRef.startsWith(prefix)) return null;
  const branch = remoteRef.slice(prefix.length);
  if (!isSafeBranchName(branch)) return null;
  return (await remoteRefExists(cwd, branch, remote)) ? branch : null;
}

const defaultBranchCache = new Map<string, string | null>();

/**
 * The repository's default branch: ``origin/HEAD``, else a one-time
 * ``ls-remote --symref`` (5 s), else ``init.defaultBranch``, ``main``,
 * ``master``, else the current branch. The network probe is cached per
 * folder for the process lifetime so blueprint opens stay fast.
 */
export async function resolveDefaultBranch(cwd: string): Promise<string | null> {
  const local = await resolveLocalDefaultBranch(cwd);
  if (local) return local;
  if (await hasRemote(cwd)) {
    if (!defaultBranchCache.has(cwd)) {
      let resolved: string | null = null;
      try {
        const output = await runGit(['ls-remote', '--symref', 'origin', 'HEAD'], { cwd, timeoutMs: 5_000 });
        for (const line of output.split(/\r?\n/)) {
          const [reference, target] = line.split('\t');
          if (target === 'HEAD' && reference?.startsWith('ref: refs/heads/')) {
            const candidate = reference.slice('ref: refs/heads/'.length).trim();
            if (isSafeBranchName(candidate)) resolved = candidate;
          }
        }
      } catch (error) {
        if (!(error instanceof GitError)) throw error;
      }
      if (resolved) await tryGit(['remote', 'set-head', 'origin', resolved], { cwd });
      defaultBranchCache.set(cwd, resolved);
    }
    const cached = defaultBranchCache.get(cwd) ?? null;
    if (cached) return cached;
  }
  const configured = (await tryGit(['config', '--get', 'init.defaultBranch'], { cwd }))?.trim();
  if (configured && (await localBranchExists(cwd, configured))) return configured;
  for (const candidate of ['main', 'master']) {
    if (await localBranchExists(cwd, candidate)) return candidate;
  }
  return currentBranch(cwd);
}

/** Test hook: forget cached ``ls-remote`` results. */
export function resetDefaultBranchCache(): void {
  defaultBranchCache.clear();
}

/** Remove characters that make git's ``Name <email>`` ident ambiguous. */
export function cleanAuthorName(value: string): string {
  return value.replace(/[<>]/g, '').replace(/[\r\n]/g, ' ').split(/\s+/).filter(Boolean).join(' ');
}

/**
 * The identity human commits should carry: the folder's (or global) git
 * identity, else ``displayName`` from settings, else the Fuse fallback.
 */
export async function currentGitIdentity(cwd: string, displayName = ''): Promise<{ identity: GitIdentity; configured: boolean }> {
  const name = cleanAuthorName((await tryGit(['config', '--get', 'user.name'], { cwd })) ?? '');
  const email = ((await tryGit(['config', '--get', 'user.email'], { cwd })) ?? '').trim();
  if (name && email) return { identity: { name, email }, configured: true };
  const fallbackName = name || cleanAuthorName(displayName) || FALLBACK_IDENTITY.name;
  return { identity: { name: fallbackName, email: email || FALLBACK_IDENTITY.email }, configured: false };
}

/** MERGE_HEAD / rebase / cherry-pick / revert in progress. */
export async function gitOperationInProgress(cwd: string): Promise<boolean> {
  const gitDir = (await tryGit(['rev-parse', '--absolute-git-dir'], { cwd }))?.trim();
  if (!gitDir) return false;
  return ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'].some((marker) => existsSync(join(gitDir, marker)));
}

/** Repo-relative paths that still have unmerged index entries. */
export async function conflictedPaths(cwd: string): Promise<string[]> {
  const output = await tryGit(['diff', '--name-only', '--diff-filter=U'], { cwd });
  if (output === null) return [];
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
