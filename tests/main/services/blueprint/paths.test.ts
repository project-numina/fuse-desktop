import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_BLUEPRINT_FILE,
  blueprintTexFileFor,
  defaultBlueprintFileForProject,
  legacyBlueprintFilePath,
  listCloneBlueprintFiles,
  resolveExistingEntrypoint,
  resolveProjectBlueprintEntrypoint,
  safeBlueprintFilePath,
} from '@main/services/blueprint/paths';

const NAME = 'froda';

let tmp: string;

function write(relative: string, content = 'x'): void {
  const target = join(tmp, ...relative.split('/'));
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'fuse-paths-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('safeBlueprintFilePath', () => {
  it('accepts repo-relative .tex paths and rejects everything else', () => {
    expect(safeBlueprintFilePath('blueprint/src/content.tex')).toBe('blueprint/src/content.tex');
    expect(safeBlueprintFilePath('  blueprint/src/content.tex  ')).toBe('blueprint/src/content.tex');
    expect(safeBlueprintFilePath(null)).toBeNull();
    expect(safeBlueprintFilePath(42)).toBeNull();
    expect(safeBlueprintFilePath('')).toBeNull();
    expect(safeBlueprintFilePath('/abs/content.tex')).toBeNull();
    expect(safeBlueprintFilePath('a\\b.tex')).toBeNull();
    expect(safeBlueprintFilePath('a/../b.tex')).toBeNull();
    expect(safeBlueprintFilePath('a//b.tex')).toBeNull();
    expect(safeBlueprintFilePath('./b.tex')).toBeNull();
    expect(safeBlueprintFilePath('a/b.txt')).toBeNull();
    expect(safeBlueprintFilePath('a\0b.tex')).toBeNull();
  });
});

describe('entrypoint resolution', () => {
  it('default blueprint file follows the selected Lean project', () => {
    expect(defaultBlueprintFileForProject('')).toBe(DEFAULT_BLUEPRINT_FILE);
    expect(defaultBlueprintFileForProject('lean/kakeya')).toBe('lean/kakeya/blueprint/src/content.tex');
    expect(defaultBlueprintFileForProject(' /lean/kakeya/ ')).toBe('lean/kakeya/blueprint/src/content.tex');
  });

  it('resolves the selected project blueprint from the clone', () => {
    const candidate = 'lean/kakeya/blueprint/src/content.tex';
    write(candidate);
    expect(resolveProjectBlueprintEntrypoint(tmp, 'lean/kakeya')).toBe(candidate);
    expect(resolveProjectBlueprintEntrypoint(tmp, 'lean/other')).toBeNull();
  });

  it('resolves a stored entrypoint without touching disk', () => {
    expect(resolveExistingEntrypoint(tmp, NAME, 'blueprint/src/content.tex')).toBe('blueprint/src/content.tex');
  });

  it('auto-adopts an existing blueprint folder', () => {
    write(DEFAULT_BLUEPRINT_FILE);
    expect(resolveExistingEntrypoint(tmp, NAME, null)).toBe(DEFAULT_BLUEPRINT_FILE);
  });

  it('never auto-adopts the root blueprint for a nested workspace', () => {
    write(DEFAULT_BLUEPRINT_FILE);
    expect(resolveExistingEntrypoint(tmp, NAME, null, 'lean/kakeya')).toBeNull();
    expect(blueprintTexFileFor(tmp, NAME, null, 'lean/kakeya')).toBe(join(tmp, 'lean', 'kakeya', 'blueprint', 'src', 'content.tex'));
  });

  it('falls back to the legacy numina layout', () => {
    const legacy = legacyBlueprintFilePath(NAME);
    write(legacy);
    expect(resolveExistingEntrypoint(tmp, NAME, null)).toBe(legacy);
    expect(legacy).toBe(`numina/blueprints/${NAME}/${NAME}.tex`);
  });

  it('returns null when nothing exists', () => {
    expect(resolveExistingEntrypoint(tmp, NAME, null)).toBeNull();
    expect(blueprintTexFileFor(tmp, NAME, null)).toBe(join(tmp, 'blueprint', 'src', 'content.tex'));
  });
});

describe('listCloneBlueprintFiles', () => {
  it('lists content.tex candidates with the conventional folder first', () => {
    write('blueprint/src/content.tex', 'abc');
    write('appendix/src/content.tex', 'ab');
    write('another/src/content.tex', 'a');
    write('.lake/packages/dep/blueprint/src/content.tex');
    write('numina/blueprints/x/src/content.tex');
    write('src/content.tex');
    // A nested project's build artifacts and vendored trees are pruned too.
    write('nested/.lake/packages/dep/blueprint/src/content.tex');
    write('nested/node_modules/dep/blueprint/src/content.tex');
    write('nested/blueprint/src/content.tex', 'abcd');
    const candidates = listCloneBlueprintFiles(tmp);
    expect(candidates).toEqual([
      { path: 'blueprint/src/content.tex', name: 'blueprint', size: 3 },
      { path: 'another/src/content.tex', name: 'another', size: 1 },
      { path: 'appendix/src/content.tex', name: 'appendix', size: 2 },
      { path: 'nested/blueprint/src/content.tex', name: 'nested/blueprint', size: 4 },
    ]);
  });

  it('skips symlinks escaping the clone', () => {
    const outside = mkdtempSync(join(tmpdir(), 'fuse-outside-'));
    try {
      writeFileSync(join(outside, 'content.tex'), 'x');
      mkdirSync(join(tmp, 'linked', 'src'), { recursive: true });
      symlinkSync(join(outside, 'content.tex'), join(tmp, 'linked', 'src', 'content.tex'));
      expect(listCloneBlueprintFiles(tmp)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
