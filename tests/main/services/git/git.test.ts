/**
 * Real-git tests: every case builds a throwaway repository (optionally with
 * a bare origin) and drives the service functions against it.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { workingTreeDiff, untrackedFile } from '@main/services/git/changes';
import { commitAgentTurn, commitChanges, forgetUnpushedCommits, leakReasonForAddedLines, pushCurrentBranch, stageSourceChanges, UNRESOLVED_MERGE_DETAIL } from '@main/services/git/commit';
import { repositoryLockBusy, withRepositoryLock } from '@main/services/git/lock';
import { agentCommitMetadataFooter, agentCommitSubject, fallbackCommitMessage, generateCommitMessageWithClaude, splitSubjectBody } from '@main/services/git/commit-message';
import { commitDetail, listCommits } from '@main/services/git/history';
import { GitError, runGit } from '@main/services/git/run';
import { bucketWeeklyCommits, defaultCompareRef, leanFileDiffStats, weeklyCommits } from '@main/services/git/stats';
import {
  currentBranch,
  currentGitIdentity,
  dirtyContentPaths,
  isGitRepository,
  parseGithubRemote,
  resetDefaultBranchCache,
  resolveDefaultBranch,
  BOT_IDENTITY,
} from '@main/services/git/status';
import { branchFreshness, branchStatus, syncBranch, syncFromMain, undoMerge } from '@main/services/git/sync';

const identity = { name: 'Test', email: 't@example.test' };
const isWindows = process.platform === 'win32';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

function initRepo(root: string, name = 'repo'): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 't@example.test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

function commitAll(dir: string, message: string): string {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

/** A checkout whose ``main`` tracks a bare origin, plus a second clone to advance it. */
function initWithOrigin(root: string): { clone: string; second: string } {
  const origin = join(root, 'origin.git');
  mkdirSync(origin, { recursive: true });
  git(origin, 'init', '-q', '--bare', '-b', 'main');
  const clone = join(root, 'clone');
  git(root, 'clone', '-q', origin, clone);
  git(clone, 'config', 'user.name', 'Test');
  git(clone, 'config', 'user.email', 't@example.test');
  git(clone, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(clone, 'f.txt'), 'base\n');
  git(clone, 'add', 'f.txt');
  git(clone, 'commit', '-q', '-m', 'base');
  git(clone, 'push', '-q', '-u', 'origin', 'main');
  const second = join(root, 'second');
  git(root, 'clone', '-q', '--branch', 'main', origin, second);
  git(second, 'config', 'user.name', 'Other');
  git(second, 'config', 'user.email', 'o@example.test');
  return { clone, second };
}

function advanceRemote(second: string, line: string): void {
  git(second, 'pull', '-q', '--rebase', 'origin', 'main');
  writeFileSync(join(second, 'f.txt'), `base\n${line}\n`);
  git(second, 'commit', '-q', '-am', `remote ${line}`);
  git(second, 'push', '-q', 'origin', 'main');
}

let root: string;
const savedEnv = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fuse-git-'));
  // Isolate from the developer's own git configuration (identity, hooks, signing).
  const emptyConfig = join(root, 'empty-gitconfig');
  writeFileSync(emptyConfig, '');
  process.env.GIT_CONFIG_GLOBAL = emptyConfig;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  resetDefaultBranchCache();
  forgetUnpushedCommits();
});

