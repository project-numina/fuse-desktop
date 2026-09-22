import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BUILD_OK_MARKER,
  computeBuildState,
  deleteBuildStamp,
  readBuildStamp,
  STAMP_FILE,
  stampMatchesState,
  statePathspecs,
  statusPathsFromPorcelain,
  worktreeHash,
  writeBuildStamp,
  type BuildState,
} from '@main/services/lean/build/stamp';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fuse-stamp-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const STATE: BuildState = { head: 'abc', worktree_hash: 'w', toolchain_hash: 't', manifest_hash: 'm' };

describe('statePathspecs', () => {
  it('excludes local generated paths relative to the project', () => {
    expect(statePathspecs('.', ['.lake'])).toEqual(['.', ':(exclude).lake']);
    expect(statePathspecs('lean', ['.lake', '.claude'])).toEqual(['lean', ':(exclude)lean/.lake', ':(exclude)lean/.claude']);
    expect(statePathspecs('', ['.lake'])).toEqual(['.', ':(exclude).lake']);
    expect(() => statePathspecs('a\0b')).toThrow();
  });
});

describe('statusPathsFromPorcelain', () => {
  it('extracts paths including rename sources in -z output', () => {
    const status = ' M a.lean\0R  new.lean\0old.lean\0?? untracked.lean\0';
    expect(statusPathsFromPorcelain(status)).toEqual(['a.lean', 'new.lean', 'old.lean', 'untracked.lean']);
  });

  it('handles newline-delimited output', () => {
    expect(statusPathsFromPorcelain(' M a.lean\n?? b.lean\n')).toEqual(['a.lean', 'b.lean']);
    expect(statusPathsFromPorcelain('')).toEqual([]);
  });
});

describe('worktreeHash', () => {
  it('hashes a clean tree to sha256 of the empty string', () => {
    expect(worktreeHash(root, '')).toBe(createHash('sha256').update('').digest('hex'));
  });

  it('changes when a named file changes and is stable otherwise', () => {
    writeFileSync(join(root, 'a.lean'), 'one');
    const status = ' M a.lean\0';
    const first = worktreeHash(root, status);
    expect(worktreeHash(root, status)).toBe(first);
    writeFileSync(join(root, 'a.lean'), 'two');
    expect(worktreeHash(root, status)).not.toBe(first);
    mkdirSync(join(root, 'dir'));
    expect(worktreeHash(root, '?? dir\0')).not.toBe(worktreeHash(root, '?? missing\0'));
  });
});

describe('build stamp file', () => {
  it('round-trips and removes the legacy marker', () => {
    writeFileSync(join(root, BUILD_OK_MARKER), '');
    expect(readBuildStamp(root)).toBeNull();
    writeBuildStamp(root, STATE, 'errors');
    const stamp = readBuildStamp(root);
    expect(stamp).toMatchObject({ ...STATE, outcome: 'errors' });
    expect(typeof stamp?.attempted_at).toBe('string');
    expect(() => readFileSync(join(root, BUILD_OK_MARKER))).toThrow();
    deleteBuildStamp(root);
    expect(readBuildStamp(root)).toBeNull();
  });

  it('rejects malformed stamps', () => {
    mkdirSync(join(root, '.lake'));
    writeFileSync(join(root, STAMP_FILE), JSON.stringify({ ...STATE, outcome: 'weird', attempted_at: 'now' }));
    expect(readBuildStamp(root)).toBeNull();
    writeFileSync(join(root, STAMP_FILE), JSON.stringify({ head: 1 }));
    expect(readBuildStamp(root)).toBeNull();
    writeFileSync(join(root, STAMP_FILE), '[]');
    expect(readBuildStamp(root)).toBeNull();
  });
});

describe('stampMatchesState', () => {
  it('requires every key to match', () => {
    const stamp = { ...STATE, outcome: 'ok' as const, attempted_at: 'x' };
    expect(stampMatchesState(null, STATE)).toBe(false);
    expect(stampMatchesState(stamp, STATE)).toBe(true);
    expect(stampMatchesState(stamp, { ...STATE, head: 'def' })).toBe(false);
    expect(stampMatchesState(stamp, { ...STATE, manifest_hash: 'other' })).toBe(false);
  });

  it('lets a stamp without a worktree hash match a clean tree', () => {
    const clean = createHash('sha256').update('').digest('hex');
    const legacy = { ...STATE, worktree_hash: null as unknown as string, outcome: 'ok' as const, attempted_at: 'x' };
    expect(stampMatchesState(legacy, { ...STATE, worktree_hash: clean })).toBe(true);
    expect(stampMatchesState(legacy, { ...STATE, worktree_hash: 'dirty' })).toBe(false);
  });
});

describe('computeBuildState', () => {
  it('uses a fake git runner with the project-scoped pathspecs', async () => {
    writeFileSync(join(root, 'lean-toolchain'), 'leanprover/lean4:v4.25.0');
    const calls: string[][] = [];
    const gitRunner = async (args: string[]): Promise<string> => {
      calls.push(args);
      if (args[0] === 'rev-parse') return 'abc123\n';
      return '';
    };
    mkdirSync(join(root, '.git'));
    const state = await computeBuildState(root, root, { gitRunner });
    expect(state.head).toBe('abc123');
    expect(state.worktree_hash).toBe(createHash('sha256').update('').digest('hex'));
    expect(state.toolchain_hash).toBe(createHash('sha256').update('leanprover/lean4:v4.25.0').digest('hex'));
    expect(state.manifest_hash).toBe('');
    expect(calls[1]).toEqual(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.', ':(exclude).lake', ':(exclude).claude', ':(exclude)numina/.metadata', ':(exclude).numina/cache']);
  });

  it('scopes the status to a nested project', async () => {
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, 'lean'));
    const calls: string[][] = [];
    await computeBuildState(root, join(root, 'lean'), {
      gitRunner: async (args) => {
        calls.push(args);
        return 'x';
      },
    });
    expect(calls[1].slice(5)).toEqual(['lean', ':(exclude)lean/.lake', ':(exclude)lean/.claude', ':(exclude)lean/numina/.metadata', ':(exclude)lean/.numina/cache']);
  });

  it('falls back to hashing sources when the folder is not a git repository', async () => {
    writeFileSync(join(root, 'A.lean'), 'a');
    const first = await computeBuildState(root, root);
    expect(first.head).toBe('');
    const same = await computeBuildState(root, root);
    expect(same.worktree_hash).toBe(first.worktree_hash);
    writeFileSync(join(root, 'A.lean'), 'b');
    const changed = await computeBuildState(root, root);
    expect(changed.worktree_hash).not.toBe(first.worktree_hash);
  });

  it('works against a real git repository', async () => {
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
    git('init', '-q');
    writeFileSync(join(root, 'A.lean'), 'a');
    git('add', 'A.lean');
    git('commit', '-q', '-m', 'init');
    const clean = await computeBuildState(root, root);
    expect(clean.head).toMatch(/^[0-9a-f]{40}$/);
    expect(clean.worktree_hash).toBe(createHash('sha256').update('').digest('hex'));
    // Tool state under .lake never dirties the worktree hash.
    mkdirSync(join(root, '.lake'));
    writeFileSync(join(root, '.lake', 'junk'), 'x');
    expect((await computeBuildState(root, root)).worktree_hash).toBe(clean.worktree_hash);
    writeFileSync(join(root, 'A.lean'), 'edited');
    const dirty = await computeBuildState(root, root);
    expect(dirty.worktree_hash).not.toBe(clean.worktree_hash);
    expect(dirty.head).toBe(clean.head);
  });
});
