/**
 * Per-project persistence of the most recent Lean diagnostics, the source of
 * truth for the "files with errors" dots in the file tree.
 *
 * The on-disk format is one JSON file at `.lake/.build-errors.json` under the
 * project root (version 2):
 *
 *   { "version": 2, "updated_at": "<ISO8601>",
 *     "content_hashes": { "<project-relative file>": "<sha256 hex>" },
 *     "files": { "<project-relative file>": [ {file,line,column,severity,message}, ... ] } }
 *
 * Three merge modes: `replaceAll` (full build: every file not reported is
 * clean), `replaceFiles` (partial build: only in-scope files change) and
 * `replaceSingleFile` (an LSP query for one file). Entries are attested to a
 * content hash captured before elaboration so a stale diagnostic for older
 * bytes is never mistaken for a verdict on the current source. The deps-ready
 * marker lives here too: both are tiny state files under `.lake/`.
 */

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import type { Diagnostic } from '../diagnostics';
import { toPosix } from '../paths';

export const SNAPSHOT_FILE = join('.lake', '.build-errors.json');
export const DEPS_READY_MARKER = join('.lake', '.deps-ready');
export const FAILED_DEPENDENCIES_PREFIX = 'Imported dependencies failed to build: ';

const VERSION = 2;
const TOOLCHAIN_FILE = 'lean-toolchain';
const MANIFEST_FILE = 'lake-manifest.json';
const IGNORED_SOURCE_DIRECTORIES = new Set(['.git', '.lake', '.claude']);

export interface DepsState {
  toolchainHash: string;
  manifestHash: string;
}

export interface FileCounts {
  errors: number;
  warnings: number;
}

export type Snapshot = Record<string, Diagnostic[]>;

/** Structural shape of one LSP diagnostic in any wire model. */
export interface DiagnosticLike {
  severity: string;
  message: string;
  line: number;
  column: number;
}

/** sha256 hex of the file's bytes, or null when unreadable. */
export function sourceContentHash(path: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return null;
  }
}

function snapshotPath(projectRoot: string): string {
  return join(projectRoot, SNAPSHOT_FILE);
}

/**
 * Write JSON via temp + rename so readers never see torn output. The mtime
 * poll that feeds `build_errors_updated` depends on it, as does a second
 * process (the MCP server) rewriting the file concurrently.
 */
