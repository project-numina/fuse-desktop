import { useEffect, useMemo, useRef } from 'react';

import { useStatus } from '@/hooks/use-status';
import { EMPTY_MACROS } from '@/lib/latex-macros';
import { buildDocumentReferences } from '@/lib/render-math/document-refs';
import type { ReferenceDict, StatusDict } from '@/lib/render-math';

import type { HomeModeProps } from '../HomeMode';
import {
  buildChapterSources,
  buildDeclarationReferences,
  buildLeanTargets,
  entriesGroupedByChapter,
  renderChapterBody,
  resolveHomeEntries,
  SOURCE_HAS_HEADING_RE,
} from './home-document-model';

export function useHomeDocument(props: HomeModeProps) {
  const {
    blueprint, entries, hasMultipleChapters = false, chapters,
    activeChapterPath = '', chapterContent, onOpenLeanFile, onAutoSelectChapter,
    restoredFromStorage = false, userNavigated = false,
  } = props;
  const { statusOf } = useStatus();
  const resolvedEntries = useMemo(() => resolveHomeEntries(
    blueprint, entries, hasMultipleChapters, activeChapterPath,
  ), [blueprint, entries, hasMultipleChapters, activeChapterPath]);
  const statuses = useMemo<StatusDict>(() => {
    const result: StatusDict = {};
    for (const entry of resolvedEntries) {
      if (entry.label) result[entry.label] = {
        status: statusOf(entry.label, resolvedEntries), kind: entry.kind,
      };
    }
    return result;
  }, [resolvedEntries, statusOf]);
  const entriesByChapter = useMemo(
    () => entriesGroupedByChapter(resolvedEntries),
    [resolvedEntries],
  );
  const autoAdvancedRef = useRef(false);
  useEffect(() => {
    if (!hasMultipleChapters || autoAdvancedRef.current) return;
    if (restoredFromStorage || userNavigated) {
      autoAdvancedRef.current = true;
      return;
    }
    if (entriesByChapter.size === 0) return;
    autoAdvancedRef.current = true;
    if ((entriesByChapter.get(activeChapterPath) ?? []).length > 0) return;
    const target = chapters?.find(
      (chapter) => (entriesByChapter.get(chapter.path) ?? []).length > 0,
    );
    if (target) onAutoSelectChapter?.(target.path);
  }, [
    hasMultipleChapters, restoredFromStorage, userNavigated, entriesByChapter,
    activeChapterPath, chapters, onAutoSelectChapter,
  ]);

  const activeChapterSource = hasMultipleChapters
    ? chapterContent ?? ''
    : blueprint.blueprint_content ?? '';
  const activeChapterFile = hasMultipleChapters
    ? chapters?.find((chapter) => chapter.path === activeChapterPath)?.label ?? ''
    : '';
  const sectionNumber = useMemo(() => {
    if (!hasMultipleChapters) return 1;
    const index = chapters?.findIndex((chapter) => chapter.path === activeChapterPath) ?? -1;
    return index > 0 ? index : 1;
  }, [hasMultipleChapters, chapters, activeChapterPath]);
  const declarationReferences = useMemo(() => buildDeclarationReferences(
    blueprint.entries ?? [], chapters, hasMultipleChapters,
  ), [blueprint.entries, chapters, hasMultipleChapters]);
  const declarationLabelByNumber = useMemo(() => {
    const result = new Map<string, string>();
    for (const [label, target] of Object.entries(declarationReferences)) {
      if (typeof target === 'object') result.set(target.number, label);
    }
    return result;
  }, [declarationReferences]);
  const chapterSources = useMemo(() => buildChapterSources(
    blueprint, chapters, activeChapterPath, activeChapterSource,
  ), [blueprint, chapters, activeChapterPath, activeChapterSource]);
  const documentIndex = useMemo(() => buildDocumentReferences(chapterSources), [chapterSources]);
  const references = useMemo<ReferenceDict>(() => ({
    ...(blueprint.chapter_references ?? {}),
    ...documentIndex.references,
    ...declarationReferences,
  }), [blueprint.chapter_references, documentIndex.references, declarationReferences]);
  const leanTargetByLabel = useMemo(
    () => onOpenLeanFile ? buildLeanTargets(blueprint.entries) : new Map(),
    [blueprint.entries, onOpenLeanFile],
  );
  const sourceHasOwnHeading = SOURCE_HAS_HEADING_RE.test(activeChapterSource);
  const renderedBody = useMemo(() => renderChapterBody({
    source: activeChapterSource,
    macros: blueprint.latex_macros ?? EMPTY_MACROS,
    statuses,
    references,
    linkedLeanLabels: new Set(leanTargetByLabel.keys()),
    activeChapterFile,
    sourceHasOwnHeading,
  }), [
    activeChapterSource, blueprint.latex_macros, statuses, references,
    leanTargetByLabel, activeChapterFile, sourceHasOwnHeading,
  ]);

  return {
    isEmpty: resolvedEntries.length === 0,
    activeChapterSource,
    activeChapterFile,
    sectionNumber,
    declarationReferences,
    declarationLabelByNumber,
    documentIndex,
    leanTargetByLabel,
    sourceHasOwnHeading,
    renderedBody,
  };
}
