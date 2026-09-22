/**
 * Lean file discovery for blueprint responses: the repository walk, the
 * git-backed "files touched on this branch" inference and per-file diff
 * statistics, and the Lean project root lookup.
 *
 * Every git helper degrades to an empty result — never throws — on a folder
 * that is not a git repository or when `git` is missing, exactly as the web
 * backend swallows its `RuntimeError`s. Git is run through `execFile`
 * (no shell) with `windowsHide` so it works on every platform.
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { BlueprintEntry, FileDiffStats } from '@shared/api-types';
import { resolvesUnder } from './latex/project';
import { clonePathOf, normalizeProjectSubdir, posixRelative } from './paths';

const ALL_LEAN_FILES_EXCLUDE_DIRS: ReadonlySet<string> = new Set(['.lake', '.git', 'node_modules']);

// ── Text helpers ───────────────────────────────────────────────────────────

// `ignoreBOM: true` keeps a leading U+FEFF as text, as Python's `utf-8`
// codec (not `utf-8-sig`) does: a BOM'd chapter written back through the
// tag sync or a UI save must keep its BOM instead of producing a byte diff.
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * Read a file as strict UTF-8 with newlines preserved and a BOM kept; null
 * when missing, unreadable or not valid UTF-8 (Python's `read_text` raises
 * on both, and every caller treats that as "no content").
 */
export function readUtf8Text(path: string): string | null {
  try {
    return STRICT_UTF8.decode(readFileSync(path));
  } catch {
    return null;
  }
}

/** Python universal newlines: `\r\n` and lone `\r` become `\n`. */
export function universalNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * Read a text file from the clone, returning '' if missing, unreadable, or
 * outside the clone. Newlines are translated the way Python's `read_text`
 * does, so the served `blueprint_content` / `chapter_contents` are LF-only
 * even for CRLF repositories (the frontend parser expects that).
 */
export function readCloneFile(clonePath: string, relativePath: string): string {
  const filePath = clonePathOf(clonePath, relativePath);
  if (!resolvesUnder(filePath, clonePath)) {
    console.warn(`[blueprint] Refusing to read ${filePath} outside clone`);
    return '';
  }
  try {
    if (!statSync(filePath).isFile()) return '';
  } catch {
    return '';
  }
  const text = readUtf8Text(filePath);
  if (text === null) {
    console.warn(`[blueprint] Failed to read ${filePath} from clone`);
    return '';
  }
  return universalNewlines(text);
}

// ── Pure helpers ───────────────────────────────────────────────────────────

/** Extract the current path from a porcelain status path field (`old -> new` takes the right side). */
export function normalizeGitStatusPath(rawPath: string): string {
  const index = rawPath.indexOf(' -> ');
  return index >= 0 ? rawPath.slice(index + 4) : rawPath;
}

/** Unique Lean file paths in first-seen order, dropping empties. */
export function mergeLeanFileLists(...groups: string[][]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const path of group) {
      if (!path || seen.has(path)) continue;
      merged.push(path);
      seen.add(path);
    }
  }
  return merged;
}

/** Non-empty `lean_file` values from declaration entries, de-duplicated. */
export function entryLeanFiles(entries: Pick<BlueprintEntry, 'lean_file'>[]): string[] {
  return mergeLeanFileLists(entries.map((entry) => entry.lean_file.trim()).filter((path) => path.length > 0));
}

/** True when a changed path should appear in the Lean viewer (a `.lean` that is not a scratch file). */
export function includeInferredLeanFile(path: string): boolean {
  if (!path.endsWith('.lean')) return false;
  const name = path.slice(path.lastIndexOf('/') + 1);
  return !name.toLowerCase().startsWith('scratch');
}

/**
 * Normalize a `leanModule` value into a file path: dotted module names become
 * `Foo/Bar/Baz.lean`, existing paths pass through untouched.
 */
export function leanModuleToPath(leanModule: string): string {
  if (leanModule.endsWith('.lean') || leanModule.includes('/')) return leanModule;
  return `${leanModule.replace(/\./g, '/')}.lean`;
}

/** Keep repo-relative paths inside the selected Lean project. */
export function filesInProject(paths: string[], projectSubdir: string): string[] {
  const subdir = normalizeProjectSubdir(projectSubdir);
  if (!subdir) return paths;
  const prefix = `${subdir}/`;
  return paths.filter((path) => path.startsWith(prefix));
}

/** Keep diff statistics inside the selected project. */
export function diffStatsInProject(stats: Record<string, FileDiffStats>, projectSubdir: string): Record<string, FileDiffStats> {
  const allowed = new Set(filesInProject(Object.keys(stats), projectSubdir));
  const scoped: Record<string, FileDiffStats> = {};
  for (const [path, value] of Object.entries(stats)) if (allowed.has(path)) scoped[path] = value;
  return scoped;
}

/** Convert a project-relative path to its repository-relative form. */
export function repoPathInProject(path: string, projectSubdir: string): string {
  const subdir = normalizeProjectSubdir(projectSubdir);
  return subdir ? `${subdir}/${path}` : path;
}

