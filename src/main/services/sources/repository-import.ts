import { createHash } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { HttpError } from '../../store/registry';
import type { OpenProject } from '../types';
import { readBoundedRepositoryFile } from './storage';
import { hasSupportedExtension, MAX_SOURCE_UPLOAD_BYTES, validatedSourcePayload, type ValidatedPayload } from './validation';

export const EXCLUDED_DIRECTORY_NAMES = new Set(['.git', '.lake']);
// Desktop state lives in userData, so a top-level `numina` directory is ordinary source material.
export const EXCLUDED_ROOT_DIRECTORY_NAMES = new Set<string>();

export interface PreparedRepositoryImport {
  repoPath: string;
  bytes: Uint8Array;
  payload: ValidatedPayload;
  contentHash: string;
}

/** Return a normalized repo-relative POSIX path or throw. */
export function normalizeRepositoryFilePath(path: string): string {
  const candidate = path.trim().replace(/\\/g, '/');
  const segments = candidate.split('/');
  const invalid =
    !candidate ||
    candidate.includes('\0') ||
    candidate.startsWith('/') ||
    /^[A-Za-z]:/.test(candidate) ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..');
  if (invalid) throw new Error('Path must be repository-relative');
  return segments.join('/');
}

/** Whether a path points into VCS or Lean build state. */
export function repositoryFilePathIsExcluded(path: string): boolean {
  const parts = path.split('/').filter((part) => part.length > 0);
  if (parts.length === 0) return true;
  return EXCLUDED_ROOT_DIRECTORY_NAMES.has(parts[0]) || parts.some((part) => EXCLUDED_DIRECTORY_NAMES.has(part));
}

function checkedRepositoryPath(rawRepoPath: string): string {
  let repoPath: string;
  try {
    repoPath = normalizeRepositoryFilePath(rawRepoPath);
  } catch {
    throw new HttpError(400, 'repo_path must be a repository-relative file path.', 'http_400');
  }
  if (repositoryFilePathIsExcluded(repoPath)) throw new HttpError(404, 'File not found', 'http_404');
  if (!hasSupportedExtension(repoPath)) {
    throw new HttpError(400, 'Unsupported source type. Choose a .tex, .md, .markdown, or .pdf file.', 'http_400');
  }
  return repoPath;
}

async function readRepositoryFile(project: OpenProject, repoPath: string): Promise<Uint8Array> {
  if (!existsSync(project.clonePath)) throw new HttpError(409, 'Repository files are not available yet.', 'http_409');
  const root = resolve(project.clonePath);
  const unresolved = join(root, ...repoPath.split('/'));
  let resolved: string;
  try {
    resolved = await fs.realpath(unresolved);
  } catch {
    throw new HttpError(404, 'File not found', 'http_404');
  }
  const realRoot = await fs.realpath(root).catch(() => root);
  if (resolved !== realRoot && !resolved.startsWith(realRoot + sep)) {
    throw new HttpError(400, 'repo_path must be a repository-relative file path.', 'http_400');
  }
  try {
    if ((await fs.lstat(unresolved)).isSymbolicLink()) throw new Error('symlink');
    return await readBoundedRepositoryFile(root, repoPath, MAX_SOURCE_UPLOAD_BYTES);
  } catch {
    throw new HttpError(404, 'File not found', 'http_404');
  }
}

/** Validate and snapshot an allowed repository file before registry reconciliation. */
export async function prepareRepositoryImport(project: OpenProject, rawRepoPath: string): Promise<PreparedRepositoryImport> {
  const repoPath = checkedRepositoryPath(rawRepoPath);
  const bytes = await readRepositoryFile(project, repoPath);
  const payload = await validatedSourcePayload(repoPath, bytes);
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  return { repoPath, bytes, payload, contentHash };
}
