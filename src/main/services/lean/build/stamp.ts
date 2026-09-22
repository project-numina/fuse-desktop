/**
 * The build stamp records the most recent build attempt — committed
 * revision, exact dirty-worktree state, dependency inputs and outcome — so
 * reopening a workspace can skip the build when nothing that feeds Lake has
 * changed. It is written at the end of every attempt whether or not lake
 * exited cleanly, so a project with a known error set is not rebuilt on
 * every open either.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, unlinkSync } from 'node:fs';
import { join, relative } from 'node:path';
import { atomicWriteJson, sourceContentHash } from './snapshot';
import { isInside, resolveLenient, toPosix } from '../paths';

export const STAMP_FILE = join('.lake', '.build-stamp.json');
export const BUILD_OK_MARKER = '.build-ok';

/** Repo-relative local tool state that must never count as a source change. */
export const LOCAL_GENERATED_PATHS = ['.lake', '.claude', 'numina/.metadata', '.numina/cache'] as const;

const CLEAN_WORKTREE_HASH = createHash('sha256').update('').digest('hex');

export type BuildOutcome = 'ok' | 'errors';

export interface BuildState {
  head: string;
  worktree_hash: string;
  toolchain_hash: string;
  manifest_hash: string;
}

export interface BuildStamp extends BuildState {
  outcome: BuildOutcome;
  attempted_at: string;
}

/** Scope a status probe to the project while excluding local tool state. */
export function statePathspecs(projectPathspec: string, exclude: readonly string[] = []): string[] {
  if (projectPathspec.includes('\0')) throw new Error('project_pathspec must be a string without NUL');
  const root = projectPathspec || '.';
  const prefix = root === '.' ? '' : `${root}/`;
  return [root, ...exclude.map((path) => `:(exclude)${prefix}${path}`)];
}

export type GitRunner = (args: string[], cwd: string) => Promise<string>;

export const runGit: GitRunner = (args, cwd) =>
  new Promise((resolve, reject) => {
    execFile('git', args, { cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`git ${args.join(' ')} failed: ${(stderr || error.message).trim()}`));
        return;
      }
      resolve(stdout);
    });
  });

/** Every path named by porcelain-v1 output, including both sides of a rename. */
export function statusPathsFromPorcelain(status: string): string[] {
  const nulDelimited = status.includes('\0');
  const entries = nulDelimited ? status.split('\0') : status.split(/\r?\n/);
  const paths: string[] = [];
  let index = 0;
  while (index < entries.length) {
    const entry = entries[index];
    index += 1;
    if (!entry) continue;
    if (entry.length < 4 || entry[2] !== ' ') {
      paths.push(entry);
      continue;
    }
    const change = entry.slice(0, 2);
    paths.push(entry.slice(3));
    if (nulDelimited && (change.includes('R') || change.includes('C')) && index < entries.length) {
      const source = entries[index];
      index += 1;
      if (source) paths.push(source);
    }
  }
  return paths;
}

/**
 * Hash the status text plus the current state of every path it names
 * (content for files, target for symlinks) without following links outside
 * the repository. A clean tree hashes to sha256("").
 */
export function worktreeHash(repository: string, status: string): string {
  const digest = createHash('sha256').update(status, 'utf8');
  const root = resolveLenient(repository);
  for (const relativePath of [...new Set(statusPathsFromPorcelain(status))].sort()) {
    digest.update(relativePath, 'utf8');
    digest.update('\0');
    const path = join(repository, relativePath);
    try {
      const info = lstatSync(path, { throwIfNoEntry: false });
      if (info?.isSymbolicLink()) {
        digest.update('symlink\0');
        digest.update(readlinkSync(path), 'utf8');
        digest.update('\0');
      } else if (!isInside(root, resolveLenient(path))) {
        digest.update('outside-repository\0');
      } else if (info?.isFile()) {
        digest.update('file\0');
        digest.update(createHash('sha256').update(readFileSync(path)).digest());
      } else if (info?.isDirectory()) {
        digest.update('directory\0');
      } else {
        digest.update('missing\0');
      }
    } catch {
      digest.update('unreadable\0');
    }
  }
  return digest.digest('hex');
}

/** sha256 hex of a file, '' when unavailable. */
export function fileHash(path: string): string {
  return sourceContentHash(path) ?? '';
}

