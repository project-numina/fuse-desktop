/**
 * Lean project discovery for the workspace-creation picker: every
 * directory holding a ``lakefile.toml`` or ``lakefile.lean`` (TOML
 * preferred when both exist), sorted by directory with the root first.
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { LakefileEntry, RepositoryLakefiles } from '@shared/api-types';

const LAKEFILES = new Set(['lakefile.toml', 'lakefile.lean']);
const SKIPPED_DIRECTORIES = new Set([
  '.git', '.lake', 'node_modules', 'build', '__pycache__',
  '.venv', 'venv', '.cache', '.pytest_cache', '.mypy_cache', '.ruff_cache',
  '.claude', '.codex', '.worktrees',
]);
// Bound directory reads, not individual files: a large unrelated dataset
// should not prevent discovery of the repository's Lean projects.
const MAX_DIRECTORIES = 50_000;

/** Reduce repo-relative blob paths to one lakefile per directory. */
export function selectLakefiles(paths: readonly string[]): LakefileEntry[] {
  const selected = new Map<string, LakefileEntry>();
  for (const path of paths) {
    const slash = path.lastIndexOf('/');
    const directory = slash < 0 ? '' : path.slice(0, slash);
    const filename = slash < 0 ? path : path.slice(slash + 1);
    if (!LAKEFILES.has(filename)) continue;
    if (!selected.has(directory) || filename === 'lakefile.toml') {
      selected.set(directory, { directory, lakefile: filename, path: directory ? `${directory}/${filename}` : filename });
    }
  }
  return [...selected.values()].sort((left, right) => (left.directory < right.directory ? -1 : left.directory > right.directory ? 1 : 0));
}

async function walkForLakefiles(root: string): Promise<{ paths: string[]; truncated: boolean }> {
  const paths: string[] = [];
  const directories: string[] = [''];
  let visited = 0;
  // Breadth-first traversal finds top-level projects before deep datasets.
  while (visited < directories.length) {
    if (visited >= MAX_DIRECTORIES) return { paths, truncated: true };
    const relativeDir = directories[visited++];
    let children: import('node:fs').Dirent[];
    try {
      children = await fs.readdir(relativeDir ? join(root, ...relativeDir.split('/')) : root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      const relative = relativeDir ? `${relativeDir}/${child.name}` : child.name;
      if (child.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(child.name)) directories.push(relative);
      } else if (child.isFile() && LAKEFILES.has(child.name)) {
        paths.push(relative);
      }
    }
  }
  return { paths, truncated: false };
}

/**
 * Lakefiles in the working tree. ``ref`` is accepted for API compatibility
 * and ignored: a workspace builds the checkout, so listing another branch's
 * projects would offer folders that do not exist on disk.
 */
export async function discoverLakefiles(cwd: string, _ref?: string | null): Promise<RepositoryLakefiles> {
  const { paths, truncated } = await walkForLakefiles(cwd);
  return { lakefiles: selectLakefiles(paths), truncated };
}
