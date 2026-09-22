/**
 * Repository file endpoints: the bounded file walk behind the attachment
 * picker (``repo-files``), single-file reads (``files/{path}``) and the
 * existing-blueprint candidate scan (``source-candidates``).
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { FileContentResponse, RepositoryBlueprintFile, RepositoryFileEntry, RepositoryFilesResponse } from '@shared/api-types';
import { HttpError } from '../../store/registry';
import { normalizeRepositoryFilePath, repositoryFilePathIsExcluded } from '../sources';
import { safeBlueprintFilePath } from './ids';

export { normalizeRepositoryFilePath, repositoryFilePathIsExcluded };

export const MAX_REPO_FILES = 5000;
const CLONE_SCAN_EXCLUDED = new Set(['.git', '.lake']);
const FILE_BROWSER_EXCLUDED = new Set(['node_modules', '.venv', 'venv', '__pycache__', '.next', '.cache']);

/** Read one directory only. File browsing never indexes a repository tree. */
export async function repoDirectory(root: string, rawDirectory = ''): Promise<RepositoryFilesResponse & { directories: string[] }> {
  let relative: string;
  try {
    relative = rawDirectory ? normalizeRepositoryFilePath(rawDirectory) : '';
  } catch { throw new HttpError(404, 'Folder not found', 'http_404'); }
  if (relative && (repositoryFilePathIsExcluded(relative) || relative.split('/').some(part => FILE_BROWSER_EXCLUDED.has(part)))) {
    throw new HttpError(404, 'Folder not found', 'http_404');
  }
  const absolute = resolve(root, relative);
  if (!(await pathResolvesUnder(absolute, root))) throw new HttpError(404, 'Folder not found', 'http_404');
  let children: import('node:fs').Dirent[];
  try { children = await fs.readdir(absolute, { withFileTypes: true }); }
  catch { throw new HttpError(404, 'Folder not found', 'http_404'); }
  const files: RepositoryFileEntry[] = [];
  const directories: string[] = [];
  for (const child of children) {
    const path = relative ? `${relative}/${child.name}` : child.name;
    if (child.isSymbolicLink() || child.name === '.DS_Store' || repositoryFilePathIsExcluded(path)) continue;
    if (child.isDirectory()) {
      if (!FILE_BROWSER_EXCLUDED.has(child.name)) directories.push(path);
    } else if (child.isFile()) {
      // The browser needs names, not a stat for every entry. Size is resolved
      // by the existing recursive attachment picker when actually needed.
      files.push({ path, name: child.name, size: 0 });
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  directories.sort((a, b) => a.localeCompare(b));
  return { files, directories, truncated: false, clone_ready: true };
}

/** Git blob SHA-1 of file content (``blob <len>\0<bytes>``). */
export function gitBlobSha(content: Uint8Array): string {
  return createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
}

/** True when ``candidate`` (already resolved) lies under ``root``. */
export async function pathResolvesUnder(candidate: string, root: string): Promise<boolean> {
  try {
    const realRoot = await fs.realpath(root);
    const real = await fs.realpath(candidate);
    return real === realRoot || real.startsWith(realRoot + sep);
  } catch {
    return false;
  }
}

/**
 * Every user-selectable file in the folder, sorted by path and capped at
 * 5000 (``truncated`` when more exist). Symlinks and excluded state are
 * skipped so nothing listed can escape the containment checks later.
 */
export async function walkRepoFiles(root: string): Promise<{ files: RepositoryFileEntry[]; truncated: boolean }> {
  const entries: RepositoryFileEntry[] = [];
  const stack: string[] = [''];
  let visitedDirectories = 0;
  let truncated = false;
  while (stack.length > 0) {
    if (++visitedDirectories > MAX_REPO_FILES || entries.length > MAX_REPO_FILES) {
      truncated = true;
      break;
    }
    const relativeDir = stack.pop() as string;
    let children: import('node:fs').Dirent[];
    try {
      children = await fs.readdir(relativeDir ? join(root, ...relativeDir.split('/')) : root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      const relative = relativeDir ? `${relativeDir}/${child.name}` : child.name;
      if (repositoryFilePathIsExcluded(relative)) continue;
      if (child.isSymbolicLink()) continue;
      if (child.isDirectory()) {
        if (FILE_BROWSER_EXCLUDED.has(child.name)) continue;
        stack.push(relative);
        continue;
      }
      if (!child.isFile()) continue;
      try {
        const info = await fs.stat(join(root, ...relative.split('/')));
        entries.push({ path: relative, name: child.name, size: info.size });
        if (entries.length > MAX_REPO_FILES) {
          truncated = true;
          break;
        }
      } catch {
        continue;
      }
    }
  }
  entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return { files: entries.slice(0, MAX_REPO_FILES), truncated };
}

export async function repoFiles(root: string): Promise<RepositoryFilesResponse> {
  try {
    if (!(await fs.stat(root)).isDirectory()) return { files: [], truncated: false, clone_ready: false };
  } catch {
    return { files: [], truncated: false, clone_ready: false };
  }
  const { files, truncated } = await walkRepoFiles(root);
  return { files, truncated, clone_ready: true };
}

/**
 * ``GET /files/{path}``: UTF-8 file content plus the git blob sha. Paths
 * that escape the folder (``..`` or symlinks), VCS/build internals
 * (``.git``, ``.lake``, root ``numina``) and non-files are 404s;
 * undecodable bytes are 400.
 */
export async function readRepoFile(root: string, rawPath: string): Promise<FileContentResponse> {
  let relative: string;
  try {
    relative = normalizeRepositoryFilePath(rawPath);
  } catch {
    throw new HttpError(404, 'File not found', 'http_404');
  }
  if (repositoryFilePathIsExcluded(relative)) throw new HttpError(404, 'File not found', 'http_404');
  const absolute = resolve(root, ...relative.split('/'));
  if (!(await pathResolvesUnder(absolute, root))) throw new HttpError(404, 'File not found', 'http_404');
  let bytes: Buffer;
  try {
    const info = await fs.stat(absolute);
    if (!info.isFile()) throw new HttpError(400, 'Requested path is not a file.', 'http_400');
    bytes = await fs.readFile(absolute);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(404, 'File not found', 'http_404');
  }
  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new HttpError(400, 'Requested path is not a file.', 'http_400');
  }
  return {
    name: relative.split('/').pop() ?? relative,
    path: relative,
    sha: gitBlobSha(bytes),
    size: bytes.length,
    content,
  };
}

function blueprintFolder(path: string): string {
  return path.endsWith('/src/content.tex') ? path.slice(0, -'/src/content.tex'.length) : path;
}

/**
 * leanblueprint ``<folder>/src/content.tex`` entrypoints in the working
 * tree, the conventional ``blueprint`` folder first, then by folder name.
 * Vendored/tool directories (``.git``, ``.lake``, root ``numina``) are skipped.
 */
export async function listBlueprintCandidates(root: string): Promise<RepositoryBlueprintFile[]> {
  const candidates: RepositoryBlueprintFile[] = [];
  const stack: string[] = [''];
  while (stack.length > 0) {
    const relativeDir = stack.pop() as string;
    let children: import('node:fs').Dirent[];
    try {
      children = await fs.readdir(relativeDir ? join(root, ...relativeDir.split('/')) : root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      const relative = relativeDir ? `${relativeDir}/${child.name}` : child.name;
      if (!relativeDir && CLONE_SCAN_EXCLUDED.has(child.name)) continue;
      if (child.isDirectory() && !child.isSymbolicLink()) {
        if (child.name !== 'node_modules') stack.push(relative);
        continue;
      }
      if (child.name !== 'content.tex' || !relative.endsWith('/src/content.tex')) continue;
      const absolute = join(root, ...relative.split('/'));
      try {
        const info = await fs.stat(absolute);
        if (!info.isFile() || !(await pathResolvesUnder(absolute, root))) continue;
        const safe = safeBlueprintFilePath(relative);
        if (safe === null || !blueprintFolder(safe)) continue;
        candidates.push({ path: safe, name: blueprintFolder(safe), size: info.size });
      } catch {
        continue;
      }
    }
  }
  return candidates.sort((left, right) => {
    const leftKey = left.name === 'blueprint' ? 0 : 1;
    const rightKey = right.name === 'blueprint' ? 0 : 1;
    if (leftKey !== rightKey) return leftKey - rightKey;
    return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
  });
}
