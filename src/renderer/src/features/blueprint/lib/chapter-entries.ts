/**
 * Pure helpers for assembling the set of declarations a chapter graph shows.
 *
 * GraphMode merges server-side entries (which cover every chapter) with the
 * local LaTeX parser's entries (only the active chapter, but reflecting
 * unsaved edits). For multi-chapter blueprints it then filters to the active
 * chapter — the global graph was unreadable past ~30 nodes and blurred the
 * per-chapter structure the user is reasoning about. Declarations referenced
 * via ``\uses`` that live in other chapters come back in as ghost nodes
 * (``isExternal: true``) so the reader can still see where the chapter's deps
 * go. Keeping the merge here makes the chapter-selection logic independently
 * testable.
 */

export interface ParsedEntry {
  kind: string;
  label: string;
  title: string;
  uses: string[];
  status: string;
  leanName: string;
  lean_name?: string;
  source_file?: string;
  sourceFile?: string;
  /** True when this node is a stub for a declaration that lives in a
      different chapter but is referenced by an in-chapter ``\uses``. */
  isExternal?: boolean;
}

export function entrySourceFile(entry: ParsedEntry): string {
  return entry.source_file || entry.sourceFile || '';
}

/**
 * Human-friendly label for a chapter in the picker dropdown.
 *
 * The entrypoint chapter shows as "Index"; otherwise prefer the parsed title,
 * falling back to the final path segment with any ``.tex`` suffix stripped.
 */
export function chapterMenuLabel(
  entry: { label: string; title?: string; isEntrypoint: boolean },
): string {
  if (entry.isEntrypoint) return 'Index';
  if (entry.title?.trim()) return entry.title.trim();
  const cleaned = entry.label.replace(/\.tex$/i, '');
  const slash = cleaned.lastIndexOf('/');
  return slash >= 0 ? cleaned.slice(slash + 1) : cleaned;
}

/**
 * The source file shown under a chapter's menu label, so a titled entry
 * reveals which .tex file it lives in. Untitled entries already use the
 * filename as their label and therefore need no secondary line.
 */
export function chapterMenuFile(
  entry: { label: string; title?: string; isEntrypoint: boolean },
): string {
  if (!entry.isEntrypoint && !entry.title?.trim()) return '';
  return entry.label;
}

/**
 * Returns the entries to render when the blueprint has only one chapter (or
 * no chapter context): the server set if it has anything, otherwise the
 * local parser's set.
 */
export function singleChapterEntries(
  local: ParsedEntry[],
  server: ParsedEntry[],
): ParsedEntry[] {
  return server.length > 0 ? server : local;
}

/**
 * Builds the entry set for the active chapter of a multi-chapter blueprint:
 * in-chapter declarations (local edits overriding server copies) plus
 * external ghost stubs for anything the chapter's ``\uses`` references but
 * that lives elsewhere.
 */
export function multiChapterEntries(
  local: ParsedEntry[],
  server: ParsedEntry[],
  activePath: string,
): ParsedEntry[] {
  const overrides = new Map<string, ParsedEntry>();
  for (const entry of local) {
    overrides.set(entry.label, { ...entry, source_file: activePath });
  }
  const chapterEntries: ParsedEntry[] = [];
  const inChapter = new Set<string>();
  for (const entry of server) {
    if (entrySourceFile(entry) !== activePath) continue;
    const merged = overrides.has(entry.label)
      ? overrides.get(entry.label)!
      : entry;
    chapterEntries.push(merged);
    inChapter.add(entry.label);
  }
  for (const entry of local) {
    if (!inChapter.has(entry.label) && !server.some(s => s.label === entry.label)) {
      chapterEntries.push({ ...entry, source_file: activePath });
      inChapter.add(entry.label);
    }
  }
  // Collect labels referenced by in-chapter declarations that live
  // outside the chapter. Their stubs render with a dotted outline.
  const externalLabels = new Set<string>();
  for (const entry of chapterEntries) {
    for (const dependency of entry.uses ?? []) {
      if (!inChapter.has(dependency)) externalLabels.add(dependency);
    }
  }
  const externalEntries: ParsedEntry[] = [];
  for (const label of externalLabels) {
    const source = server.find(entry => entry.label === label);
    if (!source) continue;
    externalEntries.push({
      ...source,
      // Stub out uses so the ghost node doesn't drag its own
      // dependencies into the chapter graph.
      uses: [],
      isExternal: true,
    });
  }
  return [...chapterEntries, ...externalEntries];
}
