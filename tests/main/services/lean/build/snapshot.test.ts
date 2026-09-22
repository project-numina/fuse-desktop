import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeDepsState,
  DEPS_READY_MARKER,
  depsReady,
  FAILED_DEPENDENCIES_PREFIX,
  lspSnapshotDiagnostics,
  markDepsReady,
  mergeFailedDependencies,
  readMatchingFileDiagnostics,
  readSnapshot,
  replaceAll,
  replaceFiles,
  replaceSingleFile,
  repoRelativeCounts,
  SNAPSHOT_FILE,
  snapshotCounts,
  snapshotLeanSourceHashes,
  snapshotMtime,
  sourceContentHash,
  unchangedSourceHashes,
} from '@main/services/lean/build/snapshot';
import type { Diagnostic } from '@main/services/lean/diagnostics';

function diagnostic(file: string, severity = 'error', message = 'x'): Diagnostic {
  return { file, line: 1, column: 1, severity, message };
}

function contentHashes(root: string, ...files: string[]): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const file of files) {
    const hash = sourceContentHash(join(root, file));
    expect(hash).not.toBeNull();
    hashes[file] = hash as string;
  }
  return hashes;
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fuse-snapshot-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function setupDepsFiles(toolchain = 'leanprover/lean4:v4.30.0-rc2', manifest = '{"packages": []}'): void {
  writeFileSync(join(root, 'lean-toolchain'), toolchain);
  writeFileSync(join(root, 'lake-manifest.json'), manifest);
}

describe('deps-ready marker', () => {
  it('is initially not ready', () => {
    expect(depsReady(root)).toBe(false);
  });

  it('matches the recorded state', () => {
    setupDepsFiles();
    markDepsReady(root, computeDepsState(root));
    expect(readdirSync(dirname(join(root, DEPS_READY_MARKER)))).toContain('.deps-ready');
    expect(depsReady(root)).toBe(true);
  });

  it('is invalidated by a toolchain change', () => {
    setupDepsFiles();
    markDepsReady(root, computeDepsState(root));
    expect(depsReady(root)).toBe(true);
    writeFileSync(join(root, 'lean-toolchain'), 'leanprover/lean4:v4.31.0');
    expect(depsReady(root)).toBe(false);
  });

  it('is invalidated by a manifest change', () => {
    setupDepsFiles();
    markDepsReady(root, computeDepsState(root));
    writeFileSync(join(root, 'lake-manifest.json'), '{"packages": [{"name": "foo"}]}');
    expect(depsReady(root)).toBe(false);
  });

  it('treats a corrupt marker as absent', () => {
    setupDepsFiles();
    const marker = join(root, DEPS_READY_MARKER);
    mkdirSync(dirname(marker), { recursive: true });
    writeFileSync(marker, 'not json');
    expect(depsReady(root)).toBe(false);
  });
});

describe('replaceAll', () => {
  it('writes grouped by file', () => {
    replaceAll(root, [diagnostic('Foo.lean', 'error', 'a'), diagnostic('Bar.lean', 'error', 'b'), diagnostic('Foo.lean', 'error', 'c')]);
    const snapshot = readSnapshot(root);
    expect(Object.keys(snapshot).sort()).toEqual(['Bar.lean', 'Foo.lean']);
    expect(snapshot['Foo.lean'].map((d) => d.message)).toEqual(['a', 'c']);
  });

  it('replaces the existing snapshot', () => {
    replaceAll(root, [diagnostic('Foo.lean')]);
    replaceAll(root, [diagnostic('Bar.lean')]);
    expect(Object.keys(readSnapshot(root))).toEqual(['Bar.lean']);
  });
});

describe('replaceFiles', () => {
  it('keeps files outside the scope', () => {
    replaceAll(root, [diagnostic('Foo.lean'), diagnostic('Bar.lean')]);
    replaceFiles(root, ['Foo.lean'], [diagnostic('Foo.lean', 'error', 'new')]);
    const snapshot = readSnapshot(root);
    expect(snapshot).toHaveProperty('Bar.lean');
    expect(snapshot['Foo.lean'][0].message).toBe('new');
  });

  it('removes the entry of a cleanly rebuilt file', () => {
    replaceAll(root, [diagnostic('Foo.lean')]);
    replaceFiles(root, ['Foo.lean'], []);
    expect(readSnapshot(root)).toEqual({});
  });
});

