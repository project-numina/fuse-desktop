/**
 * Path conventions of the Lean integration. Two roots matter and they are
 * easy to conflate:
 *
 *   - the repository root: the folder the user opened; the frontend addresses
 *     every file relative to it (`Lean/Foo/Bar.lean` even for a nested project);
 *   - the project root: `<repository>/<projectSubdir>`, where `lake` runs and
 *     every `.lake/*` state file lives; the build snapshot is keyed relative
 *     to it (`Foo/Bar.lean`).
 *
 * The helpers here do that conversion in one place, and refuse paths that
 * escape the repository (including through symlinks).
 */

import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { HttpError } from '../../server/errors';

export interface WorkspaceExecutionContext {
  repositoryRoot: string;
  /** Repo-relative POSIX project directory ('' for a root project). */
  projectSubdir: string;
  projectRoot: string;
}

/** Sandbox alias the hosted agents used for the repository; kept as a harmless shim. */
export const WORKSPACE_ALIAS = '/workspace';

/**
 * Resolve symlinks for the deepest existing prefix of `target`, keeping the
 * remaining (not yet existing) segments. Mirrors `Path.resolve(strict=False)`.
 */
export function resolveLenient(target: string): string {
  const absolute = resolve(target);
  let current = absolute;
  const trailing: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return absolute;
    trailing.unshift(current.slice(parent.length + 1));
    current = parent;
  }
  let real: string;
  try {
    real = realpathSync.native(current);
  } catch {
    real = current;
  }
  return trailing.length ? join(real, ...trailing) : real;
}

/** Whether `candidate` is `root` itself or lives below it (both already resolved). */
export function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Convert a relative path to POSIX form (snapshot keys, API paths). */
export function toPosix(value: string): string {
  return sep === '/' ? value : value.split(sep).join('/');
}

export function workspaceExecutionContext(repositoryRoot: string, projectSubdir = ''): WorkspaceExecutionContext {
  const root = resolveLenient(repositoryRoot);
  const normalizedSubdir = projectSubdir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const project = normalizedSubdir ? resolveLenient(join(root, ...normalizedSubdir.split('/'))) : root;
  if (!isInside(root, project)) {
    throw new Error('Lean project path must be contained in its repository');
  }
  const rel = toPosix(relative(root, project));
  return { repositoryRoot: root, projectSubdir: rel === '.' ? '' : rel, projectRoot: project };
}

/**
 * Map an absolute path (possibly under the `/workspace` alias) onto the
 * repository; throws when it points outside.
 */
export function resolveWorkspaceAlias(pathValue: string, repositoryRoot: string, guestRoot = WORKSPACE_ALIAS): string {
  const root = resolveLenient(repositoryRoot);
  const posix = pathValue.replace(/\\/g, '/');
  let candidate: string;
  if (posix === guestRoot || posix.startsWith(`${guestRoot}/`)) {
    const remainder = posix.slice(guestRoot.length).replace(/^\/+/, '');
    candidate = remainder ? join(root, ...remainder.split('/')) : root;
  } else {
    candidate = pathValue;
  }
  const resolved = resolveLenient(candidate);
  if (!isInside(root, resolved)) {
    throw new Error(`path is outside the repository: ${pathValue}`);
  }
  return resolved;
}

/** `(clone/file)` resolved and contained in the clone, else 400 "Invalid file path". */
export function resolveFileUnderClone(clonePath: string, filePath: string): string {
  const root = resolveLenient(clonePath);
  const target = resolveLenient(join(root, filePath));
  if (!isInside(root, target)) throw new HttpError(400, 'Invalid file path');
  return target;
}

export function leanFileNotFoundError(): HttpError {
  return new HttpError(
    404,
    'The requested Lean file no longer exists. Refresh the file list and try again.',
    'lean_file_not_found',
  );
}

/** Like `resolveFileUnderClone` but the file must exist (404 `lean_file_not_found`). */
export function resolveExistingFileUnderClone(clonePath: string, filePath: string): string {
  const target = resolveFileUnderClone(clonePath, filePath);
  let isFile: boolean;
  try {
    isFile = statSync(target).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) throw leanFileNotFoundError();
  return target;
}

/** Normalized clone-relative POSIX path of `filePath`. */
export function relativeFilePathUnderClone(clonePath: string, filePath: string): string {
  const target = resolveFileUnderClone(clonePath, filePath);
  return toPosix(relative(resolveLenient(clonePath), target));
}

/**
 * Project-relative snapshot key for a repo-relative file, or null when the
 * file lies outside the Lean project (it then has no snapshot entry).
 */
export function snapshotKey(clonePath: string, projectRoot: string, filePath: string): string | null {
  const target = resolveFileUnderClone(clonePath, filePath);
  const project = resolveLenient(projectRoot);
  if (!isInside(project, target)) return null;
  const rel = toPosix(relative(project, target));
  return rel === '' ? null : rel;
}

export const MODULE_NAME = /^[A-Za-z_][A-Za-z0-9_']*(\.[A-Za-z_][A-Za-z0-9_']*)*$/;

/** The module name when it is a dotted Lean identifier, else null. */
export function validateModuleName(module: string): string | null {
  return MODULE_NAME.test(module) ? module : null;
}

/** `Foo.Bar.Baz` → `Foo/Bar/Baz.lean`. */
export function moduleToFile(module: string): string {
  return `${module.split('.').join('/')}.lean`;
}

/**
 * Normalize a diagnostic's file path to project-relative POSIX form: absolute
 * paths inside the project become relative, `././Foo.lean` → `Foo.lean`.
 */
export function normalizeDiagnosticFile(filePath: string, clonePath?: string): string {
  let value = filePath.replace(/\\/g, '/');
  const looksAbsolute = value.startsWith('/') || /^[A-Za-z]:\//.test(value);
  if (clonePath !== undefined && looksAbsolute) {
    const root = resolveLenient(clonePath);
    const target = resolveLenient(filePath);
    if (isInside(root, target)) return toPosix(relative(root, target));
    return value;
  }
  while (value.startsWith('./')) value = value.slice(2);
  const parts = value.split('/').filter((part) => part !== '' && part !== '.');
  return parts.length ? parts.join('/') : value;
}
