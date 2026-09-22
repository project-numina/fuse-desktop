/**
 * Branch synchronisation and the two read-only probes the blueprint page
 * shows: freshness against the default branch and status against the
 * branch's own remote. Without an ``origin`` remote everything degrades to
 * ``up_to_date`` / zeros instead of failing.
 */

import type { BlueprintBranchStatus, BlueprintMainSyncResult, BlueprintSyncResult, BranchFreshness } from '@shared/api-types';
import { HttpError } from '../../store/registry';
import { GitError, runGit, tryGit } from './run';
import { isSafeBranchName } from './pathspecs';
import { pushCurrentBranch, rememberUnpushedCommit, requireNoUnresolvedMerge, resolveCommitValidator, type CommitValidator } from './commit';
import { withRepositoryLock } from './lock';
import {
  currentBranch,
  currentGitIdentity,
  dirtyContentPaths,
  hasRemote,
  localBranchExists,
  refExists,
  remoteRefExists,
  resolveDefaultBranch,
  revParseHead,
  type GitIdentity,
} from './status';

function conflict(detail: string): HttpError {
  return new HttpError(409, detail, 'http_409');
}

/**
 * Fast-forward the checked-out branch from ``origin/<branch>``
 * (``POST .../sync``). Rejects a dirty tree, an unresolved merge or
 * unpushed commits with 409. Serialised with commits on the same folder.
 */
export function syncBranch(cwd: string, branch: string): Promise<BlueprintSyncResult> {
  return withRepositoryLock(cwd, () => syncBranchLocked(cwd, branch));
}