describe('replaceSingleFile and hash attestation', () => {
  it('clears entries when there are no diagnostics', () => {
    replaceAll(root, [diagnostic('Foo.lean')]);
    replaceSingleFile(root, 'Foo.lean', []);
    expect(readSnapshot(root)).toEqual({});
  });

  it('does not touch other files', () => {
    replaceAll(root, [diagnostic('Foo.lean'), diagnostic('Bar.lean')]);
    replaceSingleFile(root, 'Foo.lean', [diagnostic('Foo.lean', 'error', 'new')]);
    const snapshot = readSnapshot(root);
    expect(snapshot['Bar.lean'][0].message).toBe('x');
    expect(snapshot['Foo.lean'][0].message).toBe('new');
  });

  it('returns matching diagnostics for current content', () => {
    writeFileSync(join(root, 'Foo.lean'), 'theorem foo : False := by trivial\n');
    replaceSingleFile(root, 'Foo.lean', [diagnostic('Foo.lean')], contentHashes(root, 'Foo.lean'));
    const diagnostics = readMatchingFileDiagnostics(root, 'Foo.lean');
    expect(diagnostics).not.toBeNull();
    expect(diagnostics?.[0].severity).toBe('error');
  });

  it('does not return stale diagnostics for edited content', () => {
    const source = join(root, 'Foo.lean');
    writeFileSync(source, 'theorem foo : False := by trivial\n');
    replaceSingleFile(root, 'Foo.lean', [diagnostic('Foo.lean')], contentHashes(root, 'Foo.lean'));
    writeFileSync(source, 'theorem foo : True := by trivial\n');
    expect(readMatchingFileDiagnostics(root, 'Foo.lean')).toBeNull();
  });

  it('preserves other file hashes on a partial update', () => {
    writeFileSync(join(root, 'Foo.lean'), 'theorem foo : False := by trivial\n');
    writeFileSync(join(root, 'Bar.lean'), 'theorem bar : False := by trivial\n');
    replaceAll(root, [diagnostic('Foo.lean'), diagnostic('Bar.lean')], contentHashes(root, 'Foo.lean', 'Bar.lean'));
    writeFileSync(join(root, 'Bar.lean'), 'theorem bar : True := by trivial\n');
    replaceSingleFile(root, 'Foo.lean', [diagnostic('Foo.lean', 'error', 'new')], contentHashes(root, 'Foo.lean'));
    expect(readMatchingFileDiagnostics(root, 'Bar.lean')).toBeNull();
    expect(readMatchingFileDiagnostics(root, 'Foo.lean')).not.toBeNull();
  });

  it('does not attest content changed during diagnostics', () => {
    const source = join(root, 'Foo.lean');
    writeFileSync(source, 'theorem foo : False := by trivial\n');
    const observed = sourceContentHash(source) as string;
    writeFileSync(source, 'theorem foo : True := by trivial\n');
    const stable = unchangedSourceHashes(root, { 'Foo.lean': observed });
    replaceSingleFile(root, 'Foo.lean', [diagnostic('Foo.lean')], stable);
    expect(stable).toEqual({});
    expect(readMatchingFileDiagnostics(root, 'Foo.lean')).toBeNull();
  });

  it('rejects absolute and parent-traversal keys when checking unchanged hashes', () => {
    writeFileSync(join(root, 'Foo.lean'), 'x');
    const hash = sourceContentHash(join(root, 'Foo.lean')) as string;
    expect(unchangedSourceHashes(root, { '../Foo.lean': hash, [join(root, 'Foo.lean')]: hash, 'Foo.lean': hash })).toEqual({ 'Foo.lean': hash });
  });

  it('treats a legacy v1 snapshot as unknown', () => {
    writeFileSync(join(root, 'Foo.lean'), 'theorem foo : False := by trivial\n');
    const snapshotPath = join(root, SNAPSHOT_FILE);
    mkdirSync(dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, JSON.stringify({ version: 1, files: { 'Foo.lean': [diagnostic('Foo.lean')] } }));
    expect(readMatchingFileDiagnostics(root, 'Foo.lean')).toBeNull();
    expect(readSnapshot(root)['Foo.lean']).toHaveLength(1);
  });

  it('does not match a missing hash against a missing file', () => {
    replaceSingleFile(root, 'Missing.lean', [diagnostic('Missing.lean')]);
    expect(readMatchingFileDiagnostics(root, 'Missing.lean')).toBeNull();
  });

  it('excludes local dependencies from the source hash scan', () => {
    writeFileSync(join(root, 'Foo.lean'), 'theorem foo : True := by trivial\n');
    const dependency = join(root, '.lake', 'packages', 'dep', 'Dep.lean');
    mkdirSync(dirname(dependency), { recursive: true });
    writeFileSync(dependency, 'theorem dep : True := by trivial\n');
    mkdirSync(join(root, 'Sub'));
    writeFileSync(join(root, 'Sub', 'Nested.LEAN'), 'x');
    expect(Object.keys(snapshotLeanSourceHashes(root)).sort()).toEqual(['Foo.lean', 'Sub/Nested.LEAN']);
  });
});

