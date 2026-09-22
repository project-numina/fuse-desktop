import type { ChapterDescriptor } from '@/features/blueprint/hooks/chapter';
import { renderMath, type ReferenceDict, type StatusDict } from '@/lib/render-math';
import type { MacroDict } from '@/lib/latex-macros';

import type { BlueprintEntry, HomeModeBlueprint } from '../HomeMode';

export const SOURCE_HAS_HEADING_RE = /(?:^|\n)\s*\\(?:chapter|section)\b/;

export function resolveHomeEntries(
  blueprint: HomeModeBlueprint,
  entries: BlueprintEntry[] | undefined,
  hasMultipleChapters: boolean,
  activeChapterPath: string,
): BlueprintEntry[] {
  const local = entries ?? [];
  const server = blueprint.entries ?? [];
  if (!hasMultipleChapters || local.length === 0) return server.length > 0 ? server : local;
  const overrides = new Map(
    local.map((entry) => [entry.label, { ...entry, source_file: activeChapterPath }]),
  );
  const merged = server.map((entry) => {
    const file = entry.source_file || entry.sourceFile || '';
    return file === activeChapterPath && overrides.has(entry.label)
      ? overrides.get(entry.label)!
      : entry;
  });
  const serverLabels = new Set(server.map((entry) => entry.label));
  for (const entry of local) {
    if (!serverLabels.has(entry.label)) merged.push({ ...entry, source_file: activeChapterPath });
  }
  return merged;
}

export function entriesGroupedByChapter(entries: BlueprintEntry[]) {
  const buckets = new Map<string, BlueprintEntry[]>();
  for (const entry of entries) {
    const path = entry.source_file || entry.sourceFile || '';
    const bucket = buckets.get(path) ?? [];
    bucket.push(entry);
    buckets.set(path, bucket);
  }
  return buckets;
}

export function buildDeclarationReferences(
  entries: BlueprintEntry[],
  chapters: ChapterDescriptor[] | undefined,
  hasMultipleChapters: boolean,
): ReferenceDict {
  const result: ReferenceDict = {};
  if (!hasMultipleChapters || !chapters?.length) {
    entries.forEach((entry, index) => {
      if (entry.label) result[entry.label] = { kind: entry.kind, number: `1.${index + 1}` };
    });
    return result;
  }
  const byFile = new Map<string, BlueprintEntry[]>();
  for (const entry of entries) {
    const file = entry.source_file || entry.sourceFile || '';
    if (!file || !entry.label) continue;
    const bucket = byFile.get(file) ?? [];
    bucket.push(entry);
    byFile.set(file, bucket);
  }
  chapters.forEach((chapter, index) => {
    const section = index > 0 ? index : 1;
    (byFile.get(chapter.path) ?? []).forEach((entry, item) => {
      result[entry.label] = { kind: entry.kind, number: `${section}.${item + 1}` };
    });
  });
  return result;
}

export function buildChapterSources(
  blueprint: HomeModeBlueprint,
  chapters: ChapterDescriptor[] | undefined,
  activeChapterPath: string,
  activeChapterSource: string,
) {
  if (!chapters?.length) {
    return [{ path: activeChapterPath, source: activeChapterSource, sectionNumber: 1 }];
  }
  return chapters.map((chapter, index) => ({
    path: chapter.path,
    sectionNumber: index > 0 ? index : 1,
    source: chapter.path === activeChapterPath
      ? activeChapterSource
      : blueprint.chapter_contents?.[chapter.path]
        ?? (chapter.isEntrypoint ? blueprint.blueprint_content ?? '' : ''),
  }));
}

export function buildLeanTargets(entries: BlueprintEntry[] | undefined) {
  const targets = new Map<string, { file: string; line: number }>();
  for (const entry of entries ?? []) {
    const file = entry.lean_file || entry.leanFile || '';
    if (entry.label && file) {
      targets.set(entry.label, { file, line: entry.lean_line ?? entry.leanLine ?? 0 });
    }
  }
  return targets;
}

export function renderChapterBody({
  source,
  macros,
  statuses,
  references,
  linkedLeanLabels,
  activeChapterFile,
  sourceHasOwnHeading,
}: {
  source: string;
  macros: MacroDict;
  statuses: StatusDict;
  references: ReferenceDict;
  linkedLeanLabels: Set<string>;
  activeChapterFile: string;
  sourceHasOwnHeading: boolean;
}): string {
  const html = renderMath(source, macros, statuses, references, linkedLeanLabels);
  if (!activeChapterFile || !sourceHasOwnHeading) return html;
  const safeFile = activeChapterFile.replace(
    /[&<>]/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character] ?? character,
  );
  return html.replace(/<\/h[1-6]>/, (closingTag) =>
    `${closingTag}<p class="doc-chapter-file">${safeFile}</p>`);
}