afterEach(() => {
  if (savedEnv.global === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = savedEnv.global;
  if (savedEnv.nosystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
  else process.env.GIT_CONFIG_NOSYSTEM = savedEnv.nosystem;
  rmSync(root, { recursive: true, force: true });
});

describe('runGit', () => {
  it('reports failures with the git error format', async () => {
    const dir = initRepo(root);
    await expect(runGit(['rev-parse', '--verify', 'HEAD'], { cwd: dir })).rejects.toBeInstanceOf(GitError);
    await expect(runGit(['rev-parse', '--verify', 'HEAD'], { cwd: dir })).rejects.toThrow(/^git rev-parse failed \(exit 128\)/);
    expect(await runGit(['rev-parse', '--is-inside-work-tree'], { cwd: dir })).toBe('true');
  });

  it('preserves leading whitespace and strips only trailing newlines', async () => {
    const dir = initRepo(root);
    writeFileSync(join(dir, 'a.txt'), 'x\n');
    const status = await runGit(['status', '--porcelain'], { cwd: dir });
    expect(status).toBe('?? a.txt');
  });
});

describe('probes', () => {
  it('detects repositories, branches, dirty paths and identity', async () => {
    const dir = initRepo(root);
    expect(await isGitRepository(dir)).toBe(true);
    expect(await isGitRepository(join(root, 'missing'))).toBe(false);
    const plain = join(root, 'plain');
    mkdirSync(plain);
    expect(await isGitRepository(plain)).toBe(false);
    expect(await currentBranch(dir)).toBe('main');
    writeFileSync(join(dir, 'a.txt'), 'x\n');
    mkdirSync(join(dir, '.lake'), { recursive: true });
    writeFileSync(join(dir, '.lake', 'build.txt'), 'generated\n');
    writeFileSync(join(dir, '.numina-source-ready'), '');
    writeFileSync(join(dir, 'scratch_test.lean'), '-- scratch\n');
    expect(await dirtyContentPaths(dir)).toEqual(['a.txt']);
    const configured = await currentGitIdentity(dir);
    expect(configured).toEqual({ identity, configured: true });
    git(dir, 'config', '--unset', 'user.email');
    const fallback = await currentGitIdentity(dir, 'Ada <Lovelace>');
    expect(fallback.configured).toBe(false);
    expect(fallback.identity.email).toBe('fuse-desktop@localhost');
    expect(fallback.identity.name).toBe('Test');
  });

  it('resolves the default branch locally and from origin/HEAD', async () => {
    const dir = initRepo(root);
    writeFileSync(join(dir, 'a.txt'), 'x\n');
    commitAll(dir, 'init');
    expect(await resolveDefaultBranch(dir)).toBe('main');
    git(dir, 'checkout', '-q', '-b', 'feature');
    expect(await resolveDefaultBranch(dir)).toBe('main');
    const { clone } = initWithOrigin(root);
    git(clone, 'remote', 'set-head', 'origin', 'main');
    expect(await resolveDefaultBranch(clone)).toBe('main');
    expect(await defaultCompareRef(clone)).toBe('origin/main');
    expect(await defaultCompareRef(dir)).toBe('main');
  });

  it('parses GitHub remotes', () => {
    expect(parseGithubRemote('https://github.com/acme/widgets.git')).toEqual({ owner: 'acme', name: 'widgets' });
    expect(parseGithubRemote('git@github.com:acme/widgets')).toEqual({ owner: 'acme', name: 'widgets' });
    expect(parseGithubRemote('https://gitlab.com/acme/widgets.git')).toBeNull();
    expect(parseGithubRemote(null)).toBeNull();
  });
});

describe('history', () => {
  it('lists commits from HEAD and reads details locally', async () => {
    const dir = initRepo(root);
    writeFileSync(join(dir, 'a.txt'), 'one\n');
    git(dir, 'add', 'a.txt');
    git(dir, '-c', 'user.name=Jane', '-c', 'user.email=1+jane@users.noreply.github.com', 'commit', '-q', '-m', 'initial');
    writeFileSync(join(dir, 'a.txt'), 'two\n');
    git(dir, 'commit', '-q', '-am', 'update\n\nBody line');
    const commits = await listCommits(dir, 'HEAD', 50, { github: { owner: 'acme', name: 'widgets' } });
    expect(commits.map((commit) => commit.message)).toEqual(['update\n\nBody line', 'initial']);
    expect(commits[1].author_login).toBe('jane');
    expect(commits[1].author_avatar_url).toBe('https://github.com/jane.png');
    expect(commits[0].author_login).toBeNull();
    expect(commits[0].html_url).toBe(`https://github.com/acme/widgets/commit/${commits[0].sha}`);
    expect(commits[0].authored_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await listCommits(dir, 'HEAD', 1)).toHaveLength(1);
    const detail = await commitDetail(dir, commits[0].sha);
    expect(detail?.files[0].path).toBe('a.txt');
    expect(detail?.files[0].additions).toBe(1);
    expect(detail?.files[0].deletions).toBe(1);
    expect(detail?.files[0].status).toBe('modified');
    expect(detail?.html_url).toBeNull();
    expect(await commitDetail(dir, '--output=bad')).toBeNull();
    expect(await commitDetail(dir, 'deadbeef')).toBeNull();
    await expect(listCommits(dir, 'HEAD', 0)).rejects.toThrow(/limit/);
    await expect(listCommits(dir, '--output=bad', 1)).rejects.toThrow(/reference/);
  });

  it('returns an empty list for a repository without commits', async () => {
    const dir = initRepo(root);
    expect(await listCommits(dir, 'HEAD', 10)).toEqual([]);
    expect(await weeklyCommits(dir)).toEqual([]);
  });
});

describe('workingTreeDiff', () => {
  it('captures tracked, untracked, binary and symlink changes', async () => {
    const dir = initRepo(root);
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'base');
    writeFileSync(join(dir, 'note.txt'), 'hello\n');
    writeFileSync(join(dir, 'binary.bin'), Buffer.from([0, 98, 121, 116, 101, 115]));
    if (!isWindows) symlinkSync('note.txt', join(dir, 'link'));
    const { files } = await workingTreeDiff(dir);
    const byPath = new Map(files.map((file) => [file.path, file]));
    expect(byPath.get('note.txt')?.diff).toContain('+hello');
    expect(byPath.get('note.txt')?.status).toBe('untracked');
    expect(byPath.get('note.txt')?.additions).toBe(1);
    expect(byPath.get('binary.bin')?.binary).toBe(true);
    if (!isWindows) {
      expect(byPath.get('link')?.diff).toContain('note.txt');
      expect(byPath.get('link')?.diff).toContain('120000');
    }
    expect(files.map((file) => file.path)).toEqual([...files.map((file) => file.path)].sort());
  });

  it('preserves renames with old_path and tracked modifications', async () => {
    const dir = initRepo(root);
    writeFileSync(join(dir, 'old.txt'), 'one\n');
    writeFileSync(join(dir, 'keep.txt'), 'a\nb\n');
    commitAll(dir, 'base');
    git(dir, 'mv', 'old.txt', 'new.txt');
    writeFileSync(join(dir, 'keep.txt'), 'a\nc\n');
    const { files } = await workingTreeDiff(dir);
    const renamed = files.find((file) => file.path === 'new.txt');
    expect(renamed?.status).toBe('renamed');
    expect(renamed?.old_path).toBe('old.txt');
    const modified = files.find((file) => file.path === 'keep.txt');
    expect(modified?.status).toBe('modified');
    expect(modified?.additions).toBe(1);
    expect(modified?.deletions).toBe(1);
    expect(modified?.diff).toContain('-b');
  });

  it('truncates large untracked files and hides generated paths', async () => {
    const dir = initRepo(root);
    writeFileSync(join(dir, 'large.txt'), 'x'.repeat(40));
    mkdirSync(join(dir, 'nested', '.lake'), { recursive: true });
    writeFileSync(join(dir, 'nested', '.lake', 'x'), 'x');
    mkdirSync(join(dir, 'numina', '.metadata'), { recursive: true });
    writeFileSync(join(dir, 'numina', '.metadata', 'x.json'), '{}');
    const { files } = await workingTreeDiff(dir, { maxPatchBytes: 10 });
    expect(files).toHaveLength(1);
    expect(files[0].truncated).toBe(true);
    expect(files[0].diff).toBeNull();
    const empty = await workingTreeDiff(dir);
    expect(empty.files[0].additions).toBe(1);
  });

  it('never reads missing entries or directories', async () => {
    expect((await untrackedFile(join(root, 'missing'), 'missing', 10)).diff).toBeNull();
    mkdirSync(join(root, 'directory'));
    expect((await untrackedFile(join(root, 'directory'), 'directory', 10)).diff).toBeNull();
    await expect(workingTreeDiff(root, { pathspecs: [] })).rejects.toThrow(/pathspecs/);
  });
});

describe('staging', () => {
  it('stages untracked content, then resets generated state and the marker', async () => {
    const dir = initRepo(root);
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'base');
    writeFileSync(join(dir, 'a.lean'), 'x\n');
    mkdirSync(join(dir, '.lake'));
    writeFileSync(join(dir, '.lake', 'out'), 'o\n');
    writeFileSync(join(dir, '.numina-source-ready'), '');
    git(dir, 'add', '-f', '.numina-source-ready');
    await stageSourceChanges(dir, ['.']);
    expect(git(dir, 'diff', '--cached', '--name-only')).toBe('a.lean');
  });

  it('bounds staging to the project scope and clears stale siblings', async () => {
    const dir = initRepo(root);
    mkdirSync(join(dir, 'proj'));
    mkdirSync(join(dir, 'other'));
    writeFileSync(join(dir, 'proj', 'a.lean'), 'x\n');
    writeFileSync(join(dir, 'other', 'b.lean'), 'y\n');
    commitAll(dir, 'base');
    writeFileSync(join(dir, 'proj', 'a.lean'), 'x2\n');
    writeFileSync(join(dir, 'proj', 'new.lean'), 'n\n');
    writeFileSync(join(dir, 'other', 'b.lean'), 'y2\n');
    git(dir, 'add', 'other/b.lean');
    mkdirSync(join(dir, 'blueprint', 'src'), { recursive: true });
    writeFileSync(join(dir, 'blueprint', 'src', 'content.tex'), '% b\n');
    await stageSourceChanges(dir, ['proj', 'blueprint/src/content.tex']);
    expect(git(dir, 'diff', '--cached', '--name-only').split('\n').sort()).toEqual(['blueprint/src/content.tex', 'proj/a.lean', 'proj/new.lean']);
  });

  it('keeps .github out of agent commits only', async () => {
    const dir = initRepo(root);
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'base');
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'on: push\n');
    writeFileSync(join(dir, 'a.txt'), 'x\n');
    await stageSourceChanges(dir, undefined, { protectAutomation: true });
    expect(git(dir, 'diff', '--cached', '--name-only')).toBe('a.txt');
    git(dir, 'reset', '-q');
    await stageSourceChanges(dir, ['.']);
    expect(git(dir, 'diff', '--cached', '--name-only').split('\n').sort()).toEqual(['.github/workflows/ci.yml', 'a.txt']);
  });
});

