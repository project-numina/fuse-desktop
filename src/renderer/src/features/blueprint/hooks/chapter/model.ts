/** Pure chapter metadata, payload, and persistence helpers. */

export interface ChapterDescriptor {
  path: string;
  label: string;
  /** Prose ``\chapter{...}`` title parsed by the backend, if any. */
  title?: string;
  isEntrypoint: boolean;
}

export interface BlueprintChapterPayload {
  id?: string;
  blueprint_file?: string;
  blueprint_content?: string;
  included_files?: string[];
  chapter_titles?: Record<string, string>;
  chapter_contents?: Record<string, string>;
}

export interface BlueprintChapterContext {
  owner: string;
  repo: string;
  blueprintId: string;
}

export function deriveChapterLabel(path: string, commonPrefix: string): string {
  if (commonPrefix && path.startsWith(commonPrefix)) {
    const remainder = path.slice(commonPrefix.length);
    if (remainder) return remainder;
  }
  const segments = path.split('/');
  return segments[segments.length - 1] || path;
}

export function commonDirectoryPrefix(paths: string[]): string {
  if (paths.length === 0) return '';
  const split = paths.map((path) => path.split('/'));
  const minLength = Math.min(...split.map((parts) => parts.length));
  const sharedSegments: string[] = [];
  for (let index = 0; index < minLength - 1; index += 1) {
    const segment = split[0][index];
    if (!split.every((parts) => parts[index] === segment)) break;
    sharedSegments.push(segment);
  }
  return sharedSegments.length > 0 ? `${sharedSegments.join('/')}/` : '';
}

function uniqueChapterPaths(blueprint: BlueprintChapterPayload | null): string[] {
  const entrypoint = blueprint?.blueprint_file ?? '';
  const paths = entrypoint ? [entrypoint] : [];
  const seen = new Set(paths);
  for (const path of blueprint?.included_files ?? []) {
    if (!path || seen.has(path)) continue;
    paths.push(path);
    seen.add(path);
  }
  return paths;
}

export function computeChapters(
  blueprint: BlueprintChapterPayload | null,
): ChapterDescriptor[] {
  const entrypoint = blueprint?.blueprint_file ?? '';
  const paths = uniqueChapterPaths(blueprint);
  const prefix = paths.length > 1 ? commonDirectoryPrefix(paths) : '';
  const titles = blueprint?.chapter_titles ?? {};
  return paths.map((path) => ({
    path,
    label: paths.length > 1
      ? deriveChapterLabel(path, prefix)
      : path.split('/').pop() || path,
    title: titles[path],
    isEntrypoint: path === entrypoint,
  }));
}

export function chapterContent(
  blueprint: BlueprintChapterPayload,
  path: string,
): string | undefined {
  if (path === (blueprint.blueprint_file ?? '')) return blueprint.blueprint_content ?? '';
  return blueprint.chapter_contents?.[path];
}

export function cacheChapterContent(
  blueprint: BlueprintChapterPayload,
  path: string,
  content: string,
): void {
  if (path === blueprint.blueprint_file) {
    blueprint.blueprint_content = content;
  } else if (blueprint.chapter_contents) {
    blueprint.chapter_contents[path] = content;
  } else {
    blueprint.chapter_contents = { [path]: content };
  }
}

const ACTIVE_CHAPTER_STORAGE_PREFIX = 'numina-fuse:active-chapter:';

function activeChapterStorageKey(blueprintId: string): string {
  return `${ACTIVE_CHAPTER_STORAGE_PREFIX}${blueprintId}`;
}

export function readPersistedActiveChapter(blueprintId: string): string | null {
  if (!blueprintId) return null;
  try {
    return localStorage.getItem(activeChapterStorageKey(blueprintId));
  } catch {
    return null;
  }
}

export function writePersistedActiveChapter(blueprintId: string, path: string): void {
  if (!blueprintId || !path) return;
  try {
    localStorage.setItem(activeChapterStorageKey(blueprintId), path);
  } catch {
    // Persistence is a UX nicety and may be unavailable in private mode.
  }
}
