/** Chapter selection state for multi-file (imported) leanblueprints. */

import { useMemo } from 'react';

import {
  useLoadChapter,
  useSaveActiveChapter,
  useSyncActiveFromBlueprint,
} from './actions';
import {
  computeChapters,
  type BlueprintChapterContext,
  type BlueprintChapterPayload,
} from './model';
import {
  useChapterRefs,
  useChapterSelectionLifecycle,
  useChapterViewState,
} from './state';

export { commonDirectoryPrefix, deriveChapterLabel } from './model';
export type { ChapterDescriptor } from './model';

interface ChapterOptions {
  /** Disable authenticated fallback fetches on the public read-only share. */
  allowFetch?: boolean;
}

function exposedChapterState(
  chapters: ReturnType<typeof computeChapters>,
  view: ReturnType<typeof useChapterViewState>,
  loadChapter: ReturnType<typeof useLoadChapter>,
  saveActiveChapter: ReturnType<typeof useSaveActiveChapter>,
  syncActiveFromBlueprint: ReturnType<typeof useSyncActiveFromBlueprint>,
) {
  return {
    chapters,
    hasMultipleChapters: chapters.length > 1,
    activeChapterPath: view.activeChapterPath,
    chapterContent: view.chapterContent,
    setChapterContent: view.setChapterContent,
    loadError: view.loadError,
    isLoading: view.isLoading,
    isSaving: view.isSaving,
    restoredFromStorage: view.restoredFromStorage,
    userNavigated: view.userNavigated,
    markUserNavigated: view.markUserNavigated,
    loadChapter,
    saveActiveChapter,
    syncActiveFromBlueprint,
  };
}

export function useChapter(
  blueprint: BlueprintChapterPayload | null,
  context: BlueprintChapterContext,
  options: ChapterOptions = {},
) {
  const chapters = useMemo(() => computeChapters(blueprint), [blueprint]);
  const view = useChapterViewState();
  const refs = useChapterRefs(blueprint, chapters, view.activeChapterPath);
  const actionOptions = {
    ...context,
    allowFetch: options.allowFetch ?? true,
    refs,
    view,
  };
  const loadChapter = useLoadChapter(actionOptions);
  const saveActiveChapter = useSaveActiveChapter(actionOptions);
  const syncActiveFromBlueprint = useSyncActiveFromBlueprint(
    refs.blueprintRef,
    refs.activeChapterPathRef,
    view.setChapterContent,
  );
  useChapterSelectionLifecycle(blueprint, refs, view, loadChapter);
  return exposedChapterState(
    chapters, view, loadChapter, saveActiveChapter, syncActiveFromBlueprint,
  );
}
