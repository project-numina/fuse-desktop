/**
 * Shared shapes every backend service module codes against. Keep this file
 * small and stable: it is the contract between independently developed
 * modules (blueprint parsing, Lean, git, workspaces, sources, sessions).
 */

import type { BlueprintRow, RepositoryRow } from '../store/rows';

/**
 * A blueprint opened in a repository folder. Mirrors the web's
 * (clone_path, name, blueprint_file, project_subdir) tuple: the clone is the
 * user's folder itself, and the Lean project lives at `<clonePath>/<projectSubdir>`.
 */
export interface OpenProject {
  repository: RepositoryRow;
  blueprint: BlueprintRow;
  /** Absolute path of the repository folder (the web's clone_path). */
  clonePath: string;
  /** Repo-relative Lean project directory ('' = repository root). */
  projectSubdir: string;
  /** Absolute path of the Lean project root. */
  projectRoot: string;
  /** Repo-relative entrypoint .tex path, or null when not yet chosen. */
  blueprintFile: string | null;
  /** Room key "<owner>/<repo>/<blueprint>" for blueprint SSE events. */
  roomKey: string;
}

export function roomKeyFor(repository: RepositoryRow, blueprintId: string): string {
  return `${repository.owner}/${repository.name}/${blueprintId}`;
}