describe('commitChanges', () => {
  it('reports no_changes on a clean tree', async () => {
    const dir = initRepo(root);
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'base');
    const result = await commitChanges(dir, { identity });
    expect(result).toEqual({ status: 'no_changes', commit_sha: null, message: null });
  });

  it('commits with the requested subject, body and author', async () => {
    const dir = initRepo(root);
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'base');
    writeFileSync(join(dir, 'a.tex'), '\\section{A}\n');
    const result = await commitChanges(dir, {
      message: 'Add section',
      body: 'User: jane\nBlueprint: demo\nRepository: local/repo',
      identity: BOT_IDENTITY,
      author: { name: 'Jane <Doe>', email: 'jane@example.com' },
    });
    expect(result.status).toBe('committed');
    expect(result.commit_sha).toBe(git(dir, 'rev-parse', 'HEAD'));
    expect(git(dir, 'log', '-1', '--format=%an|%ae|%cn|%ce')).toBe('Jane Doe|jane@example.com|fuse-desktop[bot]|fuse-desktop[bot]@users.noreply.github.com');
    expect(git(dir, 'log', '-1', '--format=%B')).toBe('Add section\n\nUser: jane\nBlueprint: demo\nRepository: local/repo');
    expect(await dirtyContentPaths(dir)).toEqual([]);
  });

  it('derives a subject from the diff when the message is blank', async () => {
    const dir = initRepo(root);
    writeFileSync(join(dir, 'Main.lean'), 'theorem x : True := trivial\n');
    const result = await commitChanges(dir, { message: '  ', body: 'Blueprint: demo', identity });
    expect(result.status).toBe('committed');
    expect(git(dir, 'log', '-1', '--format=%s')).toBe('Update Main.lean');
    expect(git(dir, 'log', '-1', '--format=%b')).toBe('Changed: Main.lean.\n\nLine changes: +1.\n\nBlueprint: demo');
  });

  it('prefers a generated message and falls back when the generator fails', async () => {
    const dir = initRepo(root);
    writeFileSync(join(dir, 'a.txt'), 'x\n');
    await commitChanges(dir, { identity, aiGenerator: async () => ({ subject: 'Describe change.', body: 'Why it matters' }), body: 'Blueprint: d' });
    expect(git(dir, 'log', '-1', '--format=%B')).toBe('Describe change.\n\nWhy it matters\n\nBlueprint: d');
    writeFileSync(join(dir, 'b.txt'), 'y\n');
    await commitChanges(dir, {
      identity,
      aiGenerator: async () => {
        throw new Error('offline');
      },
    });
    expect(git(dir, 'log', '-1', '--format=%s')).toBe('Update b.txt');
    writeFileSync(join(dir, 'c.txt'), 'z\n');
    await commitChanges(dir, { identity, aiGenerator: async () => null });
    expect(git(dir, 'log', '-1', '--format=%s')).toBe('Update c.txt');
  });

  it('blocks credentials and leaves the tree dirty', async () => {
    const dir = initRepo(root);
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'base');
    writeFileSync(join(dir, 'secrets.txt'), 'token=ghp_abcdefghijklmnopqrstuvwxyz0123456789\n');
    const result = await commitChanges(dir, { identity });
    expect(result.status).toBe('content_blocked');
    expect(result.message).toContain('what looks like a runtime credential');
    expect(git(dir, 'rev-list', '--count', 'HEAD')).toBe('1');
    expect(leakReasonForAddedLines('+https://user:pw@host/x')).toBe('a URL with embedded credentials');
    expect(leakReasonForAddedLines('+plain')).toBeNull();
  });

  it('runs the validation hook and honours its verdict', async () => {
    const dir = initRepo(root);
    writeFileSync(join(dir, 'A.lean'), 'bad\n');
    const result = await commitChanges(dir, {
      identity,
      validate: async () => ({ status: 'build_failed', message: 'Changed Lean files have cached errors and remain uncommitted: A.lean' }),
    });
    expect(result.status).toBe('build_failed');
    // The change stays in the working tree; the user's index is untouched.
    expect(git(dir, 'diff', '--cached', '--name-only')).toBe('');
    expect(git(dir, 'status', '--porcelain')).toBe('?? A.lean');
    expect(git(dir, 'rev-list', '--all', '--count')).toBe('0');
  });

  it('commits only the nested project plus its blueprint scope', async () => {
    const dir = initRepo(root);
    mkdirSync(join(dir, 'proj'));
    writeFileSync(join(dir, 'proj', 'a.lean'), 'x\n');
    writeFileSync(join(dir, 'root.txt'), 'r\n');
    commitAll(dir, 'base');
    writeFileSync(join(dir, 'proj', 'a.lean'), 'x2\n');
    writeFileSync(join(dir, 'root.txt'), 'r2\n');
    const result = await commitChanges(dir, { identity, message: 'scoped', projectSubdir: 'proj' });
    expect(result.status).toBe('committed');
    expect(git(dir, 'show', '--name-only', '--format=', 'HEAD')).toBe('proj/a.lean');
    expect(await dirtyContentPaths(dir)).toEqual(['root.txt']);
  });

  it('pushes when the branch tracks a remote, rebasing over a non-conflicting remote advance', async () => {
    const { clone, second } = initWithOrigin(root);
    writeFileSync(join(clone, 'g.txt'), 'g\n');
    const pushed = await commitChanges(clone, { identity, message: 'add g' });
    expect(pushed.status).toBe('committed');
    expect(git(second, 'ls-remote', 'origin', 'refs/heads/main').split('\t')[0]).toBe(git(clone, 'rev-parse', 'HEAD'));
    advanceRemote(second, 'remote-edit');
    writeFileSync(join(clone, 'h.txt'), 'h\n');
    const rebased = await commitChanges(clone, { identity, message: 'add h' });
    expect(rebased.status).toBe('committed');
    expect(rebased.commit_sha).toBe(git(clone, 'rev-parse', 'HEAD'));
    expect(git(clone, 'log', '--format=%s', '-3')).toBe('add h\nremote remote-edit\nadd g');
    expect(git(second, 'ls-remote', 'origin', 'refs/heads/main').split('\t')[0]).toBe(git(clone, 'rev-parse', 'HEAD'));
    expect(await branchStatus(clone, 'main')).toMatchObject({ commits_ahead: 0, commits_behind: 0 });
  });

  it('keeps the commit and refreshes the branch status when the remote conflicts', async () => {
    const { clone, second } = initWithOrigin(root);
    advanceRemote(second, 'remote-edit');
    writeFileSync(join(clone, 'f.txt'), 'base\nlocal-edit\n');
    const rejected = await commitChanges(clone, { identity, message: 'edit f' });
    expect(rejected.status).toBe('push_failed');
    expect(rejected.commit_sha).toBe(git(clone, 'rev-parse', 'HEAD'));
    expect(rejected.message).toContain('advanced outside Fuse');
    expect(git(clone, 'log', '-1', '--format=%s')).toBe('edit f');
    expect(git(clone, 'status', '--porcelain')).toBe('');
    // origin/main was fetched, so the Git tab sees the divergence.
    expect(await branchStatus(clone, 'main')).toMatchObject({ commits_ahead: 1, commits_behind: 1, is_diverged: true, needs_reconcile: true });
  });

  it('retries only Fuse commits that failed to push, never the user\'s own', async () => {
    const { clone, second } = initWithOrigin(root);
    const remoteHead = git(second, 'rev-parse', 'HEAD');
    // A commit made in a terminal is not Fuse's to publish.
    writeFileSync(join(clone, 'wip.txt'), 'wip\n');
    commitAll(clone, 'WIP do not push');
    expect(await commitChanges(clone, { identity })).toMatchObject({ status: 'no_changes' });
    expect(git(second, 'ls-remote', 'origin', 'refs/heads/main').split('\t')[0]).toBe(remoteHead);
    // A Fuse commit whose push failed is retried on the next clean-tree commit.
    const url = git(clone, 'remote', 'get-url', 'origin');
    git(clone, 'remote', 'set-url', 'origin', join(root, 'missing.git'));
    writeFileSync(join(clone, 'k.txt'), 'k\n');
    const failed = await commitChanges(clone, { identity, message: 'add k' });
    expect(failed.status).toBe('push_failed');
    git(clone, 'remote', 'set-url', 'origin', url);
    expect(await commitChanges(clone, { identity })).toMatchObject({ status: 'no_changes' });
    expect(git(second, 'ls-remote', 'origin', 'refs/heads/main').split('\t')[0]).toBe(git(clone, 'rev-parse', 'HEAD'));
    expect(git(clone, 'log', '--format=%s', '-2')).toBe('add k\nWIP do not push');
  });

  it('refuses to commit or sync while a merge is unresolved', async () => {
    const dir = initRepo(root);
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    commitAll(dir, 'base');
    git(dir, 'checkout', '-q', '-b', 'feature');
    writeFileSync(join(dir, 'a.txt'), 'feature\n');
    commitAll(dir, 'feature');
    git(dir, 'checkout', '-q', 'main');
    writeFileSync(join(dir, 'a.txt'), 'main\n');
    const mainSha = commitAll(dir, 'main');
    expect(() => git(dir, 'merge', 'feature')).toThrow();
    const gitDir = git(dir, 'rev-parse', '--absolute-git-dir');
    expect(existsSync(join(gitDir, 'MERGE_HEAD'))).toBe(true);
    await expect(commitChanges(dir, { identity, message: 'during merge' })).rejects.toMatchObject({ status: 409, detail: UNRESOLVED_MERGE_DETAIL });
    await expect(commitAgentTurn(dir, { userMessage: 'x', incomplete: false, blueprintName: 'b', owner: 'o', repo: 'r' })).rejects.toMatchObject({ status: 409 });
    await expect(syncFromMain(dir, { identity, base: 'feature' })).rejects.toMatchObject({ status: 409, detail: UNRESOLVED_MERGE_DETAIL });
    // Git's merge state and the conflict markers are exactly as git left them.
    expect(existsSync(join(gitDir, 'MERGE_HEAD'))).toBe(true);
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(mainSha);
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toContain('<<<<<<<');
    git(dir, 'merge', '--abort');
    expect(await commitChanges(dir, { identity, message: 'after abort' })).toMatchObject({ status: 'no_changes' });
  });

  it('builds the commit in a private index and leaves the user\'s staging alone', async () => {
    const dir = initRepo(root);
    mkdirSync(join(dir, 'proj'));
    mkdirSync(join(dir, 'other'));
    writeFileSync(join(dir, 'proj', 'a.lean'), 'x\n');
    writeFileSync(join(dir, 'other', 'b.lean'), 'y\n');
    commitAll(dir, 'base');
    // Staged outside the commit scope: must survive untouched.
    writeFileSync(join(dir, 'other', 'b.lean'), 'y2\n');
    git(dir, 'add', 'other/b.lean');
    writeFileSync(join(dir, 'other', 'new.txt'), 'n\n');
    git(dir, 'add', 'other/new.txt');
    // Partially staged inside the scope: the saved file is what gets committed.
    writeFileSync(join(dir, 'proj', 'a.lean'), 'staged A\n');
    git(dir, 'add', 'proj/a.lean');
    writeFileSync(join(dir, 'proj', 'a.lean'), 'staged A\nworking B\n');
    writeFileSync(join(dir, 'proj', 'untracked.lean'), 'u\n');
    const result = await commitChanges(dir, { identity, message: 'scoped', projectSubdir: 'proj' });
    expect(result.status).toBe('committed');
    expect(git(dir, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual(['proj/a.lean', 'proj/untracked.lean']);
    expect(git(dir, 'show', 'HEAD:proj/a.lean')).toBe('staged A\nworking B');
    expect(git(dir, 'diff', '--cached', '--name-only').split('\n').sort()).toEqual(['other/b.lean', 'other/new.txt']);
    expect(git(dir, 'status', '--porcelain', '--', 'proj')).toBe('');
    expect(existsSync(join(git(dir, 'rev-parse', '--absolute-git-dir')))).toBe(true);
    expect(readdirSync(git(dir, 'rev-parse', '--absolute-git-dir')).filter((name) => name.startsWith('fuse-index'))).toEqual([]);
    // Out-of-scope changes alone are "no changes" for this workspace.
    expect(await commitChanges(dir, { identity, message: 'again', projectSubdir: 'proj' })).toMatchObject({ status: 'no_changes' });
    expect(git(dir, 'rev-list', '--count', 'HEAD')).toBe('2');
  });

  it('serialises write pipelines per folder', async () => {
    const dir = initRepo(root);
    const order: string[] = [];
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = withRepositoryLock(dir, async () => {
      order.push('first:start');
      await gate;
      order.push('first:end');
    });
    const second = withRepositoryLock(dir, async () => {
      order.push('second');
    });
    const other = withRepositoryLock(join(root, 'elsewhere'), async () => {
      order.push('other');
    });
    await other;
    expect(repositoryLockBusy(dir)).toBe(true);
    expect(order).toEqual(['first:start', 'other']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'other', 'first:end', 'second']);
    expect(repositoryLockBusy(dir)).toBe(false);
    // Two concurrent commits on one folder land as one commit plus a no-op.
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    writeFileSync(join(dir, 'b.txt'), 'b\n');
    const results = await Promise.all([commitChanges(dir, { identity, message: 'one' }), commitChanges(dir, { identity, message: 'two' })]);
    expect(results.map((result) => result.status).sort()).toEqual(['committed', 'no_changes']);
    expect(git(dir, 'rev-list', '--count', 'HEAD')).toBe('1');
  });

  it.each(['origin', 'publish'])('pushes and rebases against the configured %s/review upstream', async (remote) => {
    const { clone, second } = initWithOrigin(root);
    const originalMain = git(clone, 'rev-parse', 'HEAD');
    git(clone, 'push', '-q', 'origin', 'HEAD:refs/heads/review');
    if (remote !== 'origin') git(clone, 'remote', 'rename', 'origin', remote);
    git(clone, 'branch', '--set-upstream-to', `${remote}/review`, 'main');
    git(second, 'fetch', '-q', 'origin');
    git(second, 'checkout', '-q', '-b', 'review', 'origin/review');
    writeFileSync(join(second, 'remote.txt'), 'remote change\n');
    commitAll(second, 'advance review');
    git(second, 'push', '-q', 'origin', 'review');
    writeFileSync(join(clone, 'local.txt'), 'local change\n');
    commitAll(clone, 'local change');

    expect(await pushCurrentBranch(clone)).toEqual({ pushed: true, rebased: true });
    expect(git(second, 'ls-remote', 'origin', 'refs/heads/main').split('\t')[0]).toBe(originalMain);
    expect(git(second, 'ls-remote', 'origin', 'refs/heads/review').split('\t')[0]).toBe(git(clone, 'rev-parse', 'HEAD'));
    expect(git(clone, 'log', '--format=%s', '-2')).toBe('local change\nadvance review');
  });

  it('does not publish a branch that tracks a local branch', async () => {
    const { clone } = initWithOrigin(root);
    git(clone, 'checkout', '-q', '-b', 'local-only');
    git(clone, 'branch', '--set-upstream-to', 'main');
    expect((await pushCurrentBranch(clone)).reason).toBe('no_upstream');
  });

  it('never pushes without a remote or upstream', async () => {
    const dir = initRepo(root);
    expect(await pushCurrentBranch(dir)).toEqual({ pushed: false, reason: 'no_remote' });
    const { clone } = initWithOrigin(root);
    git(clone, 'checkout', '-q', '-b', 'local-only');
    expect((await pushCurrentBranch(clone)).reason).toBe('no_upstream');
  });
});

