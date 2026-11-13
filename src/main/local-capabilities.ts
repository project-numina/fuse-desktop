import { constants } from 'node:fs';
import { access, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import type { StorageUsage } from '@shared/desktop';
import type { AppContext } from './server/context';
import { HttpError, validationError } from './server/errors';
import { createStorageUsageReader, type StorageRoot } from './storage-usage';
import { elanHome } from './services/lean/process';
import { workspaceExecutionContext } from './services/lean/paths';

export async function accessibleDirectory(value: unknown): Promise<string> {
  if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) {
    throw validationError('Enter an absolute directory path on the workstation.');
  }
  try {
    const path = await realpath(value);
    if (!(await stat(path)).isDirectory()) throw new HttpError(422, 'The path is not a directory.');
    await access(path, constants.R_OK | constants.X_OK);
    return path;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') throw new HttpError(422, 'You do not have permission to read this directory.');
    if (code === 'ENOENT' || code === 'ENOTDIR') throw new HttpError(422, 'The directory does not exist.');
    throw new HttpError(422, 'The directory could not be opened.');
  }
}

/** Native filesystem APIs preserve filenames and avoid invoking a shell. */
export async function listDirectories(value: string = homedir(), filter = '') {
  const path = await accessibleDirectory(value);
  let entries;
  try { entries = await readdir(path, { withFileTypes: true }); }
  catch { throw new HttpError(422, 'The directory could not be listed.'); }
  const names = entries.filter(entry => !entry.name.startsWith('.')
    && entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())
    && (entry.isDirectory() || entry.isSymbolicLink()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const directories: { name: string; path: string }[] = [];
  // Probe in small batches so an enormous directory does not exhaust file descriptors.
  for (let index = 0; index < names.length && directories.length <= 30; index += 32) {
    const batch = await Promise.all(names.slice(index, index + 32).map(async entry => {
      const child = join(path, entry.name);
      try {
        await accessibleDirectory(child);
        return { name: entry.name, path: child };
      } catch { return null; }
    }));
    for (const entry of batch) if (entry) directories.push(entry);
  }
  return { path, parent: dirname(path) === path ? null : dirname(path), directories: directories.slice(0, 30), truncated: directories.length > 30 };
}

const usageReaders = new WeakMap<AppContext, ReturnType<typeof createStorageUsageReader>>();
export function readLocalStorageUsage(ctx: AppContext): Promise<StorageUsage> {
  let reader = usageReaders.get(ctx);
  if (!reader) {
    reader = createStorageUsageReader();
    usageReaders.set(ctx, reader);
  }
  const roots: StorageRoot[] = [
    { id: 'fuse', label: 'Fuse app data', path: ctx.paths.userData, kind: 'fuse' },
    { id: 'elan', label: 'Lean toolchains & Elan data', path: elanHome(), kind: 'lean' },
    { id: 'mathlib-cache', label: 'Mathlib download cache', path: process.env.MATHLIB_CACHE_DIR?.trim() || join(process.env.XDG_CACHE_HOME?.trim() || join(homedir(), '.cache'), 'mathlib'), kind: 'lean' },
  ];
  for (const repo of ctx.registry.listRepositories()) {
    const projects = new Set(ctx.registry.listBlueprints(repo.id).map(blueprint => blueprint.project_subdir || ''));
    projects.add('');
    for (const project of [...projects].sort()) {
      try {
        const projectRoot = workspaceExecutionContext(repo.path, project).projectRoot;
        roots.push({ id: `repo-${repo.id}:${project}`, label: project ? `${repo.name} / ${project}` : repo.name, path: join(projectRoot, '.lake'), kind: 'repository' });
      } catch { /* Skip projects outside repository boundaries. */ }
    }
  }
  return reader(roots);
}