/**
 * Every Lean source file in the clone as a sorted, repo-relative POSIX path,
 * skipping `.lake` build artifacts, VCS metadata, `node_modules` and
 * scratch-prefixed transient files.
 *
 * The walk runs on every blueprint fetch, so it is asynchronous (the web ran
 * it in a worker thread): the loopback server and the SSE heartbeats keep
 * being served while a large tree is listed.
 */
export async function listAllLeanFiles(clonePath: string): Promise<string[]> {
  try {
    if (!(await stat(clonePath)).isDirectory()) return [];
  } catch {
    return [];
  }
  const results: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    const subdirectories: Promise<void>[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!ALL_LEAN_FILES_EXCLUDE_DIRS.has(entry.name)) subdirectories.push(walk(join(directory, entry.name)));
        continue;
      }
      if (!entry.name.endsWith('.lean')) continue;
      if (entry.name.toLowerCase().startsWith('scratch')) continue;
      results.push(posixRelative(clonePath, join(directory, entry.name)));
    }
    await Promise.all(subdirectories);
  };
  await walk(clonePath);
  return results.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Nearest ancestor of the blueprint entrypoint (strictly inside the clone)
 * that holds a `lakefile.lean` or `lakefile.toml`; the clone root otherwise.
 * Resolving only the blueprint's own Lean project keeps metadata scoped and
 * avoids cross-project name collisions.
 */
