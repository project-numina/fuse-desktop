import type { RepositoryFileEntry } from '@/lib/api';

export type AddSourceView = 'choose' | 'upload' | 'write' | 'repository';
export type RepositoryAction = 'attach' | 'import';

export interface FolderContents {
  folders: string[];
  files: RepositoryFileEntry[];
}

const IMPORT_EXTENSIONS = ['.pdf', '.tex', '.md', '.markdown'];

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function availableRepositoryFiles(
  files: readonly RepositoryFileEntry[],
  excludedPaths: readonly string[],
  action: RepositoryAction,
): RepositoryFileEntry[] {
  const excluded = new Set(excludedPaths);
  return files.filter((file) => {
    if (excluded.has(file.path)) return false;
    if (action === 'attach') return true;
    const path = file.path.toLowerCase();
    return IMPORT_EXTENSIONS.some((extension) => path.endsWith(extension));
  });
}

export function searchRepositoryFiles(
  files: readonly RepositoryFileEntry[],
  filter: string,
): RepositoryFileEntry[] {
  const query = filter.trim().toLowerCase();
  if (!query) return [];
  return files.filter((file) => file.path.toLowerCase().includes(query));
}

export function repositoryFolderContents(
  files: readonly RepositoryFileEntry[],
  currentPath: string,
): FolderContents {
  const prefix = currentPath ? `${currentPath}/` : '';
  const folders = new Set<string>();
  const directFiles: RepositoryFileEntry[] = [];
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue;
    const relativePath = file.path.slice(prefix.length);
    const separatorIndex = relativePath.indexOf('/');
    if (separatorIndex >= 0) folders.add(relativePath.slice(0, separatorIndex));
    else directFiles.push(file);
  }
  return {
    folders: [...folders].sort((left, right) => left.localeCompare(right)),
    files: directFiles.sort((left, right) => left.name.localeCompare(right.name)),
  };
}

export function emptyRepositoryMessage(
  action: RepositoryAction,
  excludedPathCount: number,
): string {
  if (action === 'import') return 'No supported source files found.';
  if (excludedPathCount > 0) return 'All repository files are already attached.';
  return 'No repository files found.';
}
