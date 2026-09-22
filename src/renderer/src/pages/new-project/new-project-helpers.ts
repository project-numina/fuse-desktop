import { ApiError, type Lean4Tag } from '@/lib/api';

export type WizardStep = 1 | 2;

export const TOTAL_STEPS = 2;
export const MATHLIB_DEFAULT_VERSION_ID = '__mathlib_default__';

const stableLeanVersionPattern = /^v\d+\.\d+\.\d+$/;
const moduleNamePattern = /^[A-Z][A-Za-z0-9_]*$/;

/** Mirrors backend module-name seeding for a newly selected repository. */
export function sanitizeModuleName(repoName: string): string {
  const parts = repoName.split(/[^A-Za-z0-9]+/);
  const cleaned: string[] = [];
  for (const part of parts) {
    const stripped = part.replace(/^[0-9]+/, '');
    if (stripped) cleaned.push(stripped[0].toUpperCase() + stripped.slice(1));
  }
  return cleaned.join('') || 'Project';
}

export function isValidModuleName(moduleName: string): boolean {
  return moduleNamePattern.test(moduleName.trim());
}

export function sanitizeTargetSubdir(targetSubdir: string): string {
  return targetSubdir.trim().replace(/^\/+|\/+$/g, '');
}

export function stableLeanVersions(tags: Lean4Tag[]): Lean4Tag[] {
  return tags.filter((tag) => stableLeanVersionPattern.test(tag.name));
}

/** Maps setup API failures to actionable form messages. */
export function setupErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'Could not set up the project. Please try again.';
  }
  const detail = typeof error.rawDetail === 'string' ? error.rawDetail : '';
  if (error.status === 404) {
    return 'We could not find that folder. Make sure it still exists and is listed on the dashboard.';
  }
  if (error.status === 422) {
    return detail
      || 'Module name must start with a capital letter and contain only letters, digits, and underscores.';
  }
  if (error.status === 409 || error.status === 400) {
    return detail || 'Setup conflicted with existing files in this folder.';
  }
  return 'Could not set up the project. Please try again.';
}

export function blueprintContinuationPath({
  owner,
  repository,
  title,
  baseBranch,
}: {
  owner: string;
  repository: string;
  title: string;
  baseBranch: string;
}): string {
  const params = new URLSearchParams();
  if (title) params.set('title', title);
  if (baseBranch) params.set('base', baseBranch);
  const query = params.toString();
  return `/repo/${owner}/${repository}/blueprint/new${query ? `?${query}` : ''}`;
}
