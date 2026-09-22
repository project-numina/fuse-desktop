export interface FileDiffStats {
  added: number;
  deleted: number;
}

export interface BuildErrorCount {
  errors: number;
  warnings: number;
}

export interface DirectoryEntry {
  kind: 'folder' | 'file';
  name: string;
  path: string;
  diff: FileDiffStats | null;
  buildErrors: BuildErrorCount | null;
}

export interface Breadcrumb {
  name: string;
  path: string;
}

interface FolderTotals {
  added: number;
  deleted: number;
  errors: number;
  warnings: number;
}

interface TreeInput {
  files: string[];
  directories: string[];
  currentPath: string;
  diffStats: Record<string, FileDiffStats>;
  buildErrorCounts: Record<string, BuildErrorCount>;
}

export function normalizeTreeRoot(rootPath: string): string {
  return rootPath.trim().replace(/^\/+|\/+$/g, '');
}

function emptyTotals(): FolderTotals {
  return { added: 0, deleted: 0, errors: 0, warnings: 0 };
}

function addTotals(
  totals: FolderTotals,
  diff: FileDiffStats | null,
  buildErrors: BuildErrorCount | null,
): void {
  if (diff) {
    totals.added += diff.added;
    totals.deleted += diff.deleted;
  }
  if (buildErrors) {
    totals.errors += buildErrors.errors;
    totals.warnings += buildErrors.warnings;
  }
}

function seedFolders(directories: string[], prefix: string): Map<string, FolderTotals> {
  const folders = new Map<string, FolderTotals>();
  for (const directory of directories) {
    if (!directory.startsWith(prefix)) continue;
    const name = directory.slice(prefix.length);
    if (name && !name.includes('/')) folders.set(name, emptyTotals());
  }
  return folders;
}

function collectFiles(
  input: TreeInput,
  prefix: string,
  folders: Map<string, FolderTotals>,
): DirectoryEntry[] {
  const entries: DirectoryEntry[] = [];
  for (const path of input.files) {
    if (!path.startsWith(prefix)) continue;
    const remainder = path.slice(prefix.length);
    if (!remainder) continue;
    const slash = remainder.indexOf('/');
    const diff = input.diffStats[path] || null;
    const buildErrors = input.buildErrorCounts[path] || null;
    if (slash === -1) {
      entries.push({ kind: 'file', name: remainder, path, diff, buildErrors });
      continue;
    }
    const folderName = remainder.slice(0, slash);
    const totals = folders.get(folderName) ?? emptyTotals();
    addTotals(totals, diff, buildErrors);
    folders.set(folderName, totals);
  }
  return entries;
}

function folderEntry(name: string, prefix: string, totals: FolderTotals): DirectoryEntry {
  return {
    kind: 'folder',
    name,
    path: prefix + name,
    diff: totals.added > 0 || totals.deleted > 0
      ? { added: totals.added, deleted: totals.deleted }
      : null,
    buildErrors: totals.errors > 0 || totals.warnings > 0
      ? { errors: totals.errors, warnings: totals.warnings }
      : null,
  };
}

/** Builds one directory level, with changed folders/files ordered before clean entries. */
export function buildDirectoryEntries(input: TreeInput): DirectoryEntry[] {
  const prefix = input.currentPath ? `${input.currentPath}/` : '';
  const folders = seedFolders(input.directories, prefix);
  const files = collectFiles(input, prefix, folders)
    .sort((left, right) => left.name.localeCompare(right.name));
  const folderEntries = [...folders.entries()]
    .map(([name, totals]) => folderEntry(name, prefix, totals))
    .sort((left, right) => left.name.localeCompare(right.name));
  const changed: DirectoryEntry[] = [];
  const unchanged: DirectoryEntry[] = [];
  for (const entry of [...folderEntries, ...files]) {
    (entry.diff ? changed : unchanged).push(entry);
  }
  return [...changed, ...unchanged];
}

export function changedFilesDividerIndex(entries: DirectoryEntry[]): number {
  const index = entries.findIndex((entry) => !entry.diff);
  return index > 0 && index < entries.length ? index : -1;
}

export function buildBreadcrumbs(currentPath: string, treeRoot: string): Breadcrumb[] {
  if (currentPath === treeRoot) return [];
  const relativePath = treeRoot ? currentPath.slice(treeRoot.length + 1) : currentPath;
  if (!relativePath) return [];
  const parts = relativePath.split('/');
  return parts.map((name, index) => ({
    name,
    path: [treeRoot, ...parts.slice(0, index + 1)].filter(Boolean).join('/'),
  }));
}

export function parentPath(currentPath: string, treeRoot: string): string {
  if (currentPath === treeRoot) return treeRoot;
  const slash = currentPath.lastIndexOf('/');
  const parent = slash === -1 ? '' : currentPath.slice(0, slash);
  return parent.length < treeRoot.length ? treeRoot : parent;
}

export function diffStatsTitle(entry: DirectoryEntry): string {
  if (!entry.diff) return '';
  const scope = entry.kind === 'folder' ? 'in this folder' : 'in this file';
  return `+${entry.diff.added} / -${entry.diff.deleted} lines ${scope} vs. the default branch`;
}

export function buildErrorTitle(entry: DirectoryEntry): string {
  if (!entry.buildErrors) return '';
  const { errors, warnings } = entry.buildErrors;
  const scope = entry.kind === 'folder' ? 'in this folder' : 'in this file';
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  return `${parts.join(', ')} ${scope}`;
}
