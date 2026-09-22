/** React state and lifecycle effects for chapter selection. */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import {
  readPersistedActiveChapter,
  writePersistedActiveChapter,
  type BlueprintChapterPayload,
  type ChapterDescriptor,
} from './model';

export interface ChapterViewState {
  activeChapterPath: string;
  setActiveChapterPath: Dispatch<SetStateAction<string>>;
  chapterContent: string;
  setChapterContent: Dispatch<SetStateAction<string>>;
  loadError: string | null;
  setLoadError: Dispatch<SetStateAction<string | null>>;
  isLoading: boolean;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  isSaving: boolean;
  setIsSaving: Dispatch<SetStateAction<boolean>>;
  restoredFromStorage: boolean;
  setRestoredFromStorage: Dispatch<SetStateAction<boolean>>;
  userNavigated: boolean;
  markUserNavigated: () => void;
}

export interface ChapterRefs {
  blueprintRef: MutableRefObject<BlueprintChapterPayload | null>;
  chaptersRef: MutableRefObject<ChapterDescriptor[]>;
  activeChapterPathRef: MutableRefObject<string>;
  fetchCounterRef: MutableRefObject<number>;
}

export function useChapterViewState(): ChapterViewState {
  const [activeChapterPath, setActiveChapterPath] = useState('');
  const [chapterContent, setChapterContent] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [restoredFromStorage, setRestoredFromStorage] = useState(false);
  const [userNavigated, setUserNavigated] = useState(false);
  const markUserNavigated = useCallback(() => setUserNavigated(true), []);
  return {
    activeChapterPath, setActiveChapterPath, chapterContent, setChapterContent,
    loadError, setLoadError, isLoading, setIsLoading, isSaving, setIsSaving,
    restoredFromStorage, setRestoredFromStorage, userNavigated, markUserNavigated,
  };
}

export function useChapterRefs(
  blueprint: BlueprintChapterPayload | null,
  chapters: ChapterDescriptor[],
  activeChapterPath: string,
): ChapterRefs {
  const blueprintRef = useRef(blueprint);
  blueprintRef.current = blueprint;
  const chaptersRef = useRef(chapters);
  chaptersRef.current = chapters;
  const activeChapterPathRef = useRef(activeChapterPath);
  activeChapterPathRef.current = activeChapterPath;
  const fetchCounterRef = useRef(0);
  return { blueprintRef, chaptersRef, activeChapterPathRef, fetchCounterRef };
}

function seedEntrypoint(
  blueprint: BlueprintChapterPayload | null,
  entrypoint: string,
  view: ChapterViewState,
): void {
  view.setActiveChapterPath(entrypoint);
  view.setChapterContent(blueprint?.blueprint_content ?? '');
}

function useBlueprintSelection(
  blueprint: BlueprintChapterPayload | null,
  refs: ChapterRefs,
  view: ChapterViewState,
  loadChapter: (path: string) => Promise<boolean>,
): void {
  useEffect(() => {
    const newId = blueprint?.id;
    if (!newId) return;
    const currentBlueprint = refs.blueprintRef.current;
    const entrypoint = currentBlueprint?.blueprint_file ?? '';
    if (!entrypoint) return;
    const persisted = readPersistedActiveChapter(newId);
    const knownPaths = new Set(refs.chaptersRef.current.map(({ path }) => path));
    const restoreTarget = persisted && knownPaths.has(persisted) ? persisted : '';
    view.setRestoredFromStorage(Boolean(restoreTarget && restoreTarget !== entrypoint));
    view.setLoadError(null);
    if (restoreTarget && restoreTarget !== entrypoint) {
      view.setActiveChapterPath(restoreTarget);
      view.setChapterContent('');
      void loadChapter(restoreTarget);
    } else {
      seedEntrypoint(currentBlueprint, entrypoint, view);
    }
    // Selection restoration intentionally runs only when blueprint identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blueprint?.id]);
}

function useEntrypointSelection(
  blueprint: BlueprintChapterPayload | null,
  refs: ChapterRefs,
  view: ChapterViewState,
): void {
  const previousEntrypointRef = useRef('');
  useEffect(() => {
    const entrypoint = blueprint?.blueprint_file ?? '';
    const previousEntrypoint = previousEntrypointRef.current;
    previousEntrypointRef.current = entrypoint;
    if (!entrypoint || entrypoint === previousEntrypoint) return;
    const active = refs.activeChapterPathRef.current;
    const stillValid = Boolean(active)
      && active !== previousEntrypoint
      && refs.chaptersRef.current.some(({ path }) => path === active);
    if (stillValid) return;
    seedEntrypoint(refs.blueprintRef.current, entrypoint, view);
    // Entrypoint replacement intentionally keys only on the entrypoint path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blueprint?.blueprint_file]);
}

function usePersistedSelection(refs: ChapterRefs, activeChapterPath: string): void {
  useEffect(() => {
    const id = refs.blueprintRef.current?.id;
    if (id && activeChapterPath) writePersistedActiveChapter(id, activeChapterPath);
    // Persistence intentionally keys only on the selected path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChapterPath]);
}

export function useChapterSelectionLifecycle(
  blueprint: BlueprintChapterPayload | null,
  refs: ChapterRefs,
  view: ChapterViewState,
  loadChapter: (path: string) => Promise<boolean>,
): void {
  useBlueprintSelection(blueprint, refs, view, loadChapter);
  useEntrypointSelection(blueprint, refs, view);
  usePersistedSelection(refs, view.activeChapterPath);
}
