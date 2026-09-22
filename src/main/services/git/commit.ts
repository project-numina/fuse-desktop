/**
 * The explicit commit pipeline, adapted from the web's
 * ``BlueprintCommitService`` to a local checkout: stage bounded pathspecs,
 * guard against committing credentials, optionally validate, commit with a
 * chosen identity, then push only when the branch tracks a remote.
 *
 * Desktop adaptations: the pipeline runs under the folder's lock (the
 * web's per-clone lock), refuses to run over an unresolved merge/rebase,
 * and builds the commit in a private index seeded from HEAD so the user's
 * own staging is never reset or swept into a Fuse commit.
 *
 * Statuses: ``committed`` | ``no_changes`` | ``content_blocked`` |
 * ``verification_unavailable`` | ``build_failed`` | ``push_failed``.
 */

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { BlueprintCommitResult, BlueprintCommitStatus } from '@shared/api-types';
import { HttpError } from '../../store/registry';
import { GitError, runGit, tryGit } from './run';
import {
  AGENT_CONTENT_PATHSPECS,
  GENERATED_RESET_PATHSPECS,
  LOCAL_GENERATED_PATHSPECS,
  PROTECTED_REPOSITORY_PATHS,
  PROTECTED_REPOSITORY_PATHSPECS,
} from './pathspecs';
import { CREDENTIALED_URL_PATTERN } from './run';
import { repositoryLockKey, withRepositoryLock } from './lock';
import { agentCommitMetadataFooter, agentCommitSubject, fallbackCommitMessage, type AgentCommitContext, type AiCommitGenerator, type CommitMessage } from './commit-message';
import {
  BOT_IDENTITY,
  cleanAuthorName,
  conflictedPaths,
  currentBranch,
  currentGitIdentity,
  dirtyContentPaths,
  gitOperationInProgress,
  hasHead,
  revParseHead,
  type GitIdentity,
} from './status';

/** Result of the optional validation hook (cached Lean errors, …). */
export interface CommitValidationFailure {
  status: Extract<BlueprintCommitStatus, 'build_failed' | 'verification_unavailable'>;
  message: string;
}

/**
 * ``context.env`` carries ``GIT_INDEX_FILE`` while a commit is being built
 * in its private index; a validator that inspects the staged tree must
 * pass it to git.
 */
export type CommitValidator = (cwd: string, context?: { env?: NodeJS.ProcessEnv }) => Promise<CommitValidationFailure | null>;

export interface CommitChangesOptions {
  /** Subject; blank → derived from the staged diff (or ``aiGenerator``). */
  message?: string | null;
  /** Body / trailer lines appended as a second ``-m``. */
  body?: string | null;
  /** Committer (and author when ``author`` is omitted). */
  identity: GitIdentity;
  author?: GitIdentity | null;
  /** Repo-relative Lean project directory; '' commits the whole folder. */
  projectSubdir?: string;
  /** Extra positive pathspecs a nested project may commit (its blueprint scope). */
  additionalPaths?: readonly string[];
  /** Agent commits never publish repository automation (``.github``). */
  protectAutomation?: boolean;
  /**
   * Lean validation before the commit: a validator function, or ``true`` to
   * use the one registered by the Lean module (skipped when none is).
   */
  validate?: boolean | CommitValidator | null;
  aiGenerator?: AiCommitGenerator | null;
  /** Push after committing when the branch tracks a remote (default true). */
  push?: boolean;
}

let defaultCommitValidator: CommitValidator | null = null;

/** Let the Lean module supply the cached-error check used when ``validate: true``. */
export function setDefaultCommitValidator(validator: CommitValidator | null): void {
  defaultCommitValidator = validator;
}

export function resolveCommitValidator(validate: boolean | CommitValidator | null | undefined): CommitValidator | null {
  if (typeof validate === 'function') return validate;
  return validate === true ? defaultCommitValidator : null;
}

export const UNRESOLVED_MERGE_DETAIL = 'A cross-branch merge is unresolved in this workspace. Resolve or discard it before committing or syncing.';

