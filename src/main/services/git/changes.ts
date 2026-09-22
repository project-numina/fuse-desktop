/**
 * Bounded, safe snapshot of working-tree changes for the Git tab's Changes
 * view (``GET .../diff``). Tracked output comes from three git calls;
 * untracked regular files are bounded before reading and symlink targets
 * are never dereferenced.
 */

import { constants as fsConstants, promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { BlueprintDiffFile, BlueprintDiffResponse } from '@shared/api-types';
import { tryGit } from './run';
import { LOCAL_GENERATED_PATHSPECS } from './pathspecs';
import {
  countNewlines,
  DEFAULT_MAX_PATCH_BYTES,
  parseNumstat,
  patchOldPath,
  splitPatchStream,
  synthesizeAddedPatch,
  synthesizeSymlinkPatch,
  utf8ByteLength,
  type NumstatEntry,
  type PatchEntry,
} from './parse';
import { hasHead } from './status';

export interface WorkingTreeDiffOptions {
  pathspecs?: readonly string[];
  maxPatchBytes?: number;
}

const utf8 = new TextDecoder('utf-8', { fatal: false });

function untracked(path: string, extra: Partial<BlueprintDiffFile> = {}): BlueprintDiffFile {
  return { path, status: 'untracked', old_path: null, additions: 0, deletions: 0, diff: null, truncated: false, binary: false, ...extra };
}

/** Merge numstat and patch output into tracked change records. */
export function trackedFiles(numstats: Map<string, NumstatEntry>, patches: Map<string, PatchEntry>, cap: number): BlueprintDiffFile[] {
  const files: BlueprintDiffFile[] = [];
  const order = [...numstats.keys(), ...patches.keys()].filter((path, index, all) => all.indexOf(path) === index);
  for (const path of order) {
    const numbers = numstats.get(path) ?? { additions: 0, deletions: 0, binary: false, oldPath: null };
    const entry = patches.get(path);
    const patch = entry ? entry.body : null;
    const status = entry ? entry.status : 'modified';
    if (patch === null && !numbers.binary && numbers.additions === 0 && numbers.deletions === 0) continue;
    const encodedSize = patch ? utf8ByteLength(patch) : 0;
    files.push({
      path,
      status,
      additions: numbers.additions,
      deletions: numbers.deletions,
      diff: numbers.binary || encodedSize > cap ? null : patch,
      old_path: numbers.oldPath ?? patchOldPath(patch),
      binary: numbers.binary,
      truncated: !numbers.binary && encodedSize > cap,
    });
  }
  return files;
}

async function symlinkFile(fullPath: string, relativePath: string): Promise<BlueprintDiffFile> {
  try {
    const target = await fs.readlink(fullPath);
    return untracked(relativePath, { additions: 1, diff: synthesizeSymlinkPatch(relativePath, target) });
  } catch {
    return untracked(relativePath);
  }
}

/**
 * Read one untracked path without following symlinks (``O_NOFOLLOW``).
 * Windows has no ``O_NOFOLLOW``; there we check with ``lstat`` first and
 * read regular files anyway because the user owns the machine.
 */
export async function untrackedFile(fullPath: string, relativePath: string, cap: number): Promise<BlueprintDiffFile> {
  const noFollow = fsConstants.O_NOFOLLOW as number | undefined;
  let handle: fs.FileHandle;
  if (noFollow === undefined) {
    try {
      const info = await fs.lstat(fullPath);
      if (info.isSymbolicLink()) return symlinkFile(fullPath, relativePath);
      if (!info.isFile()) return untracked(relativePath);
      handle = await fs.open(fullPath, fsConstants.O_RDONLY);
    } catch {
      return untracked(relativePath);
    }
  } else {
    try {
      handle = await fs.open(fullPath, fsConstants.O_RDONLY | noFollow);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ELOOP' || code === 'EMLINK') return symlinkFile(fullPath, relativePath);
      return untracked(relativePath);
    }
  }
  let data: Buffer;
  try {
    const info = await handle.stat();
    if (!info.isFile()) return untracked(relativePath);
    if (info.size > cap) return untracked(relativePath, { truncated: true });
    const buffer = Buffer.alloc(cap + 1);
    const { bytesRead } = await handle.read(buffer, 0, cap + 1, 0);
    data = buffer.subarray(0, bytesRead);
  } catch {
    return untracked(relativePath);
  } finally {
    await handle.close();
  }
  if (data.length > cap) return untracked(relativePath, { truncated: true });
  if (data.includes(0)) return untracked(relativePath, { binary: true });
  const text = utf8.decode(data);
  const additions = countNewlines(text) + (text && !text.endsWith('\n') ? 1 : 0);
  return untracked(relativePath, { additions, diff: synthesizeAddedPatch(relativePath, text) });
}

/**
 * Tracked and untracked changes of the folder, sorted by path. Any git
 * failure is treated as empty output so the Changes view never 500s.
 */
export async function workingTreeDiff(cwd: string, options: WorkingTreeDiffOptions = {}): Promise<BlueprintDiffResponse> {
  const pathspecs = options.pathspecs ?? LOCAL_GENERATED_PATHSPECS;
  const cap = options.maxPatchBytes ?? DEFAULT_MAX_PATCH_BYTES;
  if (pathspecs.length === 0 || pathspecs.some((spec) => !spec || spec.includes('\0'))) {
    throw new RangeError('pathspecs must be non-empty strings without NUL');
  }
  if (!Number.isInteger(cap) || cap <= 0) throw new RangeError('max_patch_bytes must be a positive integer');
  const headExists = await hasHead(cwd);
  const [numstatRaw, patchRaw, untrackedRaw] = await Promise.all([
    headExists ? tryGit(['diff', 'HEAD', '--find-renames', '--numstat', '-z', '--', ...pathspecs], { cwd }) : Promise.resolve(''),
    headExists ? tryGit(['diff', 'HEAD', '--find-renames', '--', ...pathspecs], { cwd }) : Promise.resolve(''),
    tryGit(['ls-files', '--others', '-z', '--exclude-standard', '--', ...pathspecs], { cwd }),
  ]);
  const tracked = trackedFiles(parseNumstat(numstatRaw ?? ''), splitPatchStream(patchRaw ?? ''), cap);
  const untrackedPaths = (untrackedRaw ?? '').split('\0').filter((path) => path);
  const untrackedFiles = await Promise.all(untrackedPaths.map((path) => untrackedFile(join(cwd, path), path, cap)));
  const files = [...tracked, ...untrackedFiles].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return { files };
}
