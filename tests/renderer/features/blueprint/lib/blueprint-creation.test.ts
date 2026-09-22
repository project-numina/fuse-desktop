import { describe, expect, it } from 'vitest';

import { ApiError, type LakefileEntry, type RepositoryBlueprintFile } from '@/lib/api';

import {
  createErrorMessage,
  defaultExistingBlueprintFile,
  defaultLakefile,
  filterLakefiles,
  pdfCheckErrorMessage,
  sortLakefilesByDepth,
  titleToId,
} from '@/features/blueprint/lib/blueprint-creation';

describe('blueprint creation helpers', () => {
  it.each([
    [409, 'A blueprint with this title already exists.'],
    [413, 'The upload is too large. Choose a smaller file and try again.'],
    [422, 'Check the details and try again.'],
  ])('maps create status %i to a safe message', (status, message) => {
    expect(createErrorMessage(new ApiError('private detail', status))).toBe(message);
  });

  it('does not leak unknown creation errors', () => {
    expect(createErrorMessage(new ApiError('secret', 500))).toBe(
      'Could not create blueprint. Please try again.',
    );
    expect(createErrorMessage(new Error('traceback'))).toBe(
      'Could not create blueprint. Please try again.',
    );
  });

  it.each([
    [413, 'The PDF is too large. Choose a smaller file and try again.'],
    [422, 'Could not read PDF. Upload a valid PDF and try again.'],
  ])('maps PDF status %i to a safe message', (status, message) => {
    expect(pdfCheckErrorMessage(new ApiError('private detail', status))).toBe(message);
  });

  it('uses a generic PDF message for unexpected failures', () => {
    expect(pdfCheckErrorMessage(new ApiError('secret', 500))).toBe(
      'Could not read PDF. Please try again.',
    );
  });

  it.each([
    ['Fundamental Theorem of Calculus', 'fundamental-theorem-of-calculus'],
    ['Hello_World', 'hello-world'],
    ['A  --  B', 'a-b'],
    ['Café & Crème', 'caf-crme'],
    ['!!!', 'blueprint'],
    ['', 'blueprint'],
  ])('slugifies %j', (title, expected) => {
    expect(titleToId(title)).toBe(expected);
  });

  it('selects the only existing blueprint candidate', () => {
    const only = { path: 'notes/blueprint/src/content.tex', name: 'notes', size: 1 };
    expect(defaultExistingBlueprintFile([only] as RepositoryBlueprintFile[])).toBe(only);
  });

  it('prefers the canonical existing blueprint path', () => {
    const canonical = { path: 'blueprint/src/content.tex', name: 'blueprint', size: 1 };
    const other = { path: 'notes/blueprint/src/content.tex', name: 'notes', size: 2 };
    expect(defaultExistingBlueprintFile([other, canonical] as RepositoryBlueprintFile[])).toBe(
      canonical,
    );
  });

  it('does not guess among multiple non-canonical blueprint files', () => {
    const files = [
      { path: 'a/blueprint/src/content.tex', name: 'a', size: 1 },
      { path: 'b/blueprint/src/content.tex', name: 'b', size: 2 },
    ];
    expect(defaultExistingBlueprintFile(files as RepositoryBlueprintFile[])).toBeNull();
    expect(defaultExistingBlueprintFile([])).toBeNull();
  });

  it('selects a root lakefile, then the first nested project', () => {
    const nested = { directory: 'lean', path: 'lean/lakefile.toml' } as LakefileEntry;
    const root = { directory: '', path: 'lakefile.toml' } as LakefileEntry;
    expect(defaultLakefile([nested, root])).toBe(root);
    expect(defaultLakefile([nested])).toBe(nested);
    expect(defaultLakefile([])).toBeNull();
  });

  it('sorts Lean projects by path depth, then alphabetically', () => {
    const lakefiles = [
      { directory: 'z/deep', path: 'z/deep/lakefile.toml' },
      { directory: 'beta', path: 'beta/lakefile.toml' },
      { directory: '', path: 'lakefile.toml' },
      { directory: 'Alpha', path: 'Alpha/lakefile.toml' },
      { directory: 'a/deep', path: 'a/deep/lakefile.toml' },
    ] as LakefileEntry[];

    expect(sortLakefilesByDepth(lakefiles).map(entry => entry.path)).toEqual([
      'lakefile.toml',
      'Alpha/lakefile.toml',
      'beta/lakefile.toml',
      'a/deep/lakefile.toml',
      'z/deep/lakefile.toml',
    ]);
    expect(lakefiles[0]?.path).toBe('z/deep/lakefile.toml');
  });

  it('filters Lean projects by path without changing their order', () => {
    const lakefiles = [
      { directory: 'lean', path: 'lean/lakefile.toml' },
      { directory: 'apps/math', path: 'apps/math/lakefile.toml' },
      { directory: 'apps/docs', path: 'apps/docs/lakefile.lean' },
    ] as LakefileEntry[];

    expect(filterLakefiles(lakefiles, ' APPS/ ')).toEqual(lakefiles.slice(1));
    expect(filterLakefiles(lakefiles, 'missing')).toEqual([]);
    expect(filterLakefiles(lakefiles, '')).toBe(lakefiles);
  });
});
