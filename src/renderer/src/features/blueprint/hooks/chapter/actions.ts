/** Async loading, saving, and payload synchronization for chapter state. */

import { useCallback, type MutableRefObject } from 'react';

import { fetchBlueprintChapter, updateBlueprintChapter } from '@/lib/api';

import {
  cacheChapterContent,
  chapterContent,
  type BlueprintChapterContext,
  type BlueprintChapterPayload,
} from './model';
import type { ChapterRefs, ChapterViewState } from './state';

interface ChapterActionOptions extends BlueprintChapterContext {
  allowFetch: boolean;
  refs: ChapterRefs;
  view: ChapterViewState;
}

interface RemoteLoadOptions extends BlueprintChapterContext {
  path: string;
  requestId: number;
  fetchCounterRef: MutableRefObject<number>;
  setActiveChapterPath: ChapterViewState['setActiveChapterPath'];
  setChapterContent: ChapterViewState['setChapterContent'];
  setLoadError: ChapterViewState['setLoadError'];
  setIsLoading: ChapterViewState['setIsLoading'];
}

function applyChapter(
  view: Pick<
    ChapterViewState,
    'setActiveChapterPath' | 'setChapterContent' | 'setLoadError' | 'setIsLoading'
  >,
  path: string,
  content: string,
): void {
  view.setActiveChapterPath(path);
  view.setChapterContent(content);
  view.setLoadError(null);
  view.setIsLoading(false);
}

async function loadRemoteChapter(options: RemoteLoadOptions): Promise<boolean> {
  const {
    owner, repo, blueprintId, path, requestId, fetchCounterRef,
    setActiveChapterPath, setChapterContent, setLoadError, setIsLoading,
  } = options;
  setIsLoading(true);
  setLoadError(null);
  try {
    const response = await fetchBlueprintChapter(owner, repo, blueprintId, path);
    if (requestId !== fetchCounterRef.current) return false;
    setActiveChapterPath(path);
    setChapterContent(response.content);
    return true;
  } catch (error) {
    if (requestId !== fetchCounterRef.current) return false;
    setLoadError(error instanceof Error ? error.message : 'Could not load chapter.');
    return false;
  } finally {
    if (requestId === fetchCounterRef.current) setIsLoading(false);
  }
}

export function useLoadChapter(options: ChapterActionOptions) {
  const { owner, repo, blueprintId, allowFetch, refs, view } = options;
  const { blueprintRef, fetchCounterRef } = refs;
  const { setActiveChapterPath, setChapterContent, setLoadError, setIsLoading } = view;
  return useCallback(async (path: string): Promise<boolean> => {
    const blueprint = blueprintRef.current;
    if (!blueprint || !path) return false;
    const requestId = ++fetchCounterRef.current;
    const content = chapterContent(blueprint, path);
    if (content !== undefined) {
      applyChapter({ setActiveChapterPath, setChapterContent, setLoadError, setIsLoading }, path, content);
      return true;
    }
    if (!allowFetch) {
      applyChapter({ setActiveChapterPath, setChapterContent, setLoadError, setIsLoading }, path, '');
      return true;
    }
    return loadRemoteChapter({
      owner, repo, blueprintId, path, requestId,
      fetchCounterRef, setActiveChapterPath, setChapterContent, setLoadError, setIsLoading,
    });
  }, [
    allowFetch, blueprintId, blueprintRef, fetchCounterRef, owner, repo,
    setActiveChapterPath, setChapterContent, setIsLoading, setLoadError,
  ]);
}

export function useSaveActiveChapter(options: ChapterActionOptions) {
  const { owner, repo, blueprintId, refs, view } = options;
  const { activeChapterPathRef, blueprintRef } = refs;
  const { setIsSaving } = view;
  return useCallback(async (content: string, chapterPath?: string): Promise<void> => {
    const path = chapterPath ?? activeChapterPathRef.current;
    if (!path) return;
    setIsSaving(true);
    try {
      await updateBlueprintChapter(owner, repo, blueprintId, path, content);
      const blueprint = blueprintRef.current;
      if (blueprint) cacheChapterContent(blueprint, path, content);
    } finally {
      setIsSaving(false);
    }
  }, [activeChapterPathRef, blueprintId, blueprintRef, owner, repo, setIsSaving]);
}

export function useSyncActiveFromBlueprint(
  blueprintRef: MutableRefObject<BlueprintChapterPayload | null>,
  activeChapterPathRef: MutableRefObject<string>,
  setChapterContent: ChapterViewState['setChapterContent'],
) {
  return useCallback((): string | null => {
    const blueprint = blueprintRef.current;
    const path = activeChapterPathRef.current;
    if (!blueprint || !path) return null;
    const content = chapterContent(blueprint, path);
    if (content === undefined) return null;
    setChapterContent(content);
    return content;
  }, [activeChapterPathRef, blueprintRef, setChapterContent]);
}