describe('commitAgentTurn', () => {
  it('commits as the bot with the agent subject and trailer, skipping .github', async () => {
    const dir = initRepo(root);
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'base');
    writeFileSync(join(dir, 'Main.lean'), 'theorem t : True := trivial\n');
    mkdirSync(join(dir, '.github'));
    writeFileSync(join(dir, '.github', 'ci.yml'), 'on: push\n');
    const result = await commitAgentTurn(dir, {
      userMessage: 'Prove the main theorem\nwith details',
      incomplete: true,
      blueprintName: 'demo',
      owner: 'local',
      repo: 'repo',
      conversationId: 'conv-1',
    });
    expect(result.status).toBe('committed');
    expect(git(dir, 'log', '-1', '--format=%an|%cn')).toBe('fuse-desktop[bot]|fuse-desktop[bot]');
    expect(git(dir, 'log', '-1', '--format=%B')).toBe(
      'Agent (incomplete): Prove the main theorem\n\nBlueprint: demo\nRepository: local/repo\nConversation: conv-1\nThe agent turn did not complete cleanly; this commit preserves the partial changes made before the error.',
    );
    expect(git(dir, 'show', '--name-only', '--format=', 'HEAD')).toBe('Main.lean');
    expect(agentCommitMetadataFooter({ blueprintName: 'b', owner: 'o', repo: 'r', incomplete: false })).toBe('Blueprint: b\nRepository: o/r');
  });

  it('prefixes a generated subject with Agent: and falls back to the diff summary', async () => {
    const dir = initRepo(root);
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'base');
    writeFileSync(join(dir, 'Main.lean'), 'theorem t : True := trivial\n');
    const generated = await commitAgentTurn(dir, {
      userMessage: 'Prove it',
      incomplete: false,
      blueprintName: 'demo',
      owner: 'local',
      repo: 'repo',
      aiGenerator: async (diff) => ({ subject: diff.includes('Main.lean') ? 'Add the trivial theorem' : 'wrong diff', body: 'Because.' }),
    });
    expect(generated.status).toBe('committed');
    expect(git(dir, 'log', '-1', '--format=%B')).toBe('Agent: Add the trivial theorem\n\nBecause.\n\nBlueprint: demo\nRepository: local/repo');
    writeFileSync(join(dir, 'Other.lean'), 'x\n');
    await commitAgentTurn(dir, { userMessage: 'More', incomplete: true, blueprintName: 'demo', owner: 'local', repo: 'repo', aiGenerator: async () => null });
    expect(git(dir, 'log', '-1', '--format=%s')).toBe('Update Other.lean');
  });

  it('accepts a bare base branch for sync-main', async () => {
    const dir = initRepo(root);
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    commitAll(dir, 'base');
    git(dir, 'checkout', '-q', '-b', 'feature');
    expect(await syncFromMain(dir, 'main')).toMatchObject({ status: 'up_to_date' });
  });
});

