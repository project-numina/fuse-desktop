/**
 * Blueprint content and per-chapter read/write against the repository
 * folder, with the path validation the `/content` and `/chapter` routes rely
 * on. Errors are thrown as `HttpError` with the web's status mapping
 * (service `ValueError` messages: "not found" → 404, "invalid"/"not part" →
 * 400, anything else → 409) so the routes can propagate them unchanged.
 *
 * Writes are byte-for-byte what the caller sends: nothing is rewritten,
 * labels are whatever the user typed. Stability of the declaration rows
 * across edits comes from the parser refresh keying rows by label.
 */

import { statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { HttpError } from '../../server/errors';
import type { OpenProject } from '../types';
import { loadModel, type BlueprintModel } from './model';
import { resolvesUnder } from './latex/project';
import { readUtf8Text, universalNewlines } from './lean-files';
import { collectBlueprintIncludedFiles } from './metadata';
import { blueprintTexFileFor, blueprintTexRelativeFor, clonePathOf, safeBlueprintFilePath } from './paths';

const BLUEPRINT_NAME_PATTERN = /^[a-z0-9-]+$/;

/** Build the edit context for an open project from its row and model. */
export function editContextFor(project: OpenProject, model: Pick<BlueprintModel, 'includedFiles'>): BlueprintEditContext {
  return {
    clonePath: project.clonePath,
    blueprintFile: project.blueprintFile ?? project.blueprint.blueprint_file ?? null,
    includedFiles: [...model.includedFiles],
    projectSubdir: project.projectSubdir ?? project.blueprint.project_subdir ?? '',
  };
}

/** Either calling convention: an explicit context, or the open project (its cached include list comes from the persisted model). */
export type EditTarget = BlueprintEditContext | OpenProject;

function toContext(target: EditTarget): BlueprintEditContext {
  if ('repository' in target && 'blueprint' in target) return editContextFor(target, loadModel(target.projectRoot));
  return target;
}

/** What the edit paths need to know about the open workspace. */
export interface BlueprintEditContext {
  /** Absolute path of the repository folder. */
  clonePath: string;
  /** Stored repo-relative entrypoint, or null for a Fuse-drafted blueprint. */
  blueprintFile: string | null;
  /** Cached include list from the model (may be stale or empty). */
  includedFiles: string[];
  /** Repo-relative Lean project directory ('' = repository root). */
  projectSubdir: string;
}

/** The web's `ValueError` → HTTP status mapping for chapter/content services. */
export function editErrorStatus(message: string): number {
  const lowered = message.toLowerCase();
  if (lowered.includes('not found')) return 404;
  if (lowered.includes('invalid') || lowered.includes('not part')) return 400;
  return 409;
}

function editError(message: string): HttpError {
  const status = editErrorStatus(message);
  return new HttpError(status, message, `http_${status}`);
}

/** Reject names that could not have been produced by blueprint creation. */
export function validateBlueprintName(name: string): void {
  if (!BLUEPRINT_NAME_PATTERN.test(name)) throw editError('Invalid blueprint name');
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function writeText(path: string, content: string): void {
  try {
    writeFileSync(path, content, 'utf8');
  } catch (error) {
    console.warn(`[blueprint] Failed to write ${path}:`, error);
    throw new HttpError(500, 'Failed to save blueprint edit.', 'http_500');
  }
}

/**
 * Persist a LaTeX edit to the blueprint entrypoint. The target comes from
 * the stored `blueprintFile` (so imported leanblueprints write to the user's
 * path, not the default layout) or, for a new draft, the default write
 * location.
 */
export async function updateBlueprintContent(target: EditTarget, name: string, latexSource: string): Promise<void> {
  validateBlueprintName(name);
  const context = toContext(target);
  const texFile = blueprintTexFileFor(context.clonePath, name, context.blueprintFile, context.projectSubdir);
  if (!resolvesUnder(texFile, context.clonePath)) throw editError('Invalid blueprint name');
  // The parent must already exist: scaffolding a new blueprint is the
  // create-blueprint route's job, not a side effect of a content save.
  if (!isDirectory(dirname(texFile))) throw editError('Blueprint not found in clone');
  writeText(texFile, latexSource);
}

/**
 * Resolve a chapter file path against the blueprint's included files.
 * Returns `[absolutePath, safePath]`. Throws when the path is malformed,
 * escapes the clone, or is not in the blueprint's reachable `\input` /
 * `\include` chain — the allowlist prevents reads or writes against
 * arbitrary repository files via the chapter endpoint.
 */
export function validateChapterPath(target: EditTarget, name: string, rawPath: string): [string, string] {
  validateBlueprintName(name);
  const context = toContext(target);
  const safePath = safeBlueprintFilePath(rawPath);
  if (safePath === null) throw editError('Invalid chapter path');

  const entrypoint = blueprintTexRelativeFor(context.clonePath, name, context.blueprintFile, context.projectSubdir);

  // Always allow the entrypoint so this endpoint is a unified read/write path.
  const allowed = new Set<string>([entrypoint]);
  for (const raw of context.includedFiles) {
    const cachedSafe = safeBlueprintFilePath(raw);
    if (cachedSafe !== null) allowed.add(cachedSafe);
  }
  if (!allowed.has(safePath)) {
    // Fall back to a live walk so freshly imported blueprints (whose model
    // has not been refreshed yet) are still editable.
    const texFile = blueprintTexFileFor(context.clonePath, name, context.blueprintFile, context.projectSubdir);
    const liveFiles = collectBlueprintIncludedFiles(texFile, context.clonePath);
    if (!liveFiles.includes(safePath)) throw editError('Chapter not part of this blueprint');
  }

  const chapterFile = clonePathOf(context.clonePath, safePath);
  if (!resolvesUnder(chapterFile, context.clonePath)) throw editError('Invalid chapter path');
  return [chapterFile, safePath];
}

/** Whether `content` exactly matches the entrypoint file (an unreadable entrypoint disables the guard). */
function chapterContentMatchesEntrypoint(
  clonePath: string,
  entrypoint: string,
  content: string,
  blueprintName: string,
  chapterPath: string,
): boolean {
  const entrypointFile = clonePathOf(clonePath, entrypoint);
  if (!(resolvesUnder(entrypointFile, clonePath) && isFile(entrypointFile))) return false;
  const entrypointContent = readUtf8Text(entrypointFile);
  if (entrypointContent === null) {
    console.warn(
      `[blueprint] Could not read blueprint entrypoint while guarding chapter save: blueprint=${blueprintName} chapter=${chapterPath} entrypoint=${entrypoint}`,
    );
    return false;
  }
  return universalNewlines(entrypointContent) === content;
}

/** The raw `.tex` content of a chapter file (universal newlines, like the served payload). */
export async function readChapterContent(target: EditTarget, name: string, chapterPath: string): Promise<string> {
  const [chapterFile] = validateChapterPath(target, name, chapterPath);
  if (!isFile(chapterFile)) throw editError('Chapter not found in clone');
  const text = readUtf8Text(chapterFile);
  if (text === null) throw editError('Chapter not found in clone');
  return universalNewlines(text);
}

/**
 * Persist a per-chapter LaTeX edit and return the repo-relative path. A
 * body chapter is never overwritten with the entrypoint's exact content:
 * that shape is a mis-targeted client save, not an edit.
 */
export async function updateChapterContent(target: EditTarget, name: string, chapterPath: string, content: string): Promise<string> {
  const context = toContext(target);
  const [chapterFile, safePath] = validateChapterPath(context, name, chapterPath);
  if (!isDirectory(dirname(chapterFile))) throw editError('Chapter not found in clone');
  const entrypoint = blueprintTexRelativeFor(context.clonePath, name, context.blueprintFile, context.projectSubdir);
  if (safePath !== entrypoint && chapterContentMatchesEntrypoint(context.clonePath, entrypoint, content, name, safePath)) {
    console.warn(`[blueprint] Rejected chapter save whose content matches the entrypoint: blueprint=${name} chapter=${safePath} entrypoint=${entrypoint}`);
    throw editError('Refusing to overwrite chapter with entrypoint content');
  }
  writeText(chapterFile, content);
  return safePath;
}