/**
 * The web's "unresolved merge" guard: every commit or sync write refuses
 * (409) while a merge, rebase, cherry-pick or revert is in progress or the
 * index still has unmerged paths, so git's own state is never clobbered.
 */
export async function requireNoUnresolvedMerge(cwd: string): Promise<void> {
  if ((await gitOperationInProgress(cwd)) || (await conflictedPaths(cwd)).length > 0) {
    throw new HttpError(409, UNRESOLVED_MERGE_DETAIL, 'http_409');
  }
}

const TOKEN_PATTERN = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-(?:api|oat)[A-Za-z0-9_-]{16,}|sk-or-v1-[A-Za-z0-9_-]{16,})\b/;

export function commitLeakMessage(reason: string): string {
  return `Run-environment content blocked this commit: newly added content contains ${reason}. Remove it and retry; the changes remain local.`;
}

/** Why newly added lines must not be committed, or null when clean. */
export function leakReasonForAddedLines(diff: string): string | null {
  const added = diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n');
  if (TOKEN_PATTERN.test(added)) return 'what looks like a runtime credential';
  CREDENTIALED_URL_PATTERN.lastIndex = 0;
  if (CREDENTIALED_URL_PATTERN.test(added)) {
    CREDENTIALED_URL_PATTERN.lastIndex = 0;
    return 'a URL with embedded credentials';
  }
  return null;
}

/** Scan the staged diff for credentials (the desktop keeps only this guard). */
export async function stagedLeakReason(cwd: string, env?: NodeJS.ProcessEnv): Promise<string | null> {
  const diff = await tryGit(['diff', '--cached', '--no-ext-diff', '--no-textconv', '--unified=0', '--no-color'], { cwd, env });
  return diff === null ? null : leakReasonForAddedLines(diff);
}

function isProtectedPath(path: string): boolean {
  const parts = path.split('/').filter(Boolean);
  return PROTECTED_REPOSITORY_PATHS.some((protectedPath) => {
    const protectedParts = protectedPath.split('/');
    return protectedParts.every((part, index) => parts[index] === part);
  });
}

/** Chunk long path lists so ``git add`` never exceeds the platform argv limit. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

/**
 * Run ``fn`` with ``GIT_INDEX_FILE`` pointing at a private index seeded
 * from HEAD (empty before the first commit). Commits are assembled there so
 * the user's real index — including partial staging and files staged
 * outside the commit scope — is never reset, read or swept into a commit.
 */
export async function withTemporaryIndex<T>(cwd: string, fn: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const gitDir = (await runGit(['rev-parse', '--absolute-git-dir'], { cwd })).trim();
  const indexPath = join(gitDir, `fuse-index-${randomUUID().slice(0, 8)}`);
  const env: NodeJS.ProcessEnv = { GIT_INDEX_FILE: indexPath };
  try {
    if (await hasHead(cwd)) await runGit(['read-tree', 'HEAD'], { cwd, env });
    else await runGit(['read-tree', '--empty'], { cwd, env });
    return await fn(env);
  } finally {
    await fs.rm(indexPath, { force: true }).catch(() => undefined);
    await fs.rm(`${indexPath}.lock`, { force: true }).catch(() => undefined);
  }
}

/**
 * Stage bounded source changes while excluding generated local state.
 * ``includedPaths`` = positive scopes (a nested project and its blueprint
 * files); undefined stages the whole folder. With ``options.env`` carrying
 * a private ``GIT_INDEX_FILE`` (seeded from HEAD, see
 * ``withTemporaryIndex``) the real index is left untouched.
 */
