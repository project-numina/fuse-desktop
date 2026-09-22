/**
 * Pure helpers for the new-blueprint creation flow: user-facing error message
 * mapping, blueprint-id derivation, and existing-blueprint default selection.
 */

import {
  ApiError,
  type LakefileEntry,
  type RepositoryBlueprintFile,
} from '@/lib/api';

/**
 * Map a blueprint-creation error to a safe, user-facing message.
 *
 * @param {unknown} error Error thrown by the create request.
 * @return {string} Message to display; never leaks internal details.
 */
export function createErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return 'A blueprint with this title already exists.';
    if (error.status === 413) {
      return 'The upload is too large. Choose a smaller file and try again.';
    }
    if (error.status === 422) {
      return 'Check the details and try again.';
    }
  }
  return 'Could not create blueprint. Please try again.';
}

/**
 * Map a PDF page-count check error to a safe, user-facing message.
 *
 * @param {unknown} error Error thrown by the PDF info request.
 * @return {string} Message to display; never leaks internal details.
 */
export function pdfCheckErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 413) {
      return 'The PDF is too large. Choose a smaller file and try again.';
    }
    if (error.status === 422) {
      return 'Could not read PDF. Upload a valid PDF and try again.';
    }
  }
  return 'Could not read PDF. Please try again.';
}

/**
 * Derive a blueprint id from its title, mirroring the backend's
 * generate_blueprint_id logic so the duplicate-title check matches.
 *
 * @param {string} title Blueprint title entered by the user.
 * @return {string} Slugified blueprint id.
 */
export function titleToId(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[\s_]/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-{2,}/g, '-')
      .replace(/^-|-$/g, '') || 'blueprint'
  );
}

/**
 * Pick the blueprint file to pre-select when reusing an existing blueprint.
 * A single candidate is auto-selected; otherwise the canonical
 * blueprint/src/content.tex is preferred when present.
 *
 * @param {RepositoryBlueprintFile[]} files Candidate blueprint files.
 * @return {RepositoryBlueprintFile | null} Default selection, or null.
 */
export function defaultExistingBlueprintFile(
  files: RepositoryBlueprintFile[],
): RepositoryBlueprintFile | null {
  if (files.length === 1) return files[0];
  return files.find(file => file.path === 'blueprint/src/content.tex') || null;
}


/**
 * Order Lean projects by repository depth, then path name.
 *
 * @param {LakefileEntry[]} lakefiles Discovered Lean projects.
 * @return {LakefileEntry[]} A sorted copy; the input is not mutated.
 */
export function sortLakefilesByDepth(
  lakefiles: LakefileEntry[],
): LakefileEntry[] {
  return [...lakefiles].sort((left, right) => {
    const depthDifference = left.path.split('/').length - right.path.split('/').length;
    if (depthDifference !== 0) return depthDifference;
    const caseInsensitive = left.path.toLowerCase().localeCompare(right.path.toLowerCase());
    return caseInsensitive || left.path.localeCompare(right.path);
  });
}

/**
 * Filter Lean projects by their displayed repository path.
 *
 * @param {LakefileEntry[]} lakefiles Ordered Lean projects.
 * @param {string} query User-entered search query.
 * @return {LakefileEntry[]} Matching projects in the original order.
 */
export function filterLakefiles(
  lakefiles: LakefileEntry[],
  query: string,
): LakefileEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return lakefiles;
  return lakefiles.filter(entry => entry.path.toLowerCase().includes(normalizedQuery));
}

/**
 * Pick the Lean project (lakefile) to pre-select for a new workspace.
 * A single candidate is auto-selected; when several exist the repository
 * root is preferred, falling back to the first discovered project. An
 * empty list yields null so the caller can prompt the user to scaffold.
 *
 * @param {LakefileEntry[]} lakefiles Discovered Lean projects on the branch.
 * @return {LakefileEntry | null} Default selection, or null when none exist.
 */
export function defaultLakefile(
  lakefiles: LakefileEntry[],
): LakefileEntry | null {
  if (lakefiles.length === 0) return null;
  return lakefiles.find(entry => entry.directory === '') ?? lakefiles[0];
}