/**
 * Non-git fallback: hash everything Lake compiles (every `.lean`, the
 * lakefiles) so edits still invalidate the stamp when the folder is not a
 * repository. Tool state directories are skipped.
 */
export function plainTreeHash(projectRoot: string): string {
  const files: string[] = [];
  const walk = (directory: string): void => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!['.git', '.lake', '.claude', 'node_modules'].includes(entry.name)) walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if (lower.endsWith('.lean') || lower === 'lakefile.toml') files.push(full);
    }
  };
  walk(projectRoot);
  files.sort();
  const digest = createHash('sha256');
  for (const file of files) {
    digest.update(toPosix(relative(projectRoot, file)), 'utf8');
    digest.update('\0');
    digest.update(fileHash(file));
    digest.update('\0');
  }
  return digest.digest('hex');
}

export interface ComputeBuildStateOptions {
  gitRunner?: GitRunner;
  excludedPaths?: readonly string[];
}

/** Committed, worktree, toolchain and manifest inputs of the next build. */
export async function computeBuildState(repositoryRoot: string, projectRoot: string, options: ComputeBuildStateOptions = {}): Promise<BuildState> {
  const gitRunner = options.gitRunner ?? runGit;
  const excluded = options.excludedPaths ?? LOCAL_GENERATED_PATHS;
  const toolchain = fileHash(join(projectRoot, 'lean-toolchain'));
  const manifest = fileHash(join(projectRoot, 'lake-manifest.json'));
  const repoReal = resolveLenient(repositoryRoot);
  const projectReal = resolveLenient(projectRoot);
  if (!isInside(repoReal, projectReal)) throw new Error('project root escapes the repository');
  const relativeProject = toPosix(relative(repoReal, projectReal)) || '.';

  // `.git` may be a file (worktrees); either way its absence means "not a repo".
  if (!existsSync(join(repositoryRoot, '.git'))) {
    return { head: '', worktree_hash: plainTreeHash(projectRoot), toolchain_hash: toolchain, manifest_hash: manifest };
  }
  let head: string;
  try {
    head = (await gitRunner(['rev-parse', 'HEAD'], repositoryRoot)).trim();
  } catch {
    // A repository with no commits yet has no HEAD; the worktree hash still covers the sources.
    head = '';
  }
  let status: string;
  try {
    status = await gitRunner(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...statePathspecs(relativeProject, excluded)], repositoryRoot);
  } catch {
    return { head, worktree_hash: plainTreeHash(projectRoot), toolchain_hash: toolchain, manifest_hash: manifest };
  }
  return { head, worktree_hash: worktreeHash(repositoryRoot, status), toolchain_hash: toolchain, manifest_hash: manifest };
}

export function readBuildStamp(projectRoot: string): BuildStamp | null {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(join(projectRoot, STAMP_FILE), 'utf8'));
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of ['head', 'worktree_hash', 'toolchain_hash', 'manifest_hash', 'attempted_at']) {
    if (typeof record[key] !== 'string') return null;
  }
  if (record.outcome !== 'ok' && record.outcome !== 'errors') return null;
  return record as unknown as BuildStamp;
}

/** Persist a stamp and remove the legacy success marker. */
export function writeBuildStamp(projectRoot: string, state: BuildState, outcome: BuildOutcome = 'ok'): void {
  const payload: BuildStamp = { ...state, outcome, attempted_at: new Date().toISOString() };
  atomicWriteJson(join(projectRoot, STAMP_FILE), payload);
  try {
    unlinkSync(join(projectRoot, BUILD_OK_MARKER));
  } catch {
    // Already absent.
  }
}

export function deleteBuildStamp(projectRoot: string): void {
  for (const file of [STAMP_FILE, BUILD_OK_MARKER]) {
    try {
      unlinkSync(join(projectRoot, file));
    } catch {
      // Already absent.
    }
  }
}

/** Whether a stamp represents this exact build input state. */
export function stampMatchesState(stamp: BuildStamp | null, state: BuildState): boolean {
  if (stamp === null) return false;
  const record = stamp as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(state)) {
    if (key === 'worktree_hash' && (record[key] === null || record[key] === undefined) && value === CLEAN_WORKTREE_HASH) continue;
    if (record[key] !== value) return false;
  }
  return true;
}