export async function stageSourceChanges(
  cwd: string,
  includedPaths?: readonly string[],
  options: { protectAutomation?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  const protect = options.protectAutomation ?? false;
  const env = options.env;
  const filtered = includedPaths === undefined ? undefined : includedPaths.filter((path) => !(protect && isProtectedPath(path)));
  if (filtered !== undefined) {
    // Clear the index so a stale staged sibling cannot ride along. A private
    // index was seeded from HEAD and has nothing to clear.
    if (!env) await runGit(['reset'], { cwd });
    if (filtered.length === 0) return;
  }
  const protectedSpecs = protect ? PROTECTED_REPOSITORY_PATHSPECS : [];
  const pathspecs =
    filtered === undefined
      ? protect
        ? AGENT_CONTENT_PATHSPECS
        : LOCAL_GENERATED_PATHSPECS
      : [...filtered, ...LOCAL_GENERATED_PATHSPECS.slice(1), ...protectedSpecs];
  const untrackedOutput = await runGit(['ls-files', '-o', '-z', '--exclude-standard', '--', ...pathspecs], { cwd, env });
  const untrackedPaths = untrackedOutput.split('\0').filter((path) => path);
  // Untracked exact-file scopes must be in the index before ``add -u``,
  // otherwise git treats them as unmatched pathspecs and exits 128.
  for (const batch of chunk(untrackedPaths, 200)) await runGit(['add', '--', ...batch], { cwd, env });
  await runGit(['add', '-u', '--', ...pathspecs], { cwd, env });
  // Unstage generated state even if an older run or a crash staged it.
  await runGit(['reset', '--', ...GENERATED_RESET_PATHSPECS], { cwd, env });
}

/** ``true`` when a commit was created, ``false`` when git found nothing to commit. */
export async function createCommit(
  cwd: string,
  message: CommitMessage,
  identity: GitIdentity,
  author?: GitIdentity | null,
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<boolean> {
  const args = ['commit', '-m', message.subject];
  if (author) args.push(`--author=${cleanAuthorName(author.name) || identity.name} <${author.email.trim()}>`);
  if (message.body) args.push('-m', message.body);
  try {
    await runGit(args, { cwd, env: options.env, configs: { 'user.name': cleanAuthorName(identity.name), 'user.email': identity.email.trim() } });
  } catch (error) {
    if (error instanceof GitError && /nothing to commit|no changes added|nothing added to commit/.test(error.message)) {
      return false;
    }
    throw error;
  }
  return true;
}

/**
 * Make the real index agree with HEAD for the paths the commit just
 * touched (their content is committed, so any partial staging of them is
 * moot), leaving every other index entry — the user's own staging — alone.
 */
export async function syncIndexWithHead(cwd: string): Promise<void> {
  const output = await tryGit(['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD'], { cwd });
  const paths = (output ?? '').split('\0').filter((path) => path);
  for (const batch of chunk(paths, 200)) {
    await tryGit(['reset', '-q', '--', ...batch.map((path) => `:(literal)${path}`)], { cwd });
  }
}

export interface PushOutcome {
  pushed: boolean;
  reason?: 'no_remote' | 'no_upstream' | 'rejected' | 'error';
  message?: string;
  /** The push succeeded after rebasing local commits onto the advanced remote. */
  rebased?: boolean;
}

export interface PushOptions {
  /** Committer of any rebased commits; defaults to the folder's identity. */
  identity?: GitIdentity;
}

async function isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  return (await tryGit(['merge-base', '--is-ancestor', ancestor, descendant], { cwd })) !== null;
}

async function pushUpstream(cwd: string): Promise<{ remote: string; ref: string; trackingRef: string } | null> {
  const branch = await currentBranch(cwd);
  if (!branch) return null;
  const output = await tryGit(['for-each-ref', '--format=%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream)', `refs/heads/${branch}`], { cwd });
  const [remote, ref, trackingRef] = (output ?? '').split('\0');
  // A local tracking branch is not a publication destination.
  if (!remote || remote === '.' || remote.startsWith('-') || !ref?.startsWith('refs/heads/') || !trackingRef) return null;
  return { remote, ref, trackingRef };
}

async function fetchedSha(cwd: string): Promise<string | null> {
  return (await tryGit(['rev-parse', '--verify', '--quiet', 'FETCH_HEAD^{commit}'], { cwd }))?.trim() || null;
}

/**
 * Push the current branch when it tracks a remote branch, with the web's
 * lease semantics: fetch the configured upstream, verify HEAD descends from it,
 * push with ``--force-with-lease``. When the remote advanced, one
 * ``git pull --rebase`` is attempted (never over local merge commits) and
 * abandoned on conflict, keeping the local commit. A folder without a
 * remote, or a branch that was never pushed, is left alone: local commits
 * are the product here, publication is the user's call.
 */
export async function pushCurrentBranch(cwd: string, options: PushOptions = {}): Promise<PushOutcome> {
  if (!(await tryGit(['remote'], { cwd }))?.trim()) return { pushed: false, reason: 'no_remote' };
  const upstream = await pushUpstream(cwd);
  if (!upstream) return { pushed: false, reason: 'no_upstream' };
  const { remote, ref } = upstream;
  const branch = `${remote}/${ref.slice('refs/heads/'.length)}`;
  const gone = { pushed: false, reason: 'error', message: `The remote branch ${branch} no longer exists, so these changes were not published.` } as const;
  try {
    await runGit(['fetch', remote, ref], { cwd, timeoutMs: 120_000 });
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    if (/couldn't find remote ref/i.test(error.message)) return gone;
    return { pushed: false, reason: 'error', message: `Could not fetch ${branch}: ${error.message}` };
  }
  let expected = await fetchedSha(cwd);
  if (!expected) return gone;
  const advanced = `Remote branch ${branch} advanced outside Fuse; pull and resolve conflicts, then retry.`;
  let rebased = false;
  if (!(await isAncestor(cwd, expected, 'HEAD'))) {
    // Rebasing would linearise local merge commits (a sync-main merge, say);
    // leave those for the user.
    const merges = (await tryGit(['rev-list', '--merges', '--count', `${expected}..HEAD`], { cwd }))?.trim();
    if (merges !== '0') return { pushed: false, reason: 'rejected', message: advanced };
    const identity = options.identity ?? (await currentGitIdentity(cwd)).identity;
    try {
      await runGit(['pull', '--rebase', remote, ref], {
        cwd,
        timeoutMs: 120_000,
        configs: { 'user.name': cleanAuthorName(identity.name), 'user.email': identity.email.trim() },
      });
    } catch (error) {
      if (!(error instanceof GitError)) throw error;
      await tryGit(['rebase', '--abort'], { cwd });
      return { pushed: false, reason: 'rejected', message: advanced };
    }
    rebased = true;
    expected = (await fetchedSha(cwd)) ?? expected;
  }
  try {
    await runGit(['push', `--force-with-lease=${ref}:${expected}`, remote, `HEAD:${ref}`], { cwd, timeoutMs: 120_000 });
    return { pushed: true, rebased };
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    const rejected = /rejected|non-fast-forward|fetch first|stale info|force-with-lease/i.test(error.message);
    return {
      pushed: false,
      reason: rejected ? 'rejected' : 'error',
      message: rejected ? advanced : `Could not push ${branch}: ${error.message}`,
    };
  }
}

// ── Unpushed Fuse commits ─────────────────────────────────────────────────

const unpushedCommits = new Map<string, Set<string>>();

/**
 * Remember a commit Fuse created whose push failed, so the next commit on
 * a clean tree retries publishing it (the web's retry-unpushed step). Only
 * these commits are ever pushed from the clean-tree path: commits the user
 * made in a terminal are theirs to publish.
 */
export function rememberUnpushedCommit(cwd: string, sha: string | null): void {
  if (!sha) return;
  const key = repositoryLockKey(cwd);
  const pending = unpushedCommits.get(key) ?? new Set<string>();
  pending.add(sha);
  unpushedCommits.set(key, pending);
}

/** Test hook. */
export function forgetUnpushedCommits(): void {
  unpushedCommits.clear();
}

/** Push when a remembered Fuse commit is still on this branch and unpublished. */
export async function retryUnpushedCommits(cwd: string, options: PushOptions = {}): Promise<PushOutcome | null> {
  const key = repositoryLockKey(cwd);
  const pending = unpushedCommits.get(key);
  if (!pending || pending.size === 0) return null;
  const remote = (await pushUpstream(cwd))?.trackingRef ?? null;
  let outstanding = false;
  for (const sha of [...pending]) {
    // Rebased or reset away: nothing of ours left to publish under that name.
    if (!(await isAncestor(cwd, sha, 'HEAD'))) {
      pending.delete(sha);
      continue;
    }
    if (remote && (await isAncestor(cwd, sha, remote))) {
      pending.delete(sha);
      continue;
    }
    outstanding = true;
  }
  if (!outstanding) {
    unpushedCommits.delete(key);
    return null;
  }
  const outcome = await pushCurrentBranch(cwd, options);
  if (outcome.pushed) unpushedCommits.delete(key);
  return outcome;
}

/** The positive pathspecs a workspace commit may stage. */
export function workspaceCommitPathspecs(projectSubdir: string, additionalPaths: readonly string[] = []): string[] {
  const subdir = projectSubdir.replace(/^\/+|\/+$/g, '');
  if (!subdir) return ['.'];
  return [subdir, ...additionalPaths.filter((path) => path && path !== subdir)];
}

/**
 * The web's ``_resolve_commit_message``: without a generator the explicit
 * subject (or the diff-derived fallback when blank); with one, the model's
 * message, falling back to the diff-derived summary when it fails and to
 * the explicit subject only when there is no diff to describe.
 */
async function resolveMessage(cwd: string, options: CommitChangesOptions, env?: NodeJS.ProcessEnv): Promise<CommitMessage> {
  const explicit = (options.message ?? '').trim();
  const body = options.body ?? null;
  if (explicit && !options.aiGenerator) return { subject: explicit, body };
  const staged = await tryGit(['diff', '--cached'], { cwd, env });
  if (!staged || !staged.trim()) return { subject: explicit || 'Save edits', body };
  const fallback = fallbackCommitMessage(staged, body);
  if (!options.aiGenerator) return fallback;
  try {
    const generated = await options.aiGenerator(staged);
    if (!generated || !generated.subject.trim()) return fallback;
    const parts = [generated.body, body].filter((part): part is string => Boolean(part && part.trim()));
    return { subject: generated.subject, body: parts.length ? parts.join('\n\n') : null };
  } catch {
    return fallback;
  }
}

/**
 * Commit the folder's saved changes. A clean tree reports ``no_changes``
 * (after retrying the push of any Fuse commit that failed to publish);
 * everything else follows the web's stage → guard → validate → commit →
 * verify → push sequence, serialised per folder and refused (409) while a
 * merge or rebase is unresolved.
 */
export function commitChanges(cwd: string, options: CommitChangesOptions): Promise<BlueprintCommitResult> {
  return withRepositoryLock(cwd, () => commitChangesLocked(cwd, options));
}

async function commitChangesLocked(cwd: string, options: CommitChangesOptions): Promise<BlueprintCommitResult> {
  const push = options.push ?? true;
  await requireNoUnresolvedMerge(cwd);
  if ((await dirtyContentPaths(cwd)).length === 0) {
    if (push) await retryUnpushedCommits(cwd, { identity: options.identity });
    return { status: 'no_changes', commit_sha: null, message: null };
  }
  const pathspecs = workspaceCommitPathspecs(options.projectSubdir ?? '', options.additionalPaths);
  return withTemporaryIndex(cwd, async (env) => {
    await stageSourceChanges(cwd, pathspecs, { protectAutomation: options.protectAutomation, env });
    const stagedTree = (await runGit(['write-tree'], { cwd, env })).trim();
    const headTree = (await tryGit(['rev-parse', 'HEAD^{tree}'], { cwd }))?.trim() ?? null;
    if (headTree !== null && headTree === stagedTree) {
      // Only out-of-scope or generated paths changed.
      return { status: 'no_changes', commit_sha: null, message: null };
    }
    const leak = await stagedLeakReason(cwd, env);
    if (leak !== null) return { status: 'content_blocked', commit_sha: null, message: commitLeakMessage(leak) };
    if ((await runGit(['write-tree'], { cwd, env })).trim() !== stagedTree) {
      return {
        status: 'verification_unavailable',
        commit_sha: null,
        message: 'The staged Git tree changed while repository content was checked; changes remain uncommitted.',
      };
    }
    const validator = resolveCommitValidator(options.validate);
    if (validator) {
      const failure = await validator(cwd, { env });
      if (failure) return { status: failure.status, commit_sha: null, message: failure.message };
      if ((await runGit(['write-tree'], { cwd, env })).trim() !== stagedTree) {
        return {
          status: 'verification_unavailable',
          commit_sha: null,
          message: 'The staged Git tree changed while Lean diagnostics were checked.',
        };
      }
    }
    const message = await resolveMessage(cwd, options, env);
    if (!(await createCommit(cwd, message, options.identity, options.author, { env }))) {
      return { status: 'no_changes', commit_sha: null, message: null };
    }
    const committedTree = (await runGit(['rev-parse', 'HEAD^{tree}'], { cwd })).trim();
    if (committedTree !== stagedTree) {
      // Move HEAD back without touching the user's index or working tree.
      await tryGit(['reset', '--soft', 'HEAD~1'], { cwd });
      return {
        status: 'verification_unavailable',
        commit_sha: null,
        message: 'The committed Git tree did not match the Lean-verified staged tree; changes remain uncommitted.',
      };
    }
    await syncIndexWithHead(cwd);
    let sha = await revParseHead(cwd);
    if (push) {
      const outcome = await pushCurrentBranch(cwd, { identity: options.identity });
      // A rebase during the push rewrites the commit; report what is on the branch now.
      sha = await revParseHead(cwd);
      if (!outcome.pushed && (outcome.reason === 'rejected' || outcome.reason === 'error')) {
        // The commit stays local; the next commit on a clean tree retries the push.
        rememberUnpushedCommit(cwd, sha);
        return { status: 'push_failed', commit_sha: sha, message: outcome.message ?? null };
      }
    }
    return { status: 'committed', commit_sha: sha, message: null };
  });
}

export interface AgentTurnCommitOptions extends AgentCommitContext {
  /** The prompt that started the turn (first line becomes the subject). */
  userMessage: string;
  projectSubdir?: string;
  additionalPaths?: readonly string[];
  aiGenerator?: AiCommitGenerator | null;
  validate?: boolean | CommitValidator | null;
  push?: boolean;
}

/**
 * Autocommit after an agent turn: ``Agent: <prompt>`` (or the incomplete
 * variant) with the metadata trailer, authored and committed by the bot
 * identity, never touching ``.github``. Partial work is preserved too.
 * With a generator the model's subject carries the same ``Agent:`` prefix
 * (the web's agent-turn generator wrapper).
 */
export function commitAgentTurn(cwd: string, options: AgentTurnCommitOptions): Promise<BlueprintCommitResult> {
  const prefix = options.incomplete ? 'Agent (incomplete): ' : 'Agent: ';
  const generator = options.aiGenerator;
  const aiGenerator: AiCommitGenerator | null = generator
    ? async (diff) => {
        const generated = await generator(diff);
        if (!generated || !generated.subject.trim()) return null;
        return { subject: `${prefix}${generated.subject.trim()}`, body: generated.body };
      }
    : null;
  return commitChanges(cwd, {
    message: agentCommitSubject(options.userMessage, options.incomplete),
    body: agentCommitMetadataFooter(options),
    identity: BOT_IDENTITY,
    author: BOT_IDENTITY,
    projectSubdir: options.projectSubdir,
    additionalPaths: options.additionalPaths,
    protectAutomation: true,
    aiGenerator,
    validate: options.validate ?? true,
    push: options.push,
  });
}
