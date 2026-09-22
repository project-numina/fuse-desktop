import { randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { SourceArtifactKind } from '@shared/api-types';
import type { AppContext } from '../../server/context';
import type { RepositorySourceRow } from '../../store/rows';

export function sourceDirectory(ctx: AppContext, row: Pick<RepositorySourceRow, 'repository_id' | 'id'>): string {
  return join(ctx.paths.sourcesDir(row.repository_id), row.id);
}

/** Resolve an artifact without allowing a stored filename to escape its source directory. */
export function sourceArtifactPath(ctx: AppContext, row: RepositorySourceRow, kind: SourceArtifactKind): string | null {
  const filename = row.artifacts[kind];
  if (!filename) return null;
  const base = resolve(sourceDirectory(ctx, row));
  const path = resolve(base, filename);
  return path === base || path.startsWith(base + sep) ? path : null;
}

export async function readSourceArtifactText(ctx: AppContext, row: RepositorySourceRow, kind: SourceArtifactKind): Promise<string | null> {
  const path = sourceArtifactPath(ctx, row, kind);
  if (!path) return null;
  try {
    return await fs.readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export async function removeSourceDirectory(ctx: AppContext, row: Pick<RepositorySourceRow, 'repository_id' | 'id'>): Promise<void> {
  await fs.rm(sourceDirectory(ctx, row), { recursive: true, force: true }).catch(() => undefined);
}

export async function removeSourceArtifact(ctx: AppContext, row: RepositorySourceRow, kind: SourceArtifactKind): Promise<void> {
  const path = sourceArtifactPath(ctx, row, kind);
  if (path) await fs.rm(path, { force: true }).catch(() => undefined);
}

/** Write atomically using a temporary file in the destination directory. */
export async function writeAtomic(path: string, data: Uint8Array | string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID().slice(0, 8)}.tmp`);
  const handle = await fs.open(temporary, 'w');
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, path);
}

/** Read a bounded regular file while rejecting symlinks in every path component. */
export async function readBoundedRepositoryFile(root: string, repoPath: string, cap: number): Promise<Uint8Array> {
  const components = repoPath.split('/');
  let current = root;
  for (const component of components.slice(0, -1)) {
    current = join(current, component);
    const info = await fs.lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('not a directory');
  }
  const target = join(current, components[components.length - 1]);
  const noFollow = fsConstants.O_NOFOLLOW as number | undefined;
  if (noFollow === undefined && (await fs.lstat(target)).isSymbolicLink()) throw new Error('symlink');
  const flags = noFollow === undefined ? fsConstants.O_RDONLY : fsConstants.O_RDONLY | noFollow;
  const handle = await fs.open(target, flags);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('not a regular file');
    const buffer = Buffer.alloc(Math.min(info.size, cap + 1));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return new Uint8Array(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}
