/**
 * Framework-free loading of multi-file LaTeX projects: containment checks,
 * `\input`/`\include` resolution, expansion, and the transitive file list.
 *
 * Include targets are source-controlled text but are still treated as
 * adversarial: everything must stay inside the project root after symlinks
 * are followed, and a malformed target (NUL bytes, overlong names) fails
 * closed instead of aborting the scan.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { iterLatexCommandLines, splitLatexPhysicalLines } from './comments';

export const DEFAULT_MAX_INCLUDE_DEPTH = 32;

/** Reads one file as text; `null` when it is missing, unreadable or not UTF-8. */
export type TextReader = (filePath: string) => string | null;

/** Observes one include directive: including file, 1-based line, raw target, resolved child. */
export type IncludeObserver = (current: string, line: number, rawTarget: string, child: string | null) => void;

const INPUT_PATTERN = /\\(?:input|include)\{([^}]+)\}/g;

/**
 * Read a UTF-8 file with newlines untranslated (CRLF preserved). Decoding is
 * strict, like Python's `open(encoding="utf-8")`, and a BOM is kept as text.
 */
export function readUtf8(filePath: string): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(fs.readFileSync(filePath));
  } catch {
    return null;
  }
}

/**
 * Python's `Path.resolve(strict=False)`: make the path absolute, follow
 * symlinks through the longest existing prefix, then append the rest with
 * `..` segments collapsed textually. Returns `null` for paths the OS cannot
 * represent (NUL bytes), so callers fail closed.
 */
export function resolvePathLoose(target: string): string | null {
  if (target.includes('\0')) return null;
  const absolute = path.isAbsolute(target) ? target : process.cwd() + path.sep + target;
  let current = absolute;
  const tail: string[] = [];
  for (;;) {
    let real: string | null;
    try {
      real = fs.realpathSync.native(current);
    } catch {
      real = null;
    }
    if (real !== null) return tail.length ? path.join(real, ...tail.reverse()) : real;
    const parent = path.dirname(current);
    if (parent === current) return path.normalize(absolute);
    tail.push(path.basename(current));
    current = parent;
  }
}

/** Whether `child` equals `parent` or lies below it (both already resolved). */
function isWithin(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  if (relative === '') return true;
  if (path.isAbsolute(relative)) return false;
  return relative !== '..' && !relative.startsWith('..' + path.sep);
}

/**
 * Join like `pathlib`: separators normalised, `.` segments dropped, but `..`
 * kept so that a symlinked directory is followed *before* the parent step,
 * exactly as the OS (and TeX) would open the file. `path.join` would collapse
 * `link/../x` textually and open a different file.
 */
function joinUnnormalized(base: string, relative: string): string {
  const segments = relative.split(/[\\/]/).filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0) return base;
  const joined = segments.join(path.sep);
  return base.endsWith(path.sep) || base.endsWith('/') ? base + joined : base + path.sep + joined;
}

/** Whether `target` remains under `projectRoot` after symlink resolution. */
export function resolvesUnder(target: string, projectRoot: string): boolean {
  const resolvedTarget = resolvePathLoose(target);
  const resolvedRoot = resolvePathLoose(projectRoot);
  if (resolvedTarget === null || resolvedRoot === null) return false;
  return isWithin(resolvedTarget, resolvedRoot);
}

/** Resolve a relative path only if it is contained by `projectRoot`. */
export function resolveProjectPath(projectRoot: string, relative: string): string | null {
  if (path.isAbsolute(relative)) return null;
  const candidate = joinUnnormalized(projectRoot, relative);
  return resolvesUnder(candidate, projectRoot) ? candidate : null;
}

type StatKind = 'file' | 'other' | 'missing' | 'error';

/**
 * Classify a candidate the way Python's `Path.is_file()` does: a missing
 * entry is simply "not a file", while an unrepresentable path (overlong name,
 * NUL byte) raises and makes the candidate unusable.
 */
function statKind(candidate: string): StatKind {
  if (candidate.includes('\0')) return 'error';
  try {
    return fs.statSync(candidate).isFile() ? 'file' : 'other';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EBADF' || code === 'ELOOP' ? 'missing' : 'error';
  }
}

/**
 * Resolve a contained include target using TeX-style search roots.
 *
 * A TeX build searches from its working directory before the including
 * file's directory; Fuse callers pass the entrypoint's directory as the
 * search root. A missing file still resolves to the first usable candidate
 * so callers can report it, but `expandLatexIncludes` / `collectIncludedFiles`
 * skip unreadable ones.
 */
export function resolveInputFile(
  texFile: string,
  rawTarget: string,
  projectRoot: string,
  opts: { inputSearchRoots?: readonly string[] } = {},
): string | null {
  let target = rawTarget.trim();
  // `pathlib` replaces the base with an absolute right operand, which then
  // fails containment; rejecting drive-absolute Windows targets up front
  // (`path.isAbsolute`) gives the same answer without a bogus candidate.
  if (!target || target.startsWith('/') || path.isAbsolute(target)) return null;
  if (!target.endsWith('.tex')) target = `${target}.tex`;
  const candidates: string[] = [];
  for (const base of [...(opts.inputSearchRoots ?? []), path.dirname(texFile)]) {
    const candidate = joinUnnormalized(base, target);
    if (resolvesUnder(candidate, projectRoot) && !candidates.includes(candidate)) candidates.push(candidate);
  }
  let firstUsable: string | null = null;
  for (const candidate of candidates) {
    const kind = statKind(candidate);
    if (kind === 'error') continue;
    if (firstUsable === null) firstUsable = candidate;
    if (kind === 'file') return candidate;
  }
  return firstUsable;
}