describe('commit messages', () => {
  it.skipIf(isWindows)('reads a generated message from the CLI and tolerates failures', async () => {
    const ok = join(root, 'fake-claude');
    writeFileSync(ok, '#!/bin/sh\ncat >/dev/null\nprintf "Add lemma about squares.\\n\\nExplains why.\\n"\n');
    chmodSync(ok, 0o755);
    expect(await generateCommitMessageWithClaude(ok, 'diff')).toEqual({ subject: 'Add lemma about squares', body: 'Explains why.' });
    const failing = join(root, 'failing-claude');
    writeFileSync(failing, '#!/bin/sh\nexit 3\n');
    chmodSync(failing, 0o755);
    expect(await generateCommitMessageWithClaude(failing, 'diff')).toBeNull();
    expect(await generateCommitMessageWithClaude(join(root, 'missing-claude'), 'diff')).toBeNull();
  });

  it('summarises unique paths and line changes', () => {
    const diff = '--- a/Old.lean\n+++ b/Main.lean\n+new\n-old\n--- a/Other.lean\n+++ b/Other.lean\n+added\n';
    expect(fallbackCommitMessage(diff, 'Requested by user.')).toEqual({
      subject: 'Update 2 files',
      body: 'Changed: Main.lean, Other.lean.\n\nLine changes: +2 / -1.\n\nRequested by user.',
    });
    expect(fallbackCommitMessage('', null)).toEqual({ subject: 'Update files', body: null });
    const many = Array.from({ length: 7 }, (_, index) => `+++ b/f${index}.tex`).join('\n');
    expect(fallbackCommitMessage(many).body).toBe('Changed: f0.tex, f1.tex, f2.tex, f3.tex, f4.tex, and 2 more.');
  });

  it('builds agent subjects and splits model output', () => {
    expect(agentCommitSubject('\n  Prove   the lemma\nmore', false)).toBe('Agent: Prove the lemma');
    expect(agentCommitSubject('', true)).toBe('Agent (incomplete): Update formalization files');
    expect(agentCommitSubject('x'.repeat(100), false)).toBe(`Agent: ${'x'.repeat(71)}…`);
    expect(splitSubjectBody('```\nSubject: "Add lemma."\n\nBody here\n```')).toEqual({ subject: 'Add lemma', body: 'Body here' });
    expect(splitSubjectBody('Only subject\nsecond line')).toEqual({ subject: 'Only subject', body: 'second line' });
    expect(splitSubjectBody('')).toEqual({ subject: '', body: null });
  });
});

