/**
 * Pure helpers for the Blueprint workspace page.
 *
 * Mode-name mapping, SSE payload parsing, and Lean build/OCR phase
 * normalization extracted from the Blueprint page so they can be unit
 * tested in isolation and reused by the page's hooks.
 */

import { parseSseEventData } from '@/lib/sse';

// Keep SSE parsing on the blueprint-helper public surface used by the page and
// event hook.
export { parseSseEventData };

/** Status the sidebar build dot reflects; no "failed" at the build level. */
export type BlueprintBuildStatus = 'running' | 'done' | null;

/** Status the sidebar OCR dot reflects. */
export type BlueprintOcrStatus = 'scanning' | 'complete' | 'failed' | null;

/** Per-file build error counts keyed by clone-relative path. */
export type BuildErrorCounts = Record<string, { errors: number; warnings: number }>;

// Map URL-friendly mode names to internal mode names.
export const URL_TO_MODE: Record<string, string> = {
  home: 'home',
  blueprint: 'edit',
  graph: 'graph',
  source: 'view', // Legacy source links open imported references in Files.
  files: 'view',
  lean: 'view',
  git: 'git',
  history: 'history',
  agents: 'history',
  settings: 'settings',
};

// Map internal mode names back to URL-friendly mode names.
export const MODE_TO_URL: Record<string, string> = {
  home: 'home',
  edit: 'blueprint',
  graph: 'graph',
  source: 'files',
  view: 'files',
  git: 'git',
  history: 'history',
  settings: 'settings',
};

/** Browsing other documents/projects must not start the selected project's LSP. */
export function isProjectLeanFile(path: string | null, projectDirectory: string | undefined): boolean {
  return !!path?.endsWith('.lean') && typeof projectDirectory === 'string'
    && (!projectDirectory || path.startsWith(`${projectDirectory}/`));
}

/** Build a workspace-mode URL without dropping durable query state such as `?chat=`. */
export function blueprintModeUrl(
  baseUrl: string,
  target: string,
  search = '',
  segment?: string | null,
): string {
  const urlMode = MODE_TO_URL[target] || target;
  const modePath = urlMode === 'home' ? baseUrl : `${baseUrl}/${urlMode}`;
  const pathname = segment ? `${modePath}/${segment.split('/').map(encodeURIComponent).join('/')}` : modePath;
  if (!search) return pathname;
  return `${pathname}${search.startsWith('?') ? search : `?${search}`}`;
}

/** Render a blueprint slug as a human-readable label (`-` -> space). */
export function formatBlueprintLabel(value: string): string {
  return value.replace(/-/g, ' ');
}

/** Extract a file path from a Write/Edit/MultiEdit tool-call input. */
export function getLeanToolPath(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const candidate = (input as { file_path?: unknown; path?: unknown }).file_path
    ?? (input as { path?: unknown }).path;
  return typeof candidate === 'string' ? candidate : null;
}

/**
 * Chat tool names whose calls mean the agent wrote a file. The web trio come
 * from the Claude harness; ``FileChange`` is the desktop Codex adapter's
 * batched edit item (``input.changes = [{ path, kind }]``).
 */
export const FILE_WRITE_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit', 'MultiEdit', 'FileChange']);

/**
 * Extract every file path a file-writing tool call targets: the single
 * ``file_path``/``path`` of a Write/Edit/MultiEdit input, or each
 * ``changes[].path`` of a Codex ``FileChange`` input.
 */
export function getLeanToolPaths(input: unknown): string[] {
  const single = getLeanToolPath(input);
  if (single) return [single];
  if (!input || typeof input !== 'object') return [];
  const changes = (input as { changes?: unknown }).changes;
  if (!Array.isArray(changes)) return [];
  const paths: string[] = [];
  for (const change of changes) {
    if (!change || typeof change !== 'object') continue;
    const path = (change as { path?: unknown }).path;
    if (typeof path === 'string' && path) paths.push(path);
  }
  return paths;
}

/**
 * Whether a chat ``tool_call`` payload announces an edit to a Lean source
 * file the workspace shows (``.lean`` outside the blueprint's ``.metadata/``).
 */
export function isLeanFileWriteToolCall(tool: unknown, input: unknown): boolean {
  if (typeof tool !== 'string' || !FILE_WRITE_TOOLS.has(tool)) return false;
  return getLeanToolPaths(input).some(
    (filePath) => filePath.endsWith('.lean') && !filePath.includes('.metadata/'),
  );
}

/**
 * Normalize a backend build phase into the sidebar build status.
 *
 * Mirrors `BuildState.apply` on the backend: terminal phases pin the
 * status to `done`, anything else means a build is in progress.
 * `null`/`undefined` leave the current status untouched.
 */
export function buildStatusForPhase(
  phase: string | null | undefined,
  current: BlueprintBuildStatus,
): BlueprintBuildStatus {
  if (phase === 'complete' || phase === 'up_to_date') return 'done';
  if (phase) return 'running';
  return current;
}

/**
 * Normalize a backend OCR phase into the sidebar OCR status.
 *
 * Unrecognized phases leave the current status untouched.
 */
export function ocrStatusForPhase(
  phase: string | null | undefined,
  current: BlueprintOcrStatus,
): BlueprintOcrStatus {
  if (phase === 'complete' || phase === 'scanning' || phase === 'failed') {
    return phase;
  }
  if (phase === 'starting') return 'scanning';
  // The backend emits `not_needed` when a scan is abandoned (e.g. the source
  // was deleted mid-run); clear the dot so it doesn't stick at scanning.
  if (phase === 'not_needed' || phase === 'not_started') return null;
  return current;
}
