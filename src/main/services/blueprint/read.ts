/**
 * Assemble the `BlueprintResponse` the frontend consumes through
 * `fetchBlueprint`, from the repository folder and the per-workspace model.
 *
 * The web backend reads declaration rows from Postgres and only parses the
 * `.tex` on the first read; the desktop re-parses on every read (a few
 * milliseconds) so the entries always reflect the files on disk, while the
 * model keeps the agent-written columns alive across refreshes.
 *
 * The functions here are pure with respect to the app: paths and rows in,
 * data out. The blueprint service persists the model and the adopted
 * entrypoint, and supplies the source view and the branch information.
 */

import { existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { BlueprintBranchStatus, BlueprintEntry, BlueprintResponse, BranchFreshness, FileDiffStats } from '@shared/api-types';
import type { OpenProject } from '../types';
import { loadBlueprintMacros, loadChapterReferences, loadChapterTitles } from './latex/macros';
import {
  computeLeanFileDiffStats,
  diffStatsInProject,
  entryLeanFiles,
  filesInProject,
  inferLeanFilesFromClone,
  leanModuleToPath,
  leanProjectRoot,
  listAllLeanFiles,
  mergeLeanFileLists,
  readCloneFile,
  repoPathInProject,
  resolveDefaultCompareRef,
} from './lean-files';
import { cachedLeanLocation, readCachedLeanLocations } from './lean-locations';
import { collectBlueprintIncludedFiles, refreshBlueprintModel } from './metadata';
import { blueprintSettings, declarationToEntry, listDeclarations, loadModel, saveModel, type BlueprintModel } from './model';
import { blueprintTexFileFor, clonePathOf, resolveExistingEntrypoint, safeBlueprintFilePath } from './paths';

// ── Read models (immutable) ────────────────────────────────────────────────

/** Resolved blueprint entrypoint and its contents. */
export interface BlueprintDocument {
  readonly path: string;
  readonly content: string;
}

/** Source material displayed alongside a blueprint. */
export interface BlueprintSource {
  readonly content: string;
  readonly sourceType: string;
  readonly fileUrl: string;
  readonly pdfUrl: string;
}

/** Lean files and change statistics shown for a blueprint. */
export interface LeanFileView {
  readonly associated: string[];
  readonly allFiles: string[];
  readonly diffStats: Record<string, FileDiffStats>;
}

/** Chapter navigation and presentation data. */
export interface ChapterView {
  readonly includedFiles: string[];
  readonly latexMacros: Record<string, string>;
  readonly titles: Record<string, string>;
  readonly references: Record<string, string>;
  readonly contents: Record<string, string>;
}

/** The canonical source view the sources service hands the read path (snake_case, as it is served). */
export interface RepositorySourceView {
  readonly source_content: string;
  readonly source_type: string;
  readonly source_file_url: string;
  readonly source_pdf_url: string;
}

export interface BlueprintReadOptions {
  /** Re-parse the `.tex` into the model before assembling (default true). */
  refresh?: boolean;
  /** Source view from the sources service; null or absent → legacy on-disk fallback. */
  source?: RepositorySourceView | null;
  /** Live OCR phase ('scanning' | 'failed') of an in-flight session, if any. */
  livePhase?: string | null;
  branchFreshness?: BranchFreshness | null;
  branchStatus?: BlueprintBranchStatus | null;
}

// ── Small helpers ──────────────────────────────────────────────────────────

/**
 * The sidebar-facing OCR phase. A live `scanning`/`failed` phase wins so an
 * in-flight session is reflected immediately; otherwise PDFs with
 * non-placeholder OCR content read as `complete`, everything else as ''.
 */
export function deriveOcrPhase(sourceType: string, sourceContent: string, livePhase: string | null | undefined): string {
  if (livePhase === 'scanning' || livePhase === 'failed') return livePhase;
  if (sourceType !== 'pdf') return '';
  if (!sourceContent || sourceContent.startsWith('% OCR pending')) return '';
  return 'complete';
}

/** `(source_file_path, source_pdf_path)` of the legacy on-disk source layout. */
export function resolveSourcePaths(name: string, sourceType: string): [string, string] {
  const directory = `numina/blueprints/${name}/source`;
  if (sourceType === 'pdf') return [`${directory}/${name}-source-ocr.tex`, `${directory}/${name}-source.pdf`];
  return [`${directory}/${name}-source.tex`, ''];
}

/** The API `source_type` for a stored row value ('' | 'latex' | 'pdf' | 'markdown'). */
export function apiSourceType(rowSourceType: string | null | undefined): string {
  if (!rowSourceType || rowSourceType === 'none') return '';
  if (rowSourceType === 'tex') return 'latex';
  return rowSourceType;
}

function encodePathSegments(path: string): string {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

/** Raw-file URL for a legacy blueprint's source PDF, served from the working tree. */
export function legacySourcePdfUrl(owner: string, repository: string, pdfPath: string): string {
  return `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/files-raw/${encodePathSegments(pdfPath)}`;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// ── Steps ──────────────────────────────────────────────────────────────────

/**
 * Resolve cached Lean locations and legacy `\leanfile` paths to
 * repo-relative paths. Exact declaration locations come from the post-build
 * Lean metadata cache (read once for all entries); an explicit `\leanfile{}`
 * remains a fallback, kept only when the file exists.
 */
export async function resolveEntryLeanFiles(entries: BlueprintEntry[], clonePath: string, blueprintFile: string | null): Promise<BlueprintEntry[]> {
  if (!entries.some((entry) => entry.lean_name || entry.lean_file)) return entries;
  const projectRoot = leanProjectRoot(clonePath, blueprintFile);
  let subdirectory = relative(resolve(clonePath), resolve(projectRoot)).split(sep).join('/');
  if (subdirectory.startsWith('..')) subdirectory = '';
  const prefix = subdirectory && subdirectory !== '.' ? `${subdirectory}/` : '';
  const cachedLocations = readCachedLeanLocations(projectRoot);
  return entries.map((entry) => {
    let leanFile = entry.lean_file;
    let leanLine = entry.lean_line;
    const [cachedFile, cachedLine] = entry.lean_name ? cachedLeanLocation(cachedLocations, entry.lean_name) : ['', 0];
    if (cachedFile) {
      const candidate = `${prefix}${cachedFile}`;
      if (isFile(clonePathOf(clonePath, candidate))) {
        leanFile = candidate;
        leanLine = cachedLine;
      }
    } else if (entry.lean_file && prefix && !entry.lean_file.startsWith(prefix)) {
      // Only link when the normalized path actually exists, so a stale or
      // typoed \leanfile{} does not render a link that opens an error page.
      const candidate = `${prefix}${entry.lean_file}`;
      leanFile = isFile(clonePathOf(clonePath, candidate)) ? candidate : '';
    } else if (entry.lean_file && !isFile(clonePathOf(clonePath, entry.lean_file))) {
      leanFile = '';
    }
    if (leanFile !== entry.lean_file || leanLine !== entry.lean_line) return { ...entry, lean_file: leanFile, lean_line: leanLine };
    return entry;
  });
}

/**
 * The chapter file list for a blueprint. Prefers the cached `includedFiles`
 * (cleaned, de-duplicated, entrypoint first) so reads stay cheap while
 * `.tex` files are mid-edit; falls back to a live walk when the cache is
 * empty.
 */
export function resolveIncludedFilesFromClone(
  clonePath: string,
  name: string,
  metadata: { includedFiles?: unknown; blueprintFile?: string | null },
  blueprintFilePath: string,
  projectSubdir = '',
): string[] {
  if (Array.isArray(metadata.includedFiles)) {
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const raw of metadata.includedFiles) {
      const safe = safeBlueprintFilePath(raw);
      if (safe === null || seen.has(safe)) continue;
      cleaned.push(safe);
      seen.add(safe);
    }
    if (cleaned.length) {
      if (cleaned[0] !== blueprintFilePath && !seen.has(blueprintFilePath)) cleaned.unshift(blueprintFilePath);
      return cleaned;
    }
  }
  const texFile = blueprintTexFileFor(clonePath, name, metadata.blueprintFile ?? null, projectSubdir);
  return collectBlueprintIncludedFiles(texFile, clonePath);
}

/** Merge declaration, branch, module, and repository Lean paths into `(associated, all_files)`. */
export function mergeCloneLeanFiles(
  entries: BlueprintEntry[],
  inferred: string[],
  repositoryFiles: string[],
  leanModule: string | null,
  projectSubdir: string,
): [string[], string[]] {
  const repositoryFileSet = new Set(repositoryFiles);
  // Drop declaration paths absent from the tree (e.g. Mathlib paths that live under .lake/).
  const entryFiles = entryLeanFiles(entries).filter((path) => repositoryFileSet.has(path));
  let associated = filesInProject(mergeLeanFileLists(entryFiles, inferred), projectSubdir);
  if (!associated.length && leanModule) {
    const modulePath = repoPathInProject(leanModuleToPath(leanModule), projectSubdir);
    if (repositoryFileSet.has(modulePath)) associated = [modulePath];
  }
  return [associated, mergeLeanFileLists(associated, repositoryFiles)];
}

/** Collect the clone-backed Lean file browser data. */
export async function cloneLeanFileView(
  clonePath: string,
  name: string,
  entries: BlueprintEntry[],
  leanModule: string | null,
  projectSubdir: string,
): Promise<LeanFileView> {
  // A worktree checkout keeps `.git` as a file, so accept either.
  const hasGit = existsSync(resolve(clonePath, '.git'));
  let inferred: string[] = [];
  let diffStats: Record<string, FileDiffStats> = {};
  // The tree walk overlaps the git subprocesses instead of following them.
  const walk = listAllLeanFiles(clonePath);
  if (hasGit) {
    const compareRef = await resolveDefaultCompareRef(clonePath);
    const [inferredPaths, rawDiffStats] = await Promise.all([
      inferLeanFilesFromClone(clonePath, name, compareRef),
      computeLeanFileDiffStats(clonePath, compareRef),
    ]);
    inferred = inferredPaths;
    diffStats = diffStatsInProject(rawDiffStats, projectSubdir);
  }
  const repositoryFiles = filesInProject(await walk, projectSubdir);
  const [associated, allFiles] = mergeCloneLeanFiles(entries, inferred, repositoryFiles, leanModule, projectSubdir);
  return { associated, allFiles, diffStats };
}

/** Load chapter navigation and presentation data (body files only). */
export function cloneChapterView(clonePath: string, document: BlueprintDocument, includedFiles: string[]): ChapterView {
  // The shared loaders hand the reader absolute paths; route them through
  // readCloneFile so containment and newline handling match the rest of
  // the payload ('' becomes null so an empty file counts as unreadable).
  // Contents, titles and references all want the same files, so each is
  // read once; the entrypoint was already read for `document`.
  const cache = new Map<string, string | null>();
  if (document.path) cache.set(document.path, document.content || null);
  const reader = (path: string): string | null => {
    const rel = isAbsolute(path) ? relative(resolve(clonePath), resolve(path)).split(sep).join('/') : path;
    if (!rel || rel.startsWith('..')) return null;
    const cached = cache.get(rel);
    if (cached !== undefined) return cached;
    const content = readCloneFile(clonePath, rel) || null;
    cache.set(rel, content);
    return content;
  };
  const macros = document.path ? loadBlueprintMacros(clonePath, document.path, reader) : {};
  const bodyPaths = includedFiles.filter((path) => path !== document.path);
  const contents: Record<string, string> = {};
  for (const path of bodyPaths) {
    const content = reader(path);
    if (content) contents[path] = content;
  }
  return {
    includedFiles,
    latexMacros: macros,
    titles: loadChapterTitles(clonePath, bodyPaths, reader),
    references: loadChapterReferences(clonePath, bodyPaths, reader),
    contents,
  };
}

/** Resolve and read the folder's blueprint entrypoint. */
export function resolveCloneDocument(clonePath: string, name: string, blueprintFile: string | null, projectSubdir: string): BlueprintDocument {
  const entrypoint = resolveExistingEntrypoint(clonePath, name, blueprintFile, projectSubdir);
  if (entrypoint === null) return { path: '', content: '' };
  return { path: entrypoint, content: readCloneFile(clonePath, entrypoint) };
}

/** Source material from the sources service, else the legacy on-disk layout. */
export function readCloneSource(
  clonePath: string,
  owner: string,
  repository: string,
  name: string,
  sourceType: string,
  stored: RepositorySourceView | null | undefined,
): BlueprintSource {
  if (stored && stored.source_type) {
    return { content: stored.source_content, sourceType: stored.source_type, fileUrl: stored.source_file_url, pdfUrl: stored.source_pdf_url };
  }
  const [sourcePath, pdfPath] = resolveSourcePaths(name, sourceType);
  const pdfUrl = sourceType === 'pdf' && pdfPath && isFile(clonePathOf(clonePath, pdfPath)) ? legacySourcePdfUrl(owner, repository, pdfPath) : '';
  return { content: readCloneFile(clonePath, sourcePath), sourceType, fileUrl: '', pdfUrl };
}

// ── Entry point ────────────────────────────────────────────────────────────

/**
 * Assemble the full blueprint detail payload for an open project. Refreshes
 * the model from the `.tex` first (unless `options.refresh === false`).
 *
 * With an explicit `model` the caller owns persistence (save it afterwards).
 * Without one — the one-argument form the blueprint service uses — the
 * model is loaded through `loadModel(project.projectRoot)`, refreshed, and
 * saved back, mirroring the web's parse-on-read commit.
 */
export async function getBlueprintFromClone(project: OpenProject, model?: BlueprintModel | null, options: BlueprintReadOptions = {}): Promise<BlueprintResponse> {
  const { repository, blueprint } = project;
  const name = blueprint.id;
  const clonePath = project.clonePath;
  const projectSubdir = project.projectSubdir ?? blueprint.project_subdir ?? '';
  const blueprintFile = project.blueprintFile ?? blueprint.blueprint_file ?? null;

  const ownsModel = !model;
  const store = model ?? loadModel(project.projectRoot);
  if (options.refresh !== false) {
    const refreshed = refreshBlueprintModel(store, clonePath, name, blueprintFile, projectSubdir);
    if (ownsModel && refreshed) saveModel(project.projectRoot, store);
  }

  const document = resolveCloneDocument(clonePath, name, blueprintFile, projectSubdir);
  const source = readCloneSource(clonePath, repository.owner, repository.name, name, apiSourceType(blueprint.source_type), options.source);
  let entries = listDeclarations(store).map(declarationToEntry);
  entries = await resolveEntryLeanFiles(entries, clonePath, document.path);
  const includedFiles = document.path
    ? resolveIncludedFilesFromClone(clonePath, name, { includedFiles: store.includedFiles, blueprintFile }, document.path, projectSubdir)
    : [];
  const leanFiles = await cloneLeanFileView(clonePath, name, entries, store.leanModule, projectSubdir);
  const chapters = cloneChapterView(clonePath, document, includedFiles);
  const { prMode, autoCommit } = blueprintSettings(blueprint);

  return {
    id: name,
    name: blueprint.title || name,
    description: blueprint.description ?? '',
    area: blueprint.area ?? '',
    entry_count: entries.length,
    updated_at: blueprint.updated_at ?? null,
    workspace_id: null,
    can_edit: true,
    runtime_route_tag: null,
    project_subdir: projectSubdir,
    blueprint_file: document.path,
    blueprint_content: document.content,
    source_content: source.content,
    source_type: source.sourceType,
    source_pdf_path: '',
    source_file_url: source.fileUrl,
    source_pdf_url: source.pdfUrl,
    ocr_phase: deriveOcrPhase(source.sourceType, source.content, options.livePhase),
    lean_files: leanFiles.associated,
    all_lean_files: leanFiles.allFiles,
    file_diff_stats: leanFiles.diffStats,
    entries,
    included_files: chapters.includedFiles,
    latex_macros: chapters.latexMacros,
    chapter_titles: chapters.titles,
    chapter_references: chapters.references,
    chapter_contents: chapters.contents,
    pr_mode: prMode,
    auto_commit: autoCommit,
    orchestrator_child_concurrency: blueprint.orchestrator_child_concurrency || 1,
    open_pr_number: null,
    branch_freshness: options.branchFreshness ?? null,
    branch_status: options.branchStatus ?? null,
    is_merged: false,
  };
}