describe('sync and status', () => {
  it('degrades gracefully without a remote', async () => {
    const dir = initRepo(root);
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    const sha = commitAll(dir, 'base');
    expect(await syncBranch(dir, 'main')).toEqual({ status: 'up_to_date', before_sha: sha, after_sha: sha });
    expect(await branchStatus(dir, 'main')).toEqual({ branch: 'main', is_dirty: false, commits_ahead: 0, commits_behind: 0, is_diverged: false, needs_reconcile: false });
    writeFileSync(join(dir, 'x.txt'), 'x\n');
    expect((await branchStatus(dir, 'main'))?.is_dirty).toBe(true);
    const fresh = await branchFreshness(dir);
    expect(fresh).toEqual({ default_branch: 'main', base_sha: sha, current_default_sha: sha, commits_behind: 0, is_stale: false });
  });

  it('fast-forwards from origin and rejects dirty or unpushed checkouts', async () => {
    const { clone, second } = initWithOrigin(root);
    const before = git(clone, 'rev-parse', 'HEAD');
    advanceRemote(second, 'one');
    const result = await syncBranch(clone, 'main');
    expect(result.status).toBe('updated');
    expect(result.before_sha).toBe(before);
    expect(result.after_sha).toBe(git(second, 'rev-parse', 'HEAD'));
    expect(await syncBranch(clone, 'main')).toMatchObject({ status: 'up_to_date' });
    writeFileSync(join(clone, 'f.txt'), 'dirty\n');
    await expect(syncBranch(clone, 'main')).rejects.toMatchObject({ status: 409, detail: 'Commit or discard local changes before syncing from GitHub.' });
    git(clone, 'checkout', '-q', 'f.txt');
    writeFileSync(join(clone, 'local.txt'), 'l\n');
    commitAll(clone, 'local');
    await expect(syncBranch(clone, 'main')).rejects.toMatchObject({ status: 409, detail: expect.stringContaining('unpushed commits') });
  });

  it('classifies branch status against origin', async () => {
    const { clone, second } = initWithOrigin(root);
    expect(await branchStatus(clone, 'main')).toMatchObject({ commits_ahead: 0, commits_behind: 0, needs_reconcile: false });
    advanceRemote(second, 'one');
    git(clone, 'fetch', '-q', 'origin');
    expect(await branchStatus(clone, 'main')).toMatchObject({ commits_behind: 1, commits_ahead: 0, is_diverged: false, needs_reconcile: false });
    writeFileSync(join(clone, 'dirty.txt'), 'd\n');
    expect(await branchStatus(clone, 'main')).toMatchObject({ is_dirty: true, needs_reconcile: true });
    commitAll(clone, 'local');
    expect(await branchStatus(clone, 'main')).toMatchObject({ commits_ahead: 1, commits_behind: 1, is_diverged: true, needs_reconcile: true });
    git(clone, 'reset', '-q', '--hard', 'origin/main');
    writeFileSync(join(clone, 'ahead.txt'), 'a\n');
    commitAll(clone, 'ahead');
    expect(await branchStatus(clone, 'main')).toMatchObject({ commits_ahead: 1, commits_behind: 0, needs_reconcile: false });
    expect(await branchStatus(clone, '-bad')).toBeNull();
  });

  it('merges the default branch into a feature branch, with and without a remote', async () => {
    const dir = initRepo(root);
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    commitAll(dir, 'base');
    git(dir, 'checkout', '-q', '-b', 'feature');
    writeFileSync(join(dir, 'b.txt'), 'b\n');
    const featureSha = commitAll(dir, 'feature work');
    git(dir, 'checkout', '-q', 'main');
    writeFileSync(join(dir, 'a.txt'), 'a2\n');
    const mainSha = commitAll(dir, 'main advance');
    git(dir, 'checkout', '-q', 'feature');
    const stale = await branchFreshness(dir);
    expect(stale).toMatchObject({ default_branch: 'main', commits_behind: 1, is_stale: true, current_default_sha: mainSha });
    const result = await syncFromMain(dir, { identity });
    expect(result.status).toBe('updated');
    expect(result.before_sha).toBe(featureSha);
    expect(result.freshness).toMatchObject({ commits_behind: 0, is_stale: false });
    expect(git(dir, 'log', '-1', '--format=%cn')).toBe('Test');
    expect(await syncFromMain(dir, { identity })).toMatchObject({ status: 'up_to_date' });
    git(dir, 'checkout', '-q', 'main');
    expect(await syncFromMain(dir, { identity })).toMatchObject({ status: 'up_to_date' });
  });

  it('fast-forwards the checked-out default branch from origin on sync-main', async () => {
    const { clone, second } = initWithOrigin(root);
    git(clone, 'remote', 'set-head', 'origin', 'main');
    const before = git(clone, 'rev-parse', 'HEAD');
    advanceRemote(second, 'one');
    git(clone, 'fetch', '-q', 'origin');
    expect(await branchFreshness(clone)).toMatchObject({ default_branch: 'main', commits_behind: 1, is_stale: true });
    const result = await syncFromMain(clone, { identity });
    expect(result).toMatchObject({ status: 'updated', before_sha: before, after_sha: git(second, 'rev-parse', 'HEAD') });
    expect(result.freshness).toMatchObject({ commits_behind: 0, is_stale: false });
    expect(await syncFromMain(clone, { identity })).toMatchObject({ status: 'up_to_date' });
  });

  it('undoes a merge without discarding untouched local edits', async () => {
    const dir = initRepo(root);
    mkdirSync(join(dir, '.claude'));
    writeFileSync(join(dir, '.claude', 'settings.json'), '{"a":1}\n');
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    commitAll(dir, 'base');
    git(dir, 'checkout', '-q', '-b', 'feature');
    writeFileSync(join(dir, 'b.txt'), 'b\n');
    const featureSha = commitAll(dir, 'feature');
    git(dir, 'checkout', '-q', 'main');
    writeFileSync(join(dir, 'a.txt'), 'a2\n');
    commitAll(dir, 'main');
    git(dir, 'checkout', '-q', 'feature');
    // A tracked file the dirty probe ignores, edited but uncommitted.
    writeFileSync(join(dir, '.claude', 'settings.json'), '{"a":2}\n');
    expect(await dirtyContentPaths(dir)).toEqual([]);
    await expect(
      syncFromMain(dir, { identity, validate: async () => ({ status: 'build_failed', message: 'cached errors' }) }),
    ).rejects.toMatchObject({ status: 409, detail: 'Lean validation blocked the target-branch merge: cached errors' });
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(featureSha);
    expect(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8')).toBe('{"a":2}\n');
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('a\n');
    expect(await undoMerge(dir, null)).toBe(false);
  });

  it('aborts conflicting merges and rolls back on validation failure', async () => {
    const dir = initRepo(root);
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    commitAll(dir, 'base');
    git(dir, 'checkout', '-q', '-b', 'feature');
    writeFileSync(join(dir, 'a.txt'), 'feature\n');
    const featureSha = commitAll(dir, 'feature');
    git(dir, 'checkout', '-q', 'main');
    writeFileSync(join(dir, 'a.txt'), 'main\n');
    commitAll(dir, 'main');
    git(dir, 'checkout', '-q', 'feature');
    await expect(syncFromMain(dir, { identity })).rejects.toMatchObject({ status: 409, detail: expect.stringContaining('Could not merge main into feature') });
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(featureSha);
    expect(git(dir, 'status', '--porcelain')).toBe('');
    git(dir, 'checkout', '-q', 'main');
    writeFileSync(join(dir, 'a.txt'), 'feature\n');
    commitAll(dir, 'align');
    writeFileSync(join(dir, 'c.lean'), 'c\n');
    commitAll(dir, 'lean on main');
    git(dir, 'checkout', '-q', 'feature');
    await expect(
      syncFromMain(dir, { identity, validate: async () => ({ status: 'build_failed', message: 'cached errors' }) }),
    ).rejects.toMatchObject({ status: 409, detail: 'Lean validation blocked the target-branch merge: cached errors' });
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(featureSha);
    await expect(syncFromMain(dir, { identity, base: 'nope' })).rejects.toMatchObject({ status: 403 });
    writeFileSync(join(dir, 'dirty.txt'), 'd\n');
    await expect(syncFromMain(dir, { identity })).rejects.toMatchObject({ status: 409, detail: 'Commit or discard local changes before syncing from the target branch.' });
  });
});

describe('stats', () => {
  it('buckets commits into 52 ISO weeks oldest-first', () => {
    const now = new Date('2026-09-09T12:00:00Z'); // a Wednesday
    const thisWeek = Date.UTC(2026, 8, 7, 8) / 1000; // Monday of the same week
    const lastWeek = Date.UTC(2026, 8, 6, 8) / 1000; // Sunday before
    const ancient = Date.UTC(2020, 0, 1) / 1000;
    const buckets = bucketWeeklyCommits([thisWeek, thisWeek, lastWeek, ancient], now);
    expect(buckets).toHaveLength(52);
    expect(buckets[51]).toBe(2);
    expect(buckets[50]).toBe(1);
    expect(buckets.reduce((sum, value) => sum + value, 0)).toBe(3);
  });

  it('counts recent commits and Lean line changes', async () => {
    const dir = initRepo(root);
    writeFileSync(join(dir, 'A.lean'), 'a\n');
    commitAll(dir, 'base');
    git(dir, 'checkout', '-q', '-b', 'feature');
    writeFileSync(join(dir, 'A.lean'), 'a\nb\n');
    writeFileSync(join(dir, 'scratch_x.lean'), 'ignored\n');
    commitAll(dir, 'more');
    writeFileSync(join(dir, 'B.lean'), 'x\ny');
    writeFileSync(join(dir, 'A.lean'), 'a\nb\nc\n');
    const weekly = await weeklyCommits(dir);
    expect(weekly).toHaveLength(52);
    expect(weekly[51]).toBe(2);
    const stats = await leanFileDiffStats(dir, await defaultCompareRef(dir));
    expect(stats).toEqual({ 'A.lean': { added: 2, deleted: 0 }, 'B.lean': { added: 2, deleted: 0 } });
    expect(await leanFileDiffStats(dir, null)).toEqual({});
  });
});
