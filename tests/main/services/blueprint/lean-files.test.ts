import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeLeanFileDiffStats,
  diffStatsInProject,
  entryLeanFiles,
  filesInProject,
  includeInferredLeanFile,
  inferLeanFilesFromClone,
  leanModuleToPath,
  leanProjectRoot,
  listAllLeanFiles,
  mergeLeanFileLists,
  normalizeGitStatusPath,
  parseLeanNumstat,
  readCloneFile,
  readUtf8Text,
  resolveDefaultCompareRef,
  runGit,
  universalNewlines,
} from '@main/services/blueprint/lean-files';

let tmp: string;

function write(root: string, relative: string, content: string): void {
  const target = join(root, ...relative.split('/'));
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}

function initRepo(cwd: string, branch = 'main'): void {
  git(cwd, 'init', '-q', '-b', branch);
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'Test');
  git(cwd, 'config', 'commit.gpgsign', 'false');
}

function commitAll(cwd: string, message: string): void {
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', message);
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'fuse-lean-files-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

describe('pure helpers', () => {
  it.each([
    ['Numina/Blueprints/Froda.lean', true],
    ['Numina/Blueprints/Scratch_thm_froda.lean', false],
    ['Numina/Blueprints/scratch_thm_froda.lean', false],
    ['Numina/Blueprints/scratchpad.lean', false],
    ['Numina/Blueprints/ProofScratch.lean', true],
    ['Numina/Blueprints/Scratch.txt', false],
  ])('includeInferredLeanFile(%s) is %s', (path, expected) => {
    expect(includeInferredLeanFile(path)).toBe(expected);
  });

  it('normalizes leanModule values into paths', () => {
    expect(leanModuleToPath('Numina.Blueprints.Froda')).toBe('Numina/Blueprints/Froda.lean');
    expect(leanModuleToPath('MyProject/Froda.lean')).toBe('MyProject/Froda.lean');
    expect(leanModuleToPath('Froda.lean')).toBe('Froda.lean');
  });

  it('merges file lists uniquely in first-seen order', () => {
    expect(mergeLeanFileLists(['a', '', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(entryLeanFiles([{ lean_file: ' A.lean ' }, { lean_file: '' }, { lean_file: 'A.lean' }])).toEqual(['A.lean']);
  });

  it('scopes paths and stats to the project subdir', () => {
    expect(filesInProject(['lean/k/A.lean', 'other/B.lean'], 'lean/k')).toEqual(['lean/k/A.lean']);
    expect(filesInProject(['lean/k/A.lean', 'other/B.lean'], '')).toEqual(['lean/k/A.lean', 'other/B.lean']);
    expect(diffStatsInProject({ 'lean/k/A.lean': { added: 1, deleted: 0 }, 'other/B.lean': { added: 2, deleted: 0 } }, 'lean/k')).toEqual({ 'lean/k/A.lean': { added: 1, deleted: 0 } });
  });

  it('parses numstat output, skipping binary and zero-change files', () => {
    expect(parseLeanNumstat('3\t1\tA.lean\n-\t-\tB.lean\n0\t0\tC.lean\n2\t0\tscratch.lean\n1\t0\tD.txt\nx\ty\tE.lean\n')).toEqual({ 'A.lean': { added: 3, deleted: 1 } });
  });

  it('takes the new side of a renamed porcelain path', () => {
    expect(normalizeGitStatusPath('old.lean -> new.lean')).toBe('new.lean');
    expect(normalizeGitStatusPath('same.lean')).toBe('same.lean');
  });

  it('translates newlines the way Python read_text does', () => {
    expect(universalNewlines('a\r\nb\rc\n')).toBe('a\nb\nc\n');
  });
});

describe('listAllLeanFiles', () => {
  it('skips scratch files, .lake, .git and node_modules', async () => {
    const clone = join(tmp, 'clone');
    for (const relative of [
      'Numina/Blueprints/Froda.lean',
      'Numina/Blueprints/ProofScratch.lean',
      'Numina/Blueprints/Scratch_thm_froda.lean',
      'Numina/Blueprints/scratch_thm_froda.lean',
      'Numina/Blueprints/scratchpad.lean',
      '.lake/packages/mathlib/Mathlib/Scratch.lean',
      '.git/Hook.lean',
      'node_modules/x/Y.lean',
      'notes.txt',
    ]) {
      write(clone, relative, '-- test\n');
    }
    await expect(listAllLeanFiles(clone)).resolves.toEqual(['Numina/Blueprints/Froda.lean', 'Numina/Blueprints/ProofScratch.lean']);
    await expect(listAllLeanFiles(join(tmp, 'missing'))).resolves.toEqual([]);
  });
});

describe('readCloneFile', () => {
  it('keeps a UTF-8 BOM as text, like Python read_text with the utf-8 codec', () => {
    const clone = join(tmp, 'clone');
    write(clone, 'bom.tex', '\uFEFF\\chapter{One}\r\n');
    expect(readUtf8Text(join(clone, 'bom.tex'))).toBe('\uFEFF\\chapter{One}\r\n');
    expect(readCloneFile(clone, 'bom.tex')).toBe('\uFEFF\\chapter{One}\n');
  });

  it('reads contained files with universal newlines and refuses escapes', () => {
    const clone = join(tmp, 'clone');
    write(clone, 'a/b.tex', 'x\r\ny\n');
    writeFileSync(join(tmp, 'outside.tex'), 'secret');
    expect(readCloneFile(clone, 'a/b.tex')).toBe('x\ny\n');
    expect(readCloneFile(clone, 'missing.tex')).toBe('');
    expect(readCloneFile(clone, 'a')).toBe('');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readCloneFile(clone, '../outside.tex')).toBe('');
    writeFileSync(join(clone, 'bad.tex'), Buffer.from([0xff, 0xfe]));
    expect(readCloneFile(clone, 'bad.tex')).toBe('');
    expect(warn).toHaveBeenCalled();
  });
});

describe('leanProjectRoot', () => {
  it('finds the nearest lakefile ancestor strictly inside the clone', () => {
    const clone = join(tmp, 'clone');
    write(clone, 'lean/kakeya/lakefile.toml', '');
    write(clone, 'lean/kakeya/blueprint/src/content.tex', '');
    write(clone, 'blueprint/src/content.tex', '');
    expect(leanProjectRoot(clone, 'lean/kakeya/blueprint/src/content.tex')).toBe(join(clone, 'lean', 'kakeya'));
    expect(leanProjectRoot(clone, 'blueprint/src/content.tex')).toBe(clone);
    expect(leanProjectRoot(clone, null)).toBe(clone);
    write(clone, 'lakefile.lean', '');
    // The clone root itself is never probed: it is the fallback anyway.
    expect(leanProjectRoot(clone, 'blueprint/src/content.tex')).toBe(clone);
  });
});

describe('git-backed helpers', () => {
  it('degrade to empty results on a folder that is not a git repository', async () => {
    const clone = join(tmp, 'plain');
    write(clone, 'A.lean', 'theorem t : True := trivial\n');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await runGit(clone, ['rev-parse', 'HEAD'])).toBeNull();
    expect(await resolveDefaultCompareRef(clone)).toBeNull();
    expect(await inferLeanFilesFromClone(clone, 'demo')).toEqual([]);
    expect(await computeLeanFileDiffStats(clone)).toEqual({});
    expect(await inferLeanFilesFromClone(join(tmp, 'does-not-exist'), 'demo')).toEqual([]);
  });

  it('report branch changes and diff stats against the default branch', async () => {
    const clone = join(tmp, 'repo');
    mkdirSync(clone);
    initRepo(clone, 'main');
    write(clone, 'Base.lean', 'def base := 1\n');
    write(clone, 'Untouched.lean', 'def untouched := 1\n');
    commitAll(clone, 'initial');
    git(clone, 'checkout', '-q', '-b', 'feature');
    write(clone, 'Base.lean', 'def base := 1\ndef more := 2\n');
    write(clone, 'Committed.lean', 'def committed := 1\n');
    write(clone, 'scratch_probe.lean', 'def probe := 1\n');
    commitAll(clone, 'feature work');
    write(clone, 'Untracked.lean', 'line one\nline two\n');
    write(clone, 'notes.txt', 'ignored');

    expect(await resolveDefaultCompareRef(clone)).toBe('main');
    expect(await inferLeanFilesFromClone(clone, 'demo', 'main')).toEqual(['Base.lean', 'Committed.lean', 'Untracked.lean']);
    expect(await computeLeanFileDiffStats(clone, 'main')).toEqual({
      'Base.lean': { added: 1, deleted: 0 },
      'Committed.lean': { added: 1, deleted: 0 },
      'Untracked.lean': { added: 2, deleted: 0 },
    });
    expect(await computeLeanFileDiffStats(clone, null)).toEqual({});
  });

  it('fall back to HEAD when no conventional default branch exists', async () => {
    const clone = join(tmp, 'trunk');
    mkdirSync(clone);
    initRepo(clone, 'trunk');
    write(clone, 'A.lean', 'def a := 1\n');
    commitAll(clone, 'initial');
    write(clone, 'A.lean', 'def a := 1\ndef b := 2\n');
    expect(await resolveDefaultCompareRef(clone)).toBe('HEAD');
    expect(await inferLeanFilesFromClone(clone, 'demo', 'HEAD')).toEqual(['A.lean']);
    expect(await computeLeanFileDiffStats(clone, 'HEAD')).toEqual({ 'A.lean': { added: 1, deleted: 0 } });
  });

  it('fall back to app-authored blueprint commits when nothing changed', async () => {
    const clone = join(tmp, 'history');
    mkdirSync(clone);
    initRepo(clone, 'main');
    write(clone, 'Demo/Main.lean', 'def a := 1\n');
    commitAll(clone, 'Update blueprint demo');
    expect(await inferLeanFilesFromClone(clone, 'demo', 'main')).toEqual(['Demo/Main.lean']);
    expect(await inferLeanFilesFromClone(clone, 'other', 'main')).toEqual([]);
  });
});