export function leanProjectRoot(clonePath: string, blueprintFile: string | null | undefined): string {
  const cloneRoot = resolve(clonePath);
  if (blueprintFile) {
    let directory = dirname(resolve(clonePathOf(clonePath, blueprintFile)));
    while (directory !== cloneRoot && isStrictlyInside(directory, cloneRoot)) {
      if (existsSync(join(directory, 'lakefile.lean')) || existsSync(join(directory, 'lakefile.toml'))) return directory;
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return clonePath;
}

function isStrictlyInside(child: string, root: string): boolean {
  const rel = relative(root, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

// ── Git ────────────────────────────────────────────────────────────────────

/** Run git in `cwd`; resolves to stdout, or null on any failure (missing git, not a repo, non-zero exit). */
export function runGit(cwd: string, args: string[], timeoutMs = 20_000): Promise<string | null> {
  return new Promise((resolveOutput) => {
    try {
      execFile(
        'git',
        args,
        { cwd, windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
        (error, stdout) => resolveOutput(error ? null : String(stdout)),
      );
    } catch {
      resolveOutput(null);
    }
  });
}

/** Like `runGit` but also reports stderr so callers can inspect the failure. */
function runGitDetailed(cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolveOutput) => {
    try {
      execFile(
        'git',
        args,
        { cwd, windowsHide: true, timeout: 20_000, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
        (error, stdout, stderr) => resolveOutput({ ok: !error, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }),
      );
    } catch (error) {
      resolveOutput({ ok: false, stdout: '', stderr: String(error) });
    }
  });
}

/**
 * The repo's default-branch ref as seen by the clone, or null. Tries the
 * symbolic `origin/HEAD` first so repos whose default branch isn't `main`
 * resolve correctly, then common candidates. The desktop adds a final `HEAD`
 * fallback: a local-only checkout on an unusually named branch still gets
 * its uncommitted Lean edits reported against its own tip.
 */
export async function resolveDefaultCompareRef(clonePath: string): Promise<string | null> {
  const candidates: string[] = [];
  const headOutput = await runGit(clonePath, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const headRef = headOutput?.trim() ?? '';
  if (headRef) {
    candidates.push(headRef);
    const short = headRef.startsWith('origin/') ? headRef.slice('origin/'.length) : headRef;
    if (short && short !== headRef) candidates.push(short);
  }
  for (const fallback of ['origin/main', 'main', 'origin/master', 'master', 'HEAD']) {
    if (!candidates.includes(fallback)) candidates.push(fallback);
  }
  for (const candidate of candidates) {
    if ((await runGit(clonePath, ['rev-parse', '--verify', candidate])) !== null) return candidate;
  }
  return null;
}

/** The merge base with HEAD, falling back to the ref itself for orphan branches. */
async function diffBase(clonePath: string, compareRef: string): Promise<string> {
  const output = await runGit(clonePath, ['merge-base', compareRef, 'HEAD']);
  return output?.trim() || compareRef;
}

/** Parse `git diff --numstat` output for included Lean files. */
export function parseLeanNumstat(output: string): Record<string, FileDiffStats> {
  const stats: Record<string, FileDiffStats> = {};
  for (const line of output.split(/\r?\n/)) {
    const parts = line.split('\t');
    if (parts.length < 3 || parts[0] === '-' || parts[1] === '-') continue;
    const added = Number(parts[0]);
    const deleted = Number(parts[1]);
    if (!Number.isInteger(added) || !Number.isInteger(deleted) || parts[0].trim() === '' || parts[1].trim() === '') continue;
    const path = parts[2].trim();
    if (includeInferredLeanFile(path) && (added || deleted)) stats[path] = { added, deleted };
  }
  return stats;
}

/** Count untracked Lean files as additions. */
async function untrackedLeanStats(clonePath: string): Promise<Record<string, FileDiffStats>> {
  const output = await runGit(clonePath, ['ls-files', '--others', '--exclude-standard', '--', '*.lean']);
  if (output === null) return {};
  const stats: Record<string, FileDiffStats> = {};
  for (const rawPath of output.split(/\r?\n/)) {
    const path = rawPath.trim();
    if (!includeInferredLeanFile(path)) continue;
    let lineCount = 0;
    try {
      const bytes = readFileSync(clonePathOf(clonePath, path));
      // Python counts lines by iterating a binary handle: every '\n' plus an unterminated last line.
      for (const byte of bytes) if (byte === 0x0a) lineCount += 1;
      if (bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a) lineCount += 1;
    } catch {
      continue;
    }
    if (lineCount) stats[path] = { added: lineCount, deleted: 0 };
  }
  return stats;
}

/**
 * Per-file added/deleted line counts introduced by the branch: the diff
 * against the merge-base with the compare ref, plus staged/unstaged/untracked
 * Lean edits. Files with zero line-level changes are omitted. `compareRef`
 * undefined means "resolve the default"; null means "no ref" → `{}`.
 */
export async function computeLeanFileDiffStats(clonePath: string, compareRef?: string | null): Promise<Record<string, FileDiffStats>> {
  const ref = compareRef === undefined ? await resolveDefaultCompareRef(clonePath) : compareRef;
  if (typeof ref !== 'string') return {};
  const base = await diffBase(clonePath, ref);
  const output = await runGit(clonePath, ['diff', '--numstat', '--no-renames', base, '--', '*.lean']);
  if (output === null) {
    console.warn(`[blueprint] Failed to compute Lean diff stats in ${clonePath}`);
    return {};
  }
  return { ...parseLeanNumstat(output), ...(await untrackedLeanStats(clonePath)) };
}

/** Lean files changed from the branch merge base. */
async function branchLeanPaths(clonePath: string, compareRef: string): Promise<Set<string>> {
  let result = await runGitDetailed(clonePath, ['diff', '--name-only', '--diff-filter=ACMR', `${compareRef}...HEAD`]);
  if (!result.ok && result.stderr.toLowerCase().includes('no merge base')) {
    result = await runGitDetailed(clonePath, ['diff', '--name-only', '--diff-filter=ACMR', `${compareRef}..HEAD`]);
  }
  if (!result.ok) {
    console.warn(`[blueprint] Failed to infer Lean files from branch diff in ${clonePath}`);
    return new Set();
  }
  const paths = new Set<string>();
  for (const line of result.stdout.split(/\r?\n/)) {
    const path = line.trim();
    if (includeInferredLeanFile(path)) paths.add(path);
  }
  return paths;
}

/** Non-deleted Lean files in the porcelain working-tree status. */
async function workingTreeLeanPaths(clonePath: string): Promise<Set<string>> {
  const output = await runGit(clonePath, ['status', '--porcelain', '--untracked-files=all']);
  if (output === null) {
    console.warn(`[blueprint] Failed to infer Lean files from working tree in ${clonePath}`);
    return new Set();
  }
  const paths = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    if (line.length < 4) continue;
    const status = line.slice(0, 2);
    const path = normalizeGitStatusPath(line.slice(3).trim());
    const deleted = status.includes('D') && !status.includes('R') && !status.includes('C');
    if (includeInferredLeanFile(path) && !deleted) paths.add(path);
  }
  return paths;
}

/** Infer Lean files from app-authored blueprint update commits. */
async function inferLeanFilesFromAppCommits(clonePath: string, blueprintName: string): Promise<string[]> {
  const output = await runGit(clonePath, ['log', `--grep=^Update blueprint ${blueprintName}$`, '--name-only', '--format=', '--', '*.lean']);
  if (output === null) {
    console.warn(`[blueprint] Failed to infer Lean files from blueprint commit history in ${clonePath}`);
    return [];
  }
  const paths = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const path = line.trim();
    if (includeInferredLeanFile(path)) paths.add(path);
  }
  return [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Infer Lean files for a blueprint from branch and working-tree changes:
 * `.lean` files changed relative to the compare ref, unioned with uncommitted
 * Lean files in the working tree so recently edited files appear before the
 * next commit. `compareRef` undefined means "resolve the default".
 */
export async function inferLeanFilesFromClone(clonePath: string, blueprintName: string, compareRef?: string | null): Promise<string[]> {
  const ref = compareRef === undefined ? await resolveDefaultCompareRef(clonePath) : compareRef;
  const paths = typeof ref === 'string' ? await branchLeanPaths(clonePath, ref) : new Set<string>();
  for (const path of await workingTreeLeanPaths(clonePath)) paths.add(path);
  if (paths.size) return [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return inferLeanFilesFromAppCommits(clonePath, blueprintName);
}
