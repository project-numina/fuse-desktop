/**
 * Which repository paths Fuse treats as local tool state, not user content.
 * Reproduced verbatim from the web backend's generated-path policy so status,
 * diff and staging agree on what counts as a change.
 */

export const SOURCE_READY_MARKER = '.numina-source-ready';

/** Local tool state directories that Fuse should not treat as user content. */
export const LOCAL_GENERATED_DIRECTORIES: readonly string[] = ['.lake', '.claude'];

/** Repo-relative local tool paths excluded from content-state operations. */
export const LOCAL_GENERATED_PATHS: readonly string[] = [
  ...LOCAL_GENERATED_DIRECTORIES,
  'numina/.metadata',
  SOURCE_READY_MARKER,
];

/** Git pathspecs for source/content operations that exclude local tool state. */
export const LOCAL_GENERATED_PATHSPECS: readonly string[] = [
  '.',
  ...LOCAL_GENERATED_PATHS.map((path) => `:(exclude)${path}`),
  // Lake and Claude create project-local state below nested monorepo roots;
  // root-only exclusions would accidentally stage ``lean/foo/.lake``.
  ':(exclude,glob)**/.lake/**',
  ':(exclude,glob)**/.claude/**',
  // A pre-fix nested agent could interpret the repo-relative metadata prompt
  // from its project cwd and create ``<project>/numina/.metadata``. Treat
  // those misplaced scratch trees as generated state too.
  ':(exclude,glob)**/numina/.metadata/**',
  // Transient agent scratch files, matching the Lean viewer's rule: a
  // ``.lean`` file whose name starts with "scratch" (case-insensitive),
  // at the repo root or nested anywhere.
  ':(exclude,icase)scratch*.lean',
  ':(exclude,icase)*/scratch*.lean',
];

/**
 * Repository-owned automation the hosted sandbox never publishes. On desktop
 * the user owns the repository, so these are applied only to agent commits.
 */
export const PROTECTED_REPOSITORY_PATHS: readonly string[] = ['.github'];
export const PROTECTED_REPOSITORY_PATHSPECS: readonly string[] = PROTECTED_REPOSITORY_PATHS.map((path) => `:(exclude)${path}`);
export const AGENT_CONTENT_PATHSPECS: readonly string[] = [...LOCAL_GENERATED_PATHSPECS, ...PROTECTED_REPOSITORY_PATHSPECS];

/** Pathspecs that unstage generated state even when an older run staged it. */
export const GENERATED_RESET_PATHSPECS: readonly string[] = [
  ...LOCAL_GENERATED_DIRECTORIES,
  'numina/.metadata',
  ':(glob)**/.lake/**',
  ':(glob)**/.claude/**',
  ':(glob)**/numina/.metadata/**',
  SOURCE_READY_MARKER,
];

const COMMIT_SHA = /^[0-9a-fA-F]{4,40}$/;

/**
 * A commit SHA is hex only — full (40) or abbreviated (>= 4). Anything else
 * (option-like strings, refspecs, separators) never reaches a git argv.
 */
export function isValidCommitSha(sha: string): boolean {
  return typeof sha === 'string' && COMMIT_SHA.test(sha);
}

const FORBIDDEN_REF_CHARACTERS = new Set([' ', '~', '^', ':', '?', '*', '[', '\\']);

/**
 * Git's ref-name restrictions for externally supplied branch names, plus a
 * leading ``-`` rejection so a name can never be parsed as an option.
 */
export function isSafeBranchName(value: string): boolean {
  if (typeof value !== 'string' || !value) return false;
  if (value.startsWith('.') || value.startsWith('-')) return false;
  if (value.endsWith('.') || value.endsWith('.lock') || value.endsWith('/')) return false;
  if (value.includes('\0') || value.includes('..') || value.includes('@{') || value.includes('//')) return false;
  for (const character of value) {
    if (FORBIDDEN_REF_CHARACTERS.has(character) || character.charCodeAt(0) < 32) return false;
  }
  return true;
}

/** Strip a ``refs/heads/`` prefix and surrounding slashes from a branch spelling. */
export function normalizeBranchName(value: string | null | undefined): string {
  let branch = (value ?? '').trim();
  if (branch.startsWith('refs/heads/')) branch = branch.slice('refs/heads/'.length);
  return branch.replace(/^\/+|\/+$/g, '');
}
