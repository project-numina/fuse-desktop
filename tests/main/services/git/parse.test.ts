import { describe, expect, it } from 'vitest';
import {
  deriveGithubLogin,
  parseCommitPatch,
  parseLogEntry,
  parseNumstat,
  splitLines,
  splitPatchStream,
  synthesizeAddedPatch,
  synthesizeSymlinkPatch,
  unquoteGitPath,
} from '@main/services/git/parse';
import { isSafeBranchName, isValidCommitSha, LOCAL_GENERATED_PATHSPECS } from '@main/services/git/pathspecs';
import { redactGitOutput } from '@main/services/git/run';
import { trackedFiles } from '@main/services/git/changes';

describe('parseNumstat / splitPatchStream', () => {
  it('parses regular, binary and renamed records', () => {
    const regular = '1\t2\ta\tb.txt\0';
    const binary = '-\t-\tb.bin\0';
    const renamed = '3\t4\t\0old name\0new name\0';
    const parsed = parseNumstat(`${regular}${binary}${renamed}bad\0x\ty\0`);
    expect(parsed.get('a\tb.txt')?.additions).toBe(1);
    expect(parsed.get('b.bin')?.binary).toBe(true);
    expect(parsed.get('new name')?.oldPath).toBe('old name');
    expect(parsed.size).toBe(3);
  });

  it('splits patch streams and classifies status', () => {
    const patches = splitPatchStream('diff --git a/a.txt b/a.txt\nnew file mode 100644\n+x');
    expect(patches.get('a.txt')?.status).toBe('added');
    const quoted = splitPatchStream('diff --git "a/a b" "b/a b"\n+x');
    expect(quoted.has('a b')).toBe(true);
    const deleted = splitPatchStream('diff --git a/a.txt b/a.txt\ndeleted file mode 100644');
    expect(deleted.get('a.txt')?.status).toBe('deleted');
    const renamed = splitPatchStream('diff --git a/o.txt b/n.txt\nrename from o.txt\nrename to n.txt');
    expect(renamed.get('n.txt')?.status).toBe('renamed');
    expect(splitPatchStream('not a patch').size).toBe(0);
  });

  it('synthesizes added and symlink patches', () => {
    expect(synthesizeAddedPatch('a.txt', 'line').endsWith('No newline at end of file')).toBe(true);
    expect(synthesizeAddedPatch('empty', '')).toContain('+1,0 @');
    expect(synthesizeAddedPatch('newline', 'one\n')).toContain('+1,1 @');
    expect(synthesizeAddedPatch('plain', 'one')).toContain('+1,1 @');
    expect(synthesizeAddedPatch('many', 'one\ntwo')).toContain('+1,2 @');
    expect(synthesizeSymlinkPatch('link', 'target')).toContain('120000');
    expect(synthesizeAddedPatch('a', 'x\ny\n')).toBe('diff --git a/a b/a\nnew file mode 100644\n--- /dev/null\n+++ b/a\n@@ -0,0 +1,2 @@\n+x\n+y');
  });

  it('decodes C-quoted paths', () => {
    expect(unquoteGitPath('caf\\303\\251 \\"quote\\"')).toBe('café "quote"');
    expect(unquoteGitPath('end\\\\')).toBe('end\\');
    expect(unquoteGitPath('x\\q')).toBe('xq');
    expect(unquoteGitPath('tab\\there')).toBe('tab\there');
    expect(unquoteGitPath('trailing\\')).toBe('trailing\\');
  });

  it('mirrors Python splitlines', () => {
    expect(splitLines('a\nb')).toEqual(['a', 'b']);
    expect(splitLines('a\r\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('')).toEqual([]);
    expect(splitLines('a b')).toEqual(['a', 'b']);
  });
});

describe('parseCommitPatch / parseLogEntry', () => {
  it('validates shas and parses patches', () => {
    expect(isValidCommitSha('deadbeef')).toBe(true);
    expect(isValidCommitSha('HEAD~1')).toBe(false);
    expect(isValidCommitSha('--output=bad')).toBe(false);
    const files = parseCommitPatch('diff --git a/a.txt b/a.txt\nnew file mode 100644\n@@ -0,0 +1 @@\n+one');
    expect(files[0].status).toBe('added');
    expect(files[0].additions).toBe(1);
    expect(files[0].deletions).toBe(0);
    const quoted = parseCommitPatch('diff --git "a/a b" "b/a b"\n@@ -0,0 +1 @@\n+x');
    expect(quoted[0].path).toBe('a b');
    const escaped = parseCommitPatch('diff --git "a/caf\\303\\251" "b/caf\\303\\251"\n+x');
    expect(escaped[0].path).toBe('café');
    expect(parseLogEntry('malformed')).toBeNull();
    expect(parseCommitPatch('not a diff')).toEqual([]);
    expect(() => parseCommitPatch('', 0)).toThrow(/max_patch/);
  });

  it('marks binary and oversized patches as null and reads renames', () => {
    const binary = parseCommitPatch('diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ');
    expect(binary[0].patch).toBeNull();
    const renamed = parseCommitPatch('diff --git a/o b/n\nrename from o\nrename to n\n@@ -1 +1 @@\n-a\n+b');
    expect(renamed[0].status).toBe('renamed');
    expect(renamed[0].old_path).toBe('o');
    expect(renamed[0].deletions).toBe(1);
    const large = parseCommitPatch(`diff --git a/a b/a\n@@ -0,0 +1 @@\n+${'x'.repeat(50)}`, 20);
    expect(large[0].patch).toBeNull();
    expect(large[0].additions).toBe(1);
  });

  it('counts only hunk lines', () => {
    const files = parseCommitPatch('diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1,2 +1,2 @@\n-x\n+y\n context\n--- not a deletion');
    expect(files[0].additions).toBe(1);
    expect(files[0].deletions).toBe(1);
  });

  it('parses log entries and derives logins', () => {
    const entry = parseLogEntry('abcdef1234\x1fJane\x1f1+jane@users.noreply.github.com\x1f2024-01-01T00:00:00+00:00\x1fsubject\n\nbody\n');
    expect(entry?.sha).toBe('abcdef1234');
    expect(entry?.message).toBe('subject\n\nbody');
    expect(deriveGithubLogin(entry!.authorName, entry!.authorEmail)).toBe('jane');
    expect(deriveGithubLogin('legacy', 'legacy@users.noreply.github.com')).toBe('legacy');
    expect(deriveGithubLogin('fuse-desktop[bot]', 'x@example.com')).toBe('fuse-desktop[bot]');
    expect(deriveGithubLogin('Jane', 'jane@example.com')).toBeNull();
  });
});

describe('trackedFiles', () => {
  it('skips phantoms and truncates oversized patches', () => {
    expect(trackedFiles(new Map([['a', { additions: 0, deletions: 0, binary: false, oldPath: null }]]), new Map(), 10)).toEqual([]);
    const files = trackedFiles(
      new Map([['a', { additions: 1, deletions: 0, binary: false, oldPath: null }]]),
      new Map([['a', { body: `diff --git a/a b/a\n+${'x'.repeat(30)}`, status: 'modified' }]]),
      10,
    );
    expect(files[0].truncated).toBe(true);
    expect(files[0].diff).toBeNull();
  });
});

describe('policy helpers', () => {
  it('keeps the generated-path pathspecs verbatim', () => {
    expect(LOCAL_GENERATED_PATHSPECS).toEqual([
      '.',
      ':(exclude).lake',
      ':(exclude).claude',
      ':(exclude)numina/.metadata',
      ':(exclude).numina-source-ready',
      ':(exclude,glob)**/.lake/**',
      ':(exclude,glob)**/.claude/**',
      ':(exclude,glob)**/numina/.metadata/**',
      ':(exclude,icase)scratch*.lean',
      ':(exclude,icase)*/scratch*.lean',
    ]);
  });

  it('validates branch names', () => {
    expect(isSafeBranchName('main')).toBe(true);
    expect(isSafeBranchName('numina/froda')).toBe(true);
    expect(isSafeBranchName('-evil')).toBe(false);
    expect(isSafeBranchName('a..b')).toBe(false);
    expect(isSafeBranchName('x.lock')).toBe(false);
    expect(isSafeBranchName('a b')).toBe(false);
    expect(isSafeBranchName('')).toBe(false);
  });

  it('redacts credentials in git output', () => {
    expect(redactGitOutput('https://user:secret@example.com/x')).toBe('https://user:***@example.com/x');
    expect(redactGitOutput('AUTHORIZATION: basic abc123==', { 'http.extraheader': 'abc123==' })).toBe('AUTHORIZATION: basic ***');
    expect(redactGitOutput('x-access-token:tok@github.com')).toBe('x-access-token:***@github.com');
  });
});