async function syncBranchLocked(cwd: string, branch: string): Promise<BlueprintSyncResult> {
  if (!isSafeBranchName(branch)) throw new HttpError(400, 'Invalid branch name', 'http_400');
  const head = await revParseHead(cwd);
  if (!(await hasRemote(cwd))) return { status: 'up_to_date', before_sha: head, after_sha: head };
  await requireNoUnresolvedMerge(cwd);
  if ((await dirtyContentPaths(cwd)).length > 0) {
    throw conflict('Commit or discard local changes before syncing from GitHub.');
  }
  try {
    await runGit(['fetch', 'origin', branch], { cwd, timeoutMs: 120_000 });
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    if (/couldn't find remote ref/i.test(error.message)) throw conflict(`${branch} has not been pushed yet.`);
    throw conflict(`Could not sync ${branch} from origin.`);
  }
  if (!(await remoteRefExists(cwd, branch))) throw conflict(`${branch} has not been pushed yet.`);
  try {
    await runGit(['pull', '--ff-only', 'origin', branch], { cwd, timeoutMs: 120_000 });
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    throw conflict(`Could not sync ${branch} from origin.`);
  }
  const after = await revParseHead(cwd);
  const ahead = await tryGit(['rev-list', '--count', `origin/${branch}..HEAD`], { cwd });
  if (ahead !== null && Number.parseInt(ahead.trim(), 10) > 0) {
    throw conflict('Local checkout has unpushed commits; commit and push them before syncing.');
  }
  return { status: head === after ? 'up_to_date' : 'updated', before_sha: head, after_sha: after };
}

export interface SyncFromMainOptions {
  /** Explicit upstream branch; defaults to the repository default branch. */
  base?: string | null;
  /** Committer of the merge commit; defaults to the folder's git identity. */
  identity?: GitIdentity;
  /** Post-merge validation (cached Lean errors); a failure rolls the merge back. */
  validate?: boolean | CommitValidator | null;
}

/**
 * Merge the default branch into the checked-out branch
 * (``POST .../sync-main``). With a remote, ``origin/<base>`` is fetched
 * first; offline the local ``<base>`` branch is merged. When the checked
 * out branch *is* the target (the usual desktop case: the workspace sits
 * on ``main``) the action fast-forwards it from ``origin/<base>`` instead,
 * so the Git tab's "Sync main" does what its stale label promises.
 */
export function syncFromMain(cwd: string, optionsOrBase: SyncFromMainOptions | string | null = {}): Promise<BlueprintMainSyncResult> {
  return withRepositoryLock(cwd, () => syncFromMainLocked(cwd, optionsOrBase));
}

async function syncFromMainLocked(cwd: string, optionsOrBase: SyncFromMainOptions | string | null): Promise<BlueprintMainSyncResult> {
  const options: SyncFromMainOptions = typeof optionsOrBase === 'string' || optionsOrBase === null ? { base: optionsOrBase } : optionsOrBase;
  const identity = options.identity ?? (await currentGitIdentity(cwd)).identity;
  const branch = await currentBranch(cwd);
  if (!branch) throw conflict('The repository is not on a branch; check out a branch before syncing.');
  const explicit = (options.base ?? '').trim();
  if (explicit && !isSafeBranchName(explicit)) throw new HttpError(403, `Branch ${explicit} is not available for merging.`, 'http_403');
  const base = explicit || (await resolveDefaultBranch(cwd));
  if (!base) throw conflict('Could not resolve the repository default branch.');
  await requireNoUnresolvedMerge(cwd);
  if ((await dirtyContentPaths(cwd)).length > 0) {
    throw conflict('Commit or discard local changes before syncing from the target branch.');
  }
  const before = await revParseHead(cwd);
  if (base === branch) {
    if (!(await hasRemote(cwd))) {
      return { status: 'up_to_date', before_sha: before, after_sha: before, freshness: await branchFreshness(cwd, base) };
    }
    const synced = await syncBranchLocked(cwd, branch);
    return { ...synced, freshness: await branchFreshness(cwd, base) };
  }
  let targetRef: string;
  if (await hasRemote(cwd)) {
    try {
      await runGit(['fetch', 'origin', base], { cwd, timeoutMs: 120_000 });
    } catch (error) {
      if (!(error instanceof GitError)) throw error;
      if (!(await remoteRefExists(cwd, base))) {
        if (!(await localBranchExists(cwd, base))) {
          throw conflict(`Could not fetch target branch ${base}. It may have been deleted on the remote.`);
        }
      }
    }
    targetRef = (await remoteRefExists(cwd, base)) ? `origin/${base}` : base;
  } else {
    targetRef = base;
  }
  if (explicit && !(await refExists(cwd, targetRef))) {
    throw new HttpError(403, `Branch ${explicit} is not available for merging.`, 'http_403');
  }
  const targetCommit = (await tryGit(['rev-parse', '--verify', `${targetRef}^{commit}`], { cwd }))?.trim();
  if (!targetCommit) throw conflict(`Could not resolve the target branch ${base}.`);
  try {
    await runGit(['merge', '--no-edit', targetCommit], {
      cwd,
      configs: { 'user.name': identity.name, 'user.email': identity.email },
    });
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    await tryGit(['merge', '--abort'], { cwd });
    throw conflict(`Could not merge ${base} into ${branch}. Resolve conflicts locally, then retry.`);
  }
  let after = await revParseHead(cwd);
  const validator = resolveCommitValidator(options.validate);
  if (after !== before && validator) {
    let failure: Awaited<ReturnType<CommitValidator>>;
    try {
      failure = await validator(cwd);
    } catch {
      const undone = await undoMerge(cwd, before);
      throw conflict(`Lean verification could not run after merging the target branch; ${undone ? 'the merge was rolled back' : 'the merge could not be rolled back and is still checked out'}.`);
    }
    if (failure) {
      const undone = await undoMerge(cwd, before);
      throw conflict(`Lean validation blocked the target-branch merge: ${failure.message}${undone ? '' : ' (the merge could not be rolled back and is still checked out)'}`);
    }
  }
  if (after !== before) {
    // A failed push keeps the merge: the next commit on a clean tree retries
    // it; the branch status shows the branch as ahead meanwhile.
    const outcome = await pushCurrentBranch(cwd, { identity });
    after = await revParseHead(cwd);
    if (!outcome.pushed && (outcome.reason === 'rejected' || outcome.reason === 'error')) {
      rememberUnpushedCommit(cwd, after);
      if (outcome.message) console.warn(`[git] ${outcome.message}`);
    }
  }
  return {
    status: before === after ? 'up_to_date' : 'updated',
    before_sha: before,
    after_sha: after,
    freshness: await branchFreshness(cwd, base),
  };
}

/**
 * Undo a merge commit that was just created: ``git reset --merge`` reverts
 * only the paths the merge changed and keeps every uncommitted change the
 * merge did not touch (tracked ``.claude/`` or scratch files the dirty
 * probe ignores), where ``--hard`` would wipe them. False when git refused
 * because such a change overlaps the merge.
 */
export async function undoMerge(cwd: string, sha: string | null): Promise<boolean> {
  if (!sha) return false;
  return (await tryGit(['reset', '--merge', sha], { cwd })) !== null;
}

/**
 * How far ``HEAD`` is behind the default branch (``origin/<base>`` when that
 * ref exists locally, else the local branch). Null when no base resolves.
 */
export async function branchFreshness(cwd: string, base?: string | null): Promise<BranchFreshness | null> {
  const baseBranch = (base ?? '').trim() || (await resolveDefaultBranch(cwd));
  if (!baseBranch || !isSafeBranchName(baseBranch)) return null;
  const target = (await remoteRefExists(cwd, baseBranch)) ? `origin/${baseBranch}` : (await localBranchExists(cwd, baseBranch)) ? baseBranch : null;
  if (target === null) return null;
  const baseSha = (await tryGit(['merge-base', 'HEAD', target], { cwd }))?.trim() || null;
  const targetSha = (await tryGit(['rev-parse', target], { cwd }))?.trim() || null;
  const behindOutput = await tryGit(['rev-list', '--count', `HEAD..${target}`], { cwd });
  if (targetSha === null || behindOutput === null) return null;
  const commitsBehind = Number.parseInt(behindOutput.trim(), 10);
  if (!Number.isInteger(commitsBehind)) return null;
  return {
    default_branch: baseBranch,
    base_sha: baseSha,
    current_default_sha: targetSha,
    commits_behind: commitsBehind,
    is_stale: commitsBehind > 0,
  };
}

/**
 * The checked-out branch against its own remote branch. Without
 * ``origin/<branch>`` the counts are zero; the dirty flag is always real.
 */
export async function branchStatus(cwd: string, branch: string): Promise<BlueprintBranchStatus | null> {
  if (!isSafeBranchName(branch)) return null;
  let isDirty: boolean;
  try {
    isDirty = (await dirtyContentPaths(cwd)).length > 0;
  } catch {
    return null;
  }
  let ahead = 0;
  let behind = 0;
  if (await remoteRefExists(cwd, branch)) {
    const counts = await tryGit(['rev-list', '--left-right', '--count', `HEAD...origin/${branch}`], { cwd });
    if (counts === null) return null;
    const [left, right] = counts.trim().split(/\s+/).map((value) => Number.parseInt(value, 10));
    if (!Number.isInteger(left) || !Number.isInteger(right)) return null;
    ahead = left;
    behind = right;
  }
  return {
    branch,
    is_dirty: isDirty,
    commits_ahead: ahead,
    commits_behind: behind,
    is_diverged: ahead > 0 && behind > 0,
    needs_reconcile: behind > 0 && (ahead > 0 || isDirty),
  };
}
