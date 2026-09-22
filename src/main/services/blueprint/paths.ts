/**
 * Resolving blueprint-owned repository paths.
 *
 * A Fuse-drafted blueprint is a standard leanblueprint project at
 * `blueprint/src/content.tex` inside the user's repository. Imported
 * blueprints store an explicit entrypoint; blueprints created under the old
 * layout live at `numina/blueprints/<name>/<name>.tex` and are still resolved
 * on read (never written for new ones). Every repo-relative `.tex` path that
 * comes from user input or persisted metadata passes through
 * `safeBlueprintFilePath` before touching the filesystem.
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { resolvesUnder } from './latex/project';

export const DEFAULT_BLUEPRINT_FILE = 'blueprint/src/content.tex';
export const LEGACY_BLUEPRINTS_BASE = 'numina/blueprints';
export const METADATA_BASE = 'numina/.metadata/blueprints';

/** Top-level tool directories that ship their own `blueprint/` and must never be offered as candidates (the web's first-segment filter). */
const CLONE_SCAN_EXCLUDED = new Set(['.git', '.lake', 'numina']);
/** Build artifacts and vendored trees pruned at every depth: a nested project's `.lake/` can hold thousands of directories. */
const CLONE_SCAN_PRUNED = new Set(['.git', '.lake', 'node_modules']);

/**
 * Return a safe repo-relative `.tex` path, or null if invalid.
 *
 * User-selected blueprints live in the user's repository tree, so the path
 * must stay repo-relative and point at a LaTeX file. Backslashes are rejected
 * even on POSIX hosts so stored metadata is safe on every platform.
 */
export function safeBlueprintFilePath(rawPath: unknown): string | null {
  if (typeof rawPath !== 'string') return null;
  const path = rawPath.trim();
  if (!path || path.includes('\0') || path.includes('\\') || path.startsWith('/')) return null;
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null;
  if (!path.endsWith('.tex')) return null;
  return path;
}

/** Python `str.strip().strip('/')`: trim whitespace, then leading/trailing slashes. */
export function normalizeProjectSubdir(projectSubdir: string): string {
  return projectSubdir.trim().replace(/^\/+|\/+$/g, '');
}

/**
 * The conventional blueprint entrypoint for a Lean project. A root project
 * keeps the historical `blueprint/src/content.tex`; a nested project keeps
 * the same layout below its own project root.
 */
export function defaultBlueprintFileForProject(projectSubdir: string): string {
  const subdir = normalizeProjectSubdir(projectSubdir);
  return subdir ? `${subdir}/${DEFAULT_BLUEPRINT_FILE}` : DEFAULT_BLUEPRINT_FILE;
}

/** Absolute path of a repo-relative POSIX path inside the clone. */
export function clonePathOf(clonePath: string, relativePosix: string): string {
  return join(clonePath, ...relativePosix.split('/'));
}

/** Repo-relative POSIX form of an absolute path inside the clone. */
export function posixRelative(clonePath: string, absolute: string): string {
  return relative(clonePath, absolute).split(sep).join('/');
}