describe('LSP-derived entries', () => {
  it('keeps errors and warnings and appends the synthetic dependency error', () => {
    const items = [
      { severity: 'error', message: 'e', line: 2, column: 3 },
      { severity: 'hint', message: 'h', line: 4, column: 1 },
      { severity: 'warning', message: 'w', line: 5, column: 6 },
      { severity: 'info', message: 'i', line: 6, column: 1 },
    ];
    const diagnostics = lspSnapshotDiagnostics('Foo.lean', items, ['A.lean', 'B.lean']);
    expect(diagnostics).toEqual([
      { file: 'Foo.lean', line: 2, column: 3, severity: 'error', message: 'e' },
      { file: 'Foo.lean', line: 5, column: 6, severity: 'warning', message: 'w' },
      { file: 'Foo.lean', line: 1, column: 1, severity: 'error', message: `${FAILED_DEPENDENCIES_PREFIX}A.lean, B.lean` },
    ]);
  });

  it('merges failed dependencies onto hash-attested diagnostics only', () => {
    writeFileSync(join(root, 'Foo.lean'), 'content');
    const hash = sourceContentHash(join(root, 'Foo.lean')) as string;
    replaceSingleFile(
      root,
      'Foo.lean',
      [diagnostic('Foo.lean', 'error', 'real'), { file: 'Foo.lean', line: 1, column: 1, severity: 'error', message: `${FAILED_DEPENDENCIES_PREFIX}Old.lean` }],
      { 'Foo.lean': hash },
    );
    const merged = mergeFailedDependencies(root, 'Foo.lean', ['New.lean'], hash);
    expect(merged['Foo.lean'].map((d) => d.message)).toEqual(['real', `${FAILED_DEPENDENCIES_PREFIX}New.lean`]);

    // Stale (unattested) diagnostics are dropped, only the dependency error survives.
    writeFileSync(join(root, 'Foo.lean'), 'changed');
    const newHash = sourceContentHash(join(root, 'Foo.lean')) as string;
    const after = mergeFailedDependencies(root, 'Foo.lean', ['New.lean'], newHash);
    expect(after['Foo.lean'].map((d) => d.message)).toEqual([`${FAILED_DEPENDENCIES_PREFIX}New.lean`]);
    expect(mergeFailedDependencies(root, 'Foo.lean', [], newHash)).toEqual(after);
  });
});

describe('snapshotCounts', () => {
  it('groups by severity', () => {
    replaceAll(root, [diagnostic('Foo.lean', 'error'), diagnostic('Foo.lean', 'warning'), diagnostic('Foo.lean', 'warning'), diagnostic('Bar.lean', 'error')]);
    expect(snapshotCounts(readSnapshot(root))).toEqual({ 'Foo.lean': { errors: 1, warnings: 2 }, 'Bar.lean': { errors: 1, warnings: 0 } });
  });

  it('drops clean files', () => {
    expect(snapshotCounts({ 'Foo.lean': [], 'Bar.lean': [diagnostic('Bar.lean')], 'Baz.lean': [diagnostic('Baz.lean', 'info')] })).toEqual({
      'Bar.lean': { errors: 1, warnings: 0 },
    });
  });

  it('re-keys counts to repo-relative paths for a nested project', () => {
    expect(repoRelativeCounts({ 'Foo.lean': { errors: 1, warnings: 0 } }, 'lean')).toEqual({ 'lean/Foo.lean': { errors: 1, warnings: 0 } });
    expect(repoRelativeCounts({ 'Foo.lean': { errors: 1, warnings: 0 } }, '')).toEqual({ 'Foo.lean': { errors: 1, warnings: 0 } });
  });
});

describe('snapshotMtime and atomic writes', () => {
  it('returns null for a missing snapshot and a number once written', () => {
    expect(snapshotMtime(root)).toBeNull();
    replaceAll(root, [diagnostic('Foo.lean')]);
    expect(snapshotMtime(root)).toBeGreaterThan(0);
  });

  it('leaves no temp files behind', () => {
    replaceAll(root, [diagnostic('Foo.lean')]);
    const leftovers = readdirSync(dirname(join(root, SNAPSHOT_FILE))).filter((name) => name.includes('.tmp.'));
    expect(leftovers).toEqual([]);
  });

  it('never exposes a partial write to readers', () => {
    replaceAll(root, [diagnostic('Foo.lean', 'error', 'first')]);
    for (let index = 0; index < 20; index += 1) {
      replaceAll(root, [diagnostic('Foo.lean', 'error', `iteration-${index}`)]);
      const current = readSnapshot(root);
      expect(current).toHaveProperty('Foo.lean');
      const message = current['Foo.lean'][0].message;
      expect(message.startsWith('iteration-') || message === 'first').toBe(true);
    }
  });

  it('discards a corrupt snapshot', () => {
    const path = join(root, SNAPSHOT_FILE);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{not json');
    expect(readSnapshot(root)).toEqual({});
  });
});
