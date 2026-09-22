import { describe, expect, it } from 'vitest';

import {
  availableRepositoryFiles,
  emptyRepositoryMessage,
  repositoryFolderContents,
  searchRepositoryFiles,
} from '@/features/blueprint/components/add-source-dialog/model';

const FILES = [
  { path: 'README.md', name: 'README.md', size: 10 },
  { path: 'src/Main.lean', name: 'Main.lean', size: 20 },
  { path: 'src/nested/Paper.TEX', name: 'Paper.TEX', size: 30 },
  { path: 'docs/notes.markdown', name: 'notes.markdown', size: 40 },
];

describe('add-source repository model', () => {
  it('excludes attached paths and limits imports to managed source formats', () => {
    expect(availableRepositoryFiles(FILES, ['README.md'], 'attach').map((file) => file.path)).toEqual([
      'src/Main.lean',
      'src/nested/Paper.TEX',
      'docs/notes.markdown',
    ]);
    expect(availableRepositoryFiles(FILES, [], 'import').map((file) => file.path)).toEqual([
      'README.md',
      'src/nested/Paper.TEX',
      'docs/notes.markdown',
    ]);
  });

  it('searches case-insensitively by full repository path', () => {
    expect(searchRepositoryFiles(FILES, ' NESTED/paper ').map((file) => file.path)).toEqual(['src/nested/Paper.TEX']);
    expect(searchRepositoryFiles(FILES, '  ')).toEqual([]);
  });

  it('builds sorted direct folder contents without leaking descendant files', () => {
    expect(repositoryFolderContents(FILES, '')).toEqual({
      folders: ['docs', 'src'],
      files: [{ path: 'README.md', name: 'README.md', size: 10 }],
    });
    expect(repositoryFolderContents(FILES, 'src')).toEqual({
      folders: ['nested'],
      files: [{ path: 'src/Main.lean', name: 'Main.lean', size: 20 }],
    });
  });

  it('preserves empty-state wording for import, excluded, and empty repositories', () => {
    expect(emptyRepositoryMessage('import', 0)).toBe('No supported source files found.');
    expect(emptyRepositoryMessage('attach', 1)).toBe('All repository files are already attached.');
    expect(emptyRepositoryMessage('attach', 0)).toBe('No repository files found.');
  });
});