export function atomicWriteJson(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.tmp.${randomUUID().replace(/-/g, '').slice(0, 8)}`);
  try {
    writeFileSync(tmp, JSON.stringify(payload), 'utf8');
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // Nothing to clean up.
    }
    throw error;
  }
}

export function computeDepsState(projectRoot: string): DepsState {
  return {
    toolchainHash: sourceContentHash(join(projectRoot, TOOLCHAIN_FILE)) ?? '',
    manifestHash: sourceContentHash(join(projectRoot, MANIFEST_FILE)) ?? '',
  };
}

/** Marker exists, parses, and its hashes equal the current toolchain/manifest. */
export function depsReady(projectRoot: string): boolean {
  const marker = join(projectRoot, DEPS_READY_MARKER);
  let data: unknown;
  try {
    if (!statSync(marker).isFile()) return false;
    data = JSON.parse(readFileSync(marker, 'utf8'));
  } catch {
    return false;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const record = data as Record<string, unknown>;
  const current = computeDepsState(projectRoot);
  return record.toolchain_hash === current.toolchainHash && record.manifest_hash === current.manifestHash;
}

export function markDepsReady(projectRoot: string, state: DepsState): void {
  atomicWriteJson(join(projectRoot, DEPS_READY_MARKER), {
    version: VERSION,
    toolchain_hash: state.toolchainHash,
    manifest_hash: state.manifestHash,
    marked_at: new Date().toISOString(),
  });
}

export function clearDepsReady(projectRoot: string): void {
  try {
    unlinkSync(join(projectRoot, DEPS_READY_MARKER));
  } catch {
    // Already absent.
  }
}

/** Snapshot mtime in milliseconds, or null when absent. */
export function snapshotMtime(projectRoot: string): number | null {
  try {
    return statSync(snapshotPath(projectRoot)).mtimeMs;
  } catch {
    return null;
  }
}

function parseDiagnostic(entry: unknown): Diagnostic | null {
  if (!entry || typeof entry !== 'object') return null;
  const value = entry as Record<string, unknown>;
  if (typeof value.file !== 'string' || typeof value.severity !== 'string' || typeof value.message !== 'string') return null;
  if (!Number.isInteger(value.line) || !Number.isInteger(value.column)) return null;
  return { file: value.file, line: value.line as number, column: value.column as number, severity: value.severity, message: value.message };
}

function readSnapshotPayload(projectRoot: string): { files: Snapshot; hashes: Record<string, string> } {
  const path = snapshotPath(projectRoot);
  let data: unknown;
  try {
    if (!statSync(path).isFile()) return { files: {}, hashes: {} };
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { files: {}, hashes: {} };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { files: {}, hashes: {} };
  const record = data as Record<string, unknown>;
  const rawFiles = record.files;
  if (!rawFiles || typeof rawFiles !== 'object' || Array.isArray(rawFiles)) return { files: {}, hashes: {} };
  const files: Snapshot = {};
  for (const [filePath, entries] of Object.entries(rawFiles as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    files[filePath] = entries.map(parseDiagnostic).filter((d): d is Diagnostic => d !== null);
  }
  const hashes: Record<string, string> = {};
  const rawHashes = record.content_hashes;
  if (rawHashes && typeof rawHashes === 'object' && !Array.isArray(rawHashes)) {
    for (const [filePath, hash] of Object.entries(rawHashes as Record<string, unknown>)) {
      if (typeof hash === 'string') hashes[filePath] = hash;
    }
  }
  return { files, hashes };
}

/** The persisted per-file diagnostic map ({} when missing or corrupt). */
export function readSnapshot(projectRoot: string): Snapshot {
  return readSnapshotPayload(projectRoot).files;
}

/**
 * Diagnostics for `filePath` only when they describe the file's current
 * bytes; null for a missing entry, a legacy entry without a hash, or a file
 * edited since (all deliberately "unknown", never "clean").
 */
export function readMatchingFileDiagnostics(projectRoot: string, filePath: string): Diagnostic[] | null {
  return readMatchingFileDiagnosticsMany(projectRoot, [filePath])[filePath] ?? null;
}

export function readMatchingFileDiagnosticsMany(projectRoot: string, filePaths: Iterable<string>): Snapshot {
  const { files, hashes } = readSnapshotPayload(projectRoot);
  const result: Snapshot = {};
  for (const filePath of new Set(filePaths)) {
    const diagnostics = files[filePath];
    const stored = hashes[filePath];
    if (diagnostics === undefined || stored === undefined) continue;
    if (stored === sourceContentHash(join(projectRoot, filePath))) result[filePath] = diagnostics;
  }
  return result;
}

/** Project-relative hashes of every `.lean` source (skipping .git/.lake/.claude and symlinks). */
export function snapshotLeanSourceHashes(projectRoot: string): Record<string, string> {
  const hashes: Record<string, string> = {};
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
        if (!IGNORED_SOURCE_DIRECTORIES.has(entry.name)) walk(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.lean')) continue;
      const hash = sourceContentHash(full);
      if (hash) hashes[toPosix(relative(projectRoot, full))] = hash;
    }
  };
  walk(projectRoot);
  return hashes;
}

function confinedProjectSource(projectRoot: string, sourcePath: string): string | null {
  const posix = sourcePath.replace(/\\/g, '/');
  if (isAbsolute(sourcePath) || /^[A-Za-z]:/.test(posix) || posix.startsWith('/')) return null;
  if (posix.split('/').includes('..')) return null;
  return join(projectRoot, ...posix.split('/'));
}

/** Keep only pre-operation hashes whose source bytes did not change (keys confined to the project). */
export function unchangedSourceHashes(projectRoot: string, observed: Record<string, string>): Record<string, string> {
  const unchanged: Record<string, string> = {};
  for (const [sourcePath, hash] of Object.entries(observed)) {
    const candidate = confinedProjectSource(projectRoot, sourcePath);
    if (candidate !== null && sourceContentHash(candidate) === hash) unchanged[sourcePath] = hash;
  }
  return unchanged;
}

function writeSnapshot(projectRoot: string, files: Snapshot, contentHashes: Record<string, string>): void {
  const cleaned: Snapshot = {};
  for (const [filePath, entries] of Object.entries(files)) {
    if (entries.length) cleaned[filePath] = entries;
  }
  const hashes: Record<string, string> = {};
  for (const filePath of Object.keys(cleaned)) {
    if (filePath in contentHashes) hashes[filePath] = contentHashes[filePath];
  }
  atomicWriteJson(snapshotPath(projectRoot), {
    version: VERSION,
    updated_at: new Date().toISOString(),
    content_hashes: hashes,
    files: cleaned,
  });
}

function groupByFile(diagnostics: Iterable<Diagnostic>): Snapshot {
  const grouped: Snapshot = {};
  for (const diagnostic of diagnostics) (grouped[diagnostic.file] ??= []).push(diagnostic);
  return grouped;
}

/** Overwrite the whole snapshot from a full project build. */
export function replaceAll(projectRoot: string, diagnostics: Iterable<Diagnostic>, contentHashes: Record<string, string> = {}): Snapshot {
  const files = groupByFile(diagnostics);
  writeSnapshot(projectRoot, files, { ...contentHashes });
  return files;
}

/**
 * Overwrite the entries of `filesInScope` (plus any file the new diagnostics
 * mention); everything else keeps its previous entries and hashes.
 */
export function replaceFiles(
  projectRoot: string,
  filesInScope: Iterable<string>,
  diagnostics: Iterable<Diagnostic>,
  contentHashes: Record<string, string> = {},
): Snapshot {
  const { files: existing, hashes: existingHashes } = readSnapshotPayload(projectRoot);
  const fresh = groupByFile(diagnostics);
  const inScope = new Set([...filesInScope, ...Object.keys(fresh)]);
  const merged: Snapshot = {};
  const mergedHashes: Record<string, string> = {};
  for (const [filePath, entries] of Object.entries(existing)) {
    if (inScope.has(filePath)) continue;
    merged[filePath] = entries;
    if (filePath in existingHashes) mergedHashes[filePath] = existingHashes[filePath];
  }
  for (const filePath of inScope) merged[filePath] = fresh[filePath] ?? [];
  Object.assign(mergedHashes, contentHashes);
  writeSnapshot(projectRoot, merged, mergedHashes);
  return merged;
}

export function replaceSingleFile(projectRoot: string, filePath: string, diagnostics: Iterable<Diagnostic>, contentHashes: Record<string, string> = {}): Snapshot {
  return replaceFiles(projectRoot, [filePath], diagnostics, contentHashes);
}

/**
 * Snapshot entries for one file from an LSP result: errors and warnings only
 * (hints/infos never drive badges), plus a synthetic line-1 error naming the
 * imports that failed to build so a file broken by its imports is not clean.
 */
export function lspSnapshotDiagnostics(filePath: string, items: Iterable<DiagnosticLike>, failedDependencies: Iterable<string> = []): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const item of items) {
    if (item.severity !== 'error' && item.severity !== 'warning') continue;
    diagnostics.push({ file: filePath, line: item.line, column: item.column, severity: item.severity, message: item.message });
  }
  const failed = [...failedDependencies];
  if (failed.length) {
    diagnostics.push({ file: filePath, line: 1, column: 1, severity: 'error', message: FAILED_DEPENDENCIES_PREFIX + failed.join(', ') });
  }
  return diagnostics;
}

function isSyntheticDependencyError(diagnostic: Diagnostic): boolean {
  return diagnostic.severity === 'error' && diagnostic.line === 1 && diagnostic.column === 1 && diagnostic.message.startsWith(FAILED_DEPENDENCIES_PREFIX);
}

/**
 * Record current dependency failures without discarding the file's last
 * hash-attested verdict; replaces any older synthetic dependency error.
 */
export function mergeFailedDependencies(projectRoot: string, filePath: string, failedDependencies: Iterable<string>, contentHash: string): Snapshot {
  const dependencies = [...failedDependencies];
  if (!dependencies.length) return readSnapshot(projectRoot);
  const existing = readMatchingFileDiagnostics(projectRoot, filePath) ?? [];
  const preserved = existing.filter((diagnostic) => !isSyntheticDependencyError(diagnostic));
  return replaceSingleFile(projectRoot, filePath, [...preserved, ...lspSnapshotDiagnostics(filePath, [], dependencies)], { [filePath]: contentHash });
}

export function clearSnapshot(projectRoot: string): void {
  try {
    unlinkSync(snapshotPath(projectRoot));
  } catch {
    // Already absent.
  }
}

/** `{file: {errors, warnings}}` for the wire; files with 0/0 are omitted. */
export function snapshotCounts(snapshot: Snapshot): Record<string, FileCounts> {
  const counts: Record<string, FileCounts> = {};
  for (const [filePath, entries] of Object.entries(snapshot)) {
    if (!entries.length) continue;
    const errors = entries.filter((entry) => entry.severity === 'error').length;
    const warnings = entries.filter((entry) => entry.severity === 'warning').length;
    if (errors === 0 && warnings === 0) continue;
    counts[filePath] = { errors, warnings };
  }
  return counts;
}

/** Re-key project-relative counts to repo-relative paths for the file tree. */
export function repoRelativeCounts(counts: Record<string, FileCounts>, projectSubdir: string): Record<string, FileCounts> {
  if (!projectSubdir) return counts;
  const prefixed: Record<string, FileCounts> = {};
  for (const [filePath, value] of Object.entries(counts)) prefixed[`${projectSubdir}/${filePath}`] = value;
  return prefixed;
}

/** True when the lakefile the build needs exists at the project root. */
export function hasLakefile(projectRoot: string): boolean {
  return existsSync(join(projectRoot, 'lakefile.lean')) || existsSync(join(projectRoot, 'lakefile.toml'));
}

/** Whether a path is a directory, following symlinks (false on any error). */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