function safeRead(reader: TextReader, filePath: string): string | null {
  try {
    return reader(filePath);
  } catch {
    return null;
  }
}

export interface ExpandOptions {
  reader?: TextReader;
  seen?: Set<string>;
  depth?: number;
  maxDepth?: number;
  inputSearchRoots?: readonly string[];
}

/**
 * Expand contained `\input` and `\include` tags, preserving source newlines.
 *
 * Returns `''` past the depth bound or for a file already seen (a cycle), and
 * `null` when the file is outside the project or unreadable. At the top level
 * only, an include line that is exactly the command plus its newline drops
 * that newline when the expansion already ends with one.
 */
export function expandLatexIncludes(texFile: string, projectRoot: string, opts: ExpandOptions = {}): string | null {
  const reader = opts.reader ?? readUtf8;
  const depth = opts.depth ?? 0;
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_INCLUDE_DEPTH;
  const inputSearchRoots = opts.inputSearchRoots ?? [];
  if (depth > maxDepth) return '';
  if (!resolvesUnder(texFile, projectRoot)) return null;
  const resolved = resolvePathLoose(texFile);
  if (resolved === null) return null;
  const seen = opts.seen ?? new Set<string>();
  if (seen.has(resolved)) return '';
  seen.add(resolved);
  const source = safeRead(reader, texFile);
  if (source === null) return null;

  const expandLine = (line: string, visible: string): string => {
    const parts: string[] = [];
    let cursor = 0;
    let discardTrailingNewline = false;
    const pattern = new RegExp(INPUT_PATTERN.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(visible)) !== null) {
      const matchEnd = match.index + match[0].length;
      parts.push(line.slice(cursor, match.index));
      const child = resolveInputFile(texFile, match[1], projectRoot, { inputSearchRoots });
      if (child === null) {
        parts.push(match[0]);
      } else {
        const expanded = expandLatexIncludes(child, projectRoot, {
          reader,
          seen,
          depth: depth + 1,
          maxDepth,
          inputSearchRoots,
        });
        parts.push(expanded === null ? match[0] : expanded);
        const trailing = line.slice(matchEnd);
        if (expanded !== null && depth === 0 && (trailing === '\r\n' || trailing === '\n') && expanded.endsWith('\n')) {
          discardTrailingNewline = true;
        }
      }
      cursor = matchEnd;
    }
    if (!discardTrailingNewline) parts.push(line.slice(cursor));
    return parts.join('');
  };

  const rawLines = splitLatexPhysicalLines(source, true);
  const visibleLines = iterLatexCommandLines(source).map(([, line]) => line);
  return rawLines.map((line, index) => expandLine(line, visibleLines[index])).join('');
}

export interface CollectOptions {
  reader?: TextReader;
  maxDepth?: number;
  inputSearchRoots?: readonly string[];
  onInput?: IncludeObserver;
}

/** Convert a native relative path to posix separators. */
export function toPosixPath(relative: string): string {
  return path.sep === '/' ? relative : relative.split(path.sep).join('/');
}

/**
 * The posix path of `target` relative to the resolved project root, the way
 * `collectIncludedFiles` lists files; `null` when it resolves outside the
 * root (or cannot be represented).
 */
export function projectRelativePath(projectRoot: string, target: string): string | null {
  const root = resolvePathLoose(projectRoot);
  const resolved = resolvePathLoose(target);
  if (root === null || resolved === null || !isWithin(resolved, root)) return null;
  return toPosixPath(path.relative(root, resolved));
}

/**
 * A `TextReader` that reads each path at most once. The include walk, the
 * expansion and the per-file parse all read the same chapters; sharing one
 * reader across a single parse turns three reads per file into one.
 */
export function memoizedReader(reader: TextReader = readUtf8): TextReader {
  const cache = new Map<string, string | null>();
  return (filePath) => {
    const cached = cache.get(filePath);
    if (cached !== undefined) return cached;
    const value = reader(filePath);
    cache.set(filePath, value);
    return value;
  };
}

/**
 * Return readable, contained TeX files in transitive include order (pre-order,
 * each once), as posix paths relative to the resolved project root.
 */
export function collectIncludedFiles(texFile: string, projectRoot: string, opts: CollectOptions = {}): string[] {
  const reader = opts.reader ?? readUtf8;
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_INCLUDE_DEPTH;
  const inputSearchRoots = opts.inputSearchRoots ?? [];
  const root = resolvePathLoose(projectRoot);
  const ordered: string[] = [];
  const visited = new Set<string>();
  if (root === null) return ordered;

  const walk = (current: string, depth: number): void => {
    if (depth > maxDepth || !resolvesUnder(current, projectRoot)) return;
    const resolved = resolvePathLoose(current);
    if (resolved === null) return;
    const relative = path.relative(root, resolved);
    if (!isWithin(resolved, root)) return;
    if (visited.has(resolved)) return;
    // An unreadable file is neither listed nor remembered, exactly as the
    // reference implementation behaves.
    const source = safeRead(reader, current);
    if (source === null) return;
    visited.add(resolved);
    ordered.push(toPosixPath(relative));
    for (const [lineNumber, line] of iterLatexCommandLines(source)) {
      const pattern = new RegExp(INPUT_PATTERN.source, 'g');
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line)) !== null) {
        const child = resolveInputFile(current, match[1], projectRoot, { inputSearchRoots });
        if (opts.onInput) opts.onInput(current, lineNumber, match[1], child);
        if (child !== null) walk(child, depth + 1);
      }
    }
  };

  walk(texFile, 0);
  return ordered;
}
