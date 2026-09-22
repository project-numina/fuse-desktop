import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import type { EditSaveState } from '@/features/blueprint/components/EditMode';
import type { SettingsUpdatedPayload } from '@/features/blueprint/components/SettingsMode';
import { useChapter } from '@/features/blueprint/hooks/chapter';
import { useLatexParser } from '@/features/blueprint/hooks/latex-parser';
import {
  multiChapterEntries,
  singleChapterEntries,
  type ParsedEntry,
} from '@/features/blueprint/lib/chapter-entries';

import type { BlueprintData, BlueprintRouteIdentity } from './blueprint-page-types';

export function useBlueprintEditing({
  route,
  blueprint,
  blueprintRef,
  setBlueprint,
}: {
  route: BlueprintRouteIdentity;
  blueprint: BlueprintData | null;
  blueprintRef: MutableRefObject<BlueprintData | null>;
  setBlueprint: Dispatch<SetStateAction<BlueprintData | null>>;
}) {
  const {
    latexSource,
    setLatexSource,
    parsedEntries,
    latexSegments,
    initFromBlueprint,
  } = useLatexParser(blueprint);
  const latexSourceRef = useRef(latexSource);
  latexSourceRef.current = latexSource;
  const chapter = useChapter(blueprint, route);
  const chapterRef = useRef(chapter);
  chapterRef.current = chapter;
  const [pendingSave, setPendingSave] = useState(false);
  const pendingSaveRef = useRef(false);
  pendingSaveRef.current = pendingSave;
  const editFlushRef = useRef<(() => Promise<boolean>) | null>(null);
  const cleanMarkerRef = useRef<((content: string) => void) | null>(null);
  const refreshAfterPendingSaveRef = useRef(false);
  const editSaveState = useMemo<EditSaveState>(() => ({
    setPending: setPendingSave,
    setFlush: (flush) => { editFlushRef.current = flush; },
    setCleanMarker: (marker) => { cleanMarkerRef.current = marker; },
  }), []);

  const markSourceClean = useCallback((content: string) => {
    cleanMarkerRef.current?.(content);
  }, []);
  const setSourceFromSavedContent = useCallback((content: string) => {
    if (latexSourceRef.current !== content) setLatexSource(content);
    markSourceClean(content);
  }, [setLatexSource, markSourceClean]);
  const [syncedSource, setSyncedSource] = useState<string | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [leanDirty, setLeanDirty] = useState(false);
  const markBlueprintSynced = useCallback(() => {
    setSyncedSource(latexSourceRef.current);
    setPendingSave(false);
    setSettingsDirty(false);
  }, []);

  const syncSourceFromActiveChapter = useCallback(async (): Promise<boolean> => {
    const current = chapterRef.current;
    const syncedContent = current.syncActiveFromBlueprint();
    if (syncedContent !== null) {
      setSourceFromSavedContent(syncedContent);
      return true;
    }
    const activePath = current.activeChapterPath;
    if (!activePath) {
      initFromBlueprint();
      markSourceClean(latexSourceRef.current);
      return true;
    }
    if (activePath === (blueprintRef.current?.blueprint_file ?? '')) return false;
    await current.loadChapter(activePath);
    if (chapterRef.current.activeChapterPath !== activePath) return false;
    setSourceFromSavedContent(chapterRef.current.chapterContent);
    return true;
  }, [blueprintRef, initFromBlueprint, markSourceClean, setSourceFromSavedContent]);

  const initializedRef = useRef(false);
  const initializeBlueprint = useCallback((
    target: BlueprintData,
    applyOcrPhase: (phase: string | null | undefined) => void,
  ) => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const active = chapter.syncActiveFromBlueprint();
    const content = active ?? target.blueprint_content ?? latexSourceRef.current;
    if (active === null && target.blueprint_content == null) initFromBlueprint();
    setLatexSource(content);
    markSourceClean(content);
    setSyncedSource(content);
    applyOcrPhase(target.ocr_phase);
  }, [chapter, initFromBlueprint, setLatexSource, markSourceClean]);

  const chapterContentMountRef = useRef(true);
  useEffect(() => {
    if (chapterContentMountRef.current) {
      chapterContentMountRef.current = false;
      return;
    }
    setSourceFromSavedContent(chapter.chapterContent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter.chapterContent]);

  const selectChapter = useCallback(async (path: string) => {
    const current = chapterRef.current;
    if (!path || path === current.activeChapterPath) return true;
    current.markUserNavigated();
    if (editFlushRef.current && !(await editFlushRef.current())) return false;
    try {
      return await current.loadChapter(path);
    } catch {
      return false;
    }
  }, []);

  const applySettingsUpdate = useCallback((update: SettingsUpdatedPayload) => {
    setSettingsDirty(false);
    setBlueprint((previous) => previous ? {
      ...previous,
      name: update.name,
      description: update.description,
      pr_mode: update.pr_mode,
      auto_commit: update.auto_commit,
      orchestrator_child_concurrency: update.orchestrator_child_concurrency,
      agent: update.agent ?? previous.agent,
    } : previous);
  }, [setBlueprint]);

  useEffect(() => () => { void editFlushRef.current?.(); }, []);
  const graphEntries = useMemo<ParsedEntry[]>(() => {
    const local = parsedEntries as unknown as ParsedEntry[];
    const server = (blueprint?.entries ?? []) as unknown as ParsedEntry[];
    return chapter.hasMultipleChapters
      ? multiChapterEntries(local, server, chapter.activeChapterPath)
      : singleChapterEntries(local, server);
  }, [parsedEntries, blueprint, chapter.hasMultipleChapters, chapter.activeChapterPath]);
  const hasUncommittedChanges = pendingSave || leanDirty || settingsDirty
    || (syncedSource !== null && latexSource !== syncedSource);

  return {
    latexSource,
    setLatexSource,
    parsedEntries,
    latexSegments,
    initFromBlueprint,
    chapter,
    pendingSave,
    pendingSaveRef,
    editFlushRef,
    refreshAfterPendingSaveRef,
    editSaveState,
    markBlueprintSynced,
    syncSourceFromActiveChapter,
    initializeBlueprint,
    selectChapter,
    applySettingsUpdate,
    setLeanDirty,
    graphEntries,
    hasUncommittedChanges,
  };
}
