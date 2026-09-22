/**
 * Identifier and input validation shared by workspace creation and the
 * Lean project scaffold: blueprint ids, module names, Lean versions,
 * project subdirectories and blueprint file paths. Messages are the web's.
 */

import { HttpError } from '../../store/registry';

const BLUEPRINT_ID_PATTERN = /[^a-z0-9-]/g;
const CONSECUTIVE_HYPHENS = /-{2,}/g;
const MODULE_NAME_RE = /^[A-Z][A-Za-z0-9_]*$/;
const SUBDIR_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const LEAN_VERSION_RE = /^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?$/;
const MATHLIB_REVISION_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const TOOLCHAIN_SPEC_RE = /^[A-Za-z0-9][A-Za-z0-9._:/+-]*$/;
const RESERVED_MODULE_NAMES = new Set(['Mathlib', 'Std', 'Init', 'Lean']);

/** A 422 with the web's message; an HttpError so routes need no translation. */
export class WorkspaceValidationError extends HttpError {
  constructor(message: string, status: 400 | 422 = 422) {
    super(status, message, `http_${status}`);
    this.name = 'WorkspaceValidationError';
  }
}

/**
 * URL-safe blueprint id from a title: lowercase, spaces/underscores to
 * hyphens, other characters dropped, hyphen runs collapsed.
 */
export function generateBlueprintId(title: string): string {
  let result = title.toLowerCase().replace(/ /g, '-').replace(/_/g, '-');
  result = result.replace(BLUEPRINT_ID_PATTERN, '');
  result = result.replace(CONSECUTIVE_HYPHENS, '-');
  return result.replace(/^-+|-+$/g, '') || 'blueprint';
}

/** Normalize a safe repository-relative project subdirectory ('' = root). */
export function validateProjectSubdir(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return '';
  const segments = trimmed.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..' || segment.startsWith('.') || !SUBDIR_SEGMENT_RE.test(segment)) {
      throw new WorkspaceValidationError(
        "Subfolder must be a relative path of letters, digits, '.', '-', and '_' segments (no traversal or hidden segments).",
      );
    }
  }
  return segments.join('/');
}

/** Suggest a PascalCase Lean module name from a repository name. */
export function sanitizeModuleName(repositoryName: string): string {
  const cleaned: string[] = [];
  for (const part of repositoryName.split(/[^A-Za-z0-9]+/)) {
    const stripped = part.replace(/^[0-9]+/, '');
    if (stripped) cleaned.push(stripped[0].toUpperCase() + stripped.slice(1));
  }
  return cleaned.join('') || 'Project';
}

/** A validated single-segment Lean module identifier. */
export function validateModuleName(moduleName: string): string {
  const trimmed = moduleName.trim();
  if (!MODULE_NAME_RE.test(trimmed)) {
    throw new WorkspaceValidationError('Module name must start with a capital letter and contain only letters, digits, and underscores.');
  }
  if (RESERVED_MODULE_NAMES.has(trimmed)) {
    throw new WorkspaceValidationError(`'${trimmed}' is reserved for a Lean toolchain library and would collide with the import. Pick a different name.`);
  }
  return trimmed;
}

/** A validated ``vX.Y.Z[-suffix]`` Lean release tag. */
export function validateLeanVersion(leanVersion: string): string {
  const trimmed = leanVersion.trim();
  if (!LEAN_VERSION_RE.test(trimmed)) {
    throw new WorkspaceValidationError("Lean version must look like 'v4.13.0' or 'v4.14.0-rc1'.");
  }
  return trimmed;
}

export function validateMathlibRevision(revision: string | null): string | null {
  if (revision === null) return null;
  if (!MATHLIB_REVISION_RE.test(revision)) throw new WorkspaceValidationError('mathlib_revision must be a safe non-empty Git ref');
  return revision;
}

/** A validated, trimmed elan toolchain spec, or null when invalid. */
export function parseToolchainSpec(raw: string): string | null {
  const spec = raw.trim();
  return spec && TOOLCHAIN_SPEC_RE.test(spec) ? spec : null;
}

/** Validate and newline-terminate a Lean toolchain pin. */
export function validateLeanToolchain(leanToolchain: string): string {
  const spec = parseToolchainSpec(leanToolchain);
  if (spec === null) throw new WorkspaceValidationError('lean_toolchain must contain one valid toolchain specification');
  return `${spec}\n`;
}

/**
 * A repository-relative ``.tex`` path: no NUL, backslash, leading slash or
 * ``.``/``..`` segments. Null when unsafe.
 */
export function safeBlueprintFilePath(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value || value.includes('\0') || value.includes('\\') || value.startsWith('/')) return null;
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null;
  if (!value.endsWith('.tex')) return null;
  return value;
}

export const DEFAULT_BLUEPRINT_FILE = 'blueprint/src/content.tex';

export function defaultBlueprintFileForProject(projectSubdir: string): string {
  const subdir = projectSubdir.replace(/^\/+|\/+$/g, '');
  return subdir ? `${subdir}/${DEFAULT_BLUEPRINT_FILE}` : DEFAULT_BLUEPRINT_FILE;
}