function fileSize(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The selected Lean project's conventional blueprint, if present (symlink escapes rejected). */
export function resolveProjectBlueprintEntrypoint(clonePath: string, projectSubdir: string): string | null {
  const candidate = defaultBlueprintFileForProject(projectSubdir);
  const candidatePath = clonePathOf(clonePath, candidate);
  if (!isFile(candidatePath)) return null;
  if (!resolvesUnder(candidatePath, clonePath)) return null;
  return candidate;
}

/** The pre-`blueprint/` Fuse-drafted entrypoint path for `name`. */
export function legacyBlueprintFilePath(name: string): string {
  return `${LEGACY_BLUEPRINTS_BASE}/${name}/${name}.tex`;
}

/**
 * The blueprint's entrypoint path, or null when there is none.
 *
 * Resolution order, clone-aware so a freshly created (empty) workspace is
 * correctly reported as having no blueprint rather than a phantom default:
 *
 * 1. the stored `blueprintFile` (an explicitly chosen entrypoint) — honored
 *    without touching disk;
 * 2. the selected project's standard `blueprint/src/content.tex` if it exists
 *    (a project that already ships a leanblueprint is auto-adopted);
 * 3. for a root workspace only, `blueprint/src/content.tex` and then the
 *    legacy `numina/blueprints/<name>/<name>.tex` if they exist — a nested
 *    workspace must never adopt the root project's blueprint by existence;
 * 4. null — the workspace has no blueprint.
 */
export function resolveExistingEntrypoint(
  clonePath: string,
  name: string,
  blueprintFile: string | null | undefined,
  projectSubdir = '',
): string | null {
  const stored = safeBlueprintFilePath(blueprintFile);
  if (stored !== null) return stored;
  const projectDefault = defaultBlueprintFileForProject(projectSubdir);
  if (isFile(clonePathOf(clonePath, projectDefault))) return projectDefault;
  if (normalizeProjectSubdir(projectSubdir)) return null;
  if (isFile(clonePathOf(clonePath, DEFAULT_BLUEPRINT_FILE))) return DEFAULT_BLUEPRINT_FILE;
  const legacy = legacyBlueprintFilePath(name);
  if (isFile(clonePathOf(clonePath, legacy))) return legacy;
  return null;
}

/**
 * The absolute `.tex` entrypoint for a blueprint in `clonePath`: the existing
 * entrypoint when there is one, otherwise the default write location for a
 * brand-new draft.
 */
export function blueprintTexFileFor(
  clonePath: string,
  name: string,
  blueprintFile: string | null | undefined,
  projectSubdir = '',
): string {
  const entrypoint = resolveExistingEntrypoint(clonePath, name, blueprintFile, projectSubdir);
  return clonePathOf(clonePath, entrypoint ?? defaultBlueprintFileForProject(projectSubdir));
}

/** Repo-relative form of `blueprintTexFileFor` (the write target as a POSIX path). */
export function blueprintTexRelativeFor(
  clonePath: string,
  name: string,
  blueprintFile: string | null | undefined,
  projectSubdir = '',
): string {
  return resolveExistingEntrypoint(clonePath, name, blueprintFile, projectSubdir) ?? defaultBlueprintFileForProject(projectSubdir);
}

export interface CloneBlueprintCandidate {
  path: string;
  name: string;
  size: number;
}

const CONTENT_SUFFIX = '/src/content.tex';

function blueprintFolderFromContentPath(path: string): string {
  return path.endsWith(CONTENT_SUFFIX) ? path.slice(0, -CONTENT_SUFFIX.length) : path;
}

function isCandidateContentPath(path: string): boolean {
  const safe = safeBlueprintFilePath(path);
  if (safe === null) return false;
  if (!safe.endsWith(CONTENT_SUFFIX)) return false;
  return blueprintFolderFromContentPath(safe).length > 0;
}

/**
 * List leanblueprint `content.tex` entrypoints present in a clone, for the
 * "adopt an existing blueprint" chooser. Scans the working tree so a listed
 * candidate is guaranteed to exist where it will be read. The conventional
 * `blueprint` folder sorts first.
 */
export function listCloneBlueprintFiles(clonePath: string): CloneBlueprintCandidate[] {
  const candidates: CloneBlueprintCandidate[] = [];
  const walk = (directory: string, depth: number): void => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      if (depth === 0 && CLONE_SCAN_EXCLUDED.has(entry.name)) continue;
      if (entry.isDirectory()) {
        if (!CLONE_SCAN_PRUNED.has(entry.name)) walk(absolute, depth + 1);
        continue;
      }
      if (entry.name !== 'content.tex') continue;
      // A symlinked content.tex can resolve outside the clone; the chooser must never offer it.
      if (!isFile(absolute) || !resolvesUnder(absolute, clonePath)) continue;
      const relativePath = posixRelative(clonePath, absolute);
      if (!isCandidateContentPath(relativePath)) continue;
      const size = fileSize(absolute);
      if (size === null) continue;
      candidates.push({ path: relativePath, name: blueprintFolderFromContentPath(relativePath), size });
    }
  };
  walk(clonePath, 0);
  const key = (candidate: CloneBlueprintCandidate): [number, string] => [candidate.name === 'blueprint' ? 0 : 1, candidate.name];
  return candidates.sort((a, b) => {
    const [ka, na] = key(a);
    const [kb, nb] = key(b);
    if (ka !== kb) return ka - kb;
    return na < nb ? -1 : na > nb ? 1 : 0;
  });
}
