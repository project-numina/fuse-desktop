import { useEffect, useRef, useState, type MutableRefObject } from 'react';

import type {
  EditModeChapter,
  EditSaveState,
} from '@/features/blueprint/components/EditMode';

export const CHAPTER_SAVE_ERROR_MESSAGE = [
  'Could not save this chapter.',
  'Your edits are still in the editor.',
].join(' ');

interface SaveMachineDeps {
  latexSourceRef: MutableRefObject<string>;
  activeChapterPathRef: MutableRefObject<string>;
  blueprintReadonlyRef: MutableRefObject<boolean>;
  saveActiveChapterRef: MutableRefObject<EditModeChapter['saveActiveChapter']>;
  hasContextRef: MutableRefObject<boolean>;
  editSaveStateRef: MutableRefObject<EditSaveState | null | undefined>;
  setSaveErrorMessage: (message: string) => void;
}

export interface SaveMachine {
  flushPendingSave: () => Promise<boolean>;
  markContentClean: (content: string) => void;
  resetBaseline: () => void;
  noteLocalChange: (content: string, chapterPath: string) => void;
}

class FallbackSaveMachine implements SaveMachine {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSavedContent: string;
  private hasPendingLocalChange = false;
  private saveInFlightCount = 0;
  private saveChain: Promise<boolean> = Promise.resolve(true);
  private inFlightSave: Promise<boolean> | null = null;

  constructor(private readonly deps: SaveMachineDeps) {
    this.lastSavedContent = deps.latexSourceRef.current;
  }

  private updatePendingState(): void {
    this.deps.editSaveStateRef.current?.setPending(
      this.hasPendingLocalChange || this.saveInFlightCount > 0,
    );
  }

  private clearTimer(): void {
    if (!this.debounceTimer) return;
    clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }

  private requestSave(content: string, chapterPath: string): Promise<unknown> {
    if (this.inFlightSave === null) {
      return this.deps.saveActiveChapterRef.current(content, chapterPath);
    }
    return this.saveChain
      .catch(() => false)
      .then(() => this.deps.saveActiveChapterRef.current(content, chapterPath));
  }

  private saveToBackend(content: string, chapterPath: string): Promise<boolean> {
    if (!this.deps.hasContextRef.current) return Promise.resolve(false);
    this.hasPendingLocalChange = false;
    this.saveInFlightCount += 1;
    this.deps.setSaveErrorMessage('');
    this.updatePendingState();
    const promise: Promise<boolean> = this.requestSave(content, chapterPath)
      .then(() => {
        this.lastSavedContent = content;
        this.deps.setSaveErrorMessage('');
        return true;
      })
      .catch(() => {
        this.hasPendingLocalChange = true;
        this.deps.setSaveErrorMessage(CHAPTER_SAVE_ERROR_MESSAGE);
        return false;
      })
      .finally(() => this.finishSave(promise));
    this.saveChain = promise;
    this.inFlightSave = promise;
    return promise;
  }

  private finishSave(promise: Promise<boolean>): void {
    this.saveInFlightCount = Math.max(0, this.saveInFlightCount - 1);
    this.updatePendingState();
    if (this.inFlightSave === promise) this.inFlightSave = null;
  }

  private scheduleSave(content: string, chapterPath: string): void {
    this.clearTimer();
    this.debounceTimer = setTimeout(() => {
      void this.saveToBackend(content, chapterPath);
    }, 2000);
  }

  noteLocalChange(content: string, chapterPath: string): void {
    if (this.deps.blueprintReadonlyRef.current || content === this.lastSavedContent) return;
    this.hasPendingLocalChange = true;
    this.updatePendingState();
    this.scheduleSave(content, chapterPath);
  }

  markContentClean = (content: string): void => {
    this.clearTimer();
    this.lastSavedContent = content;
    this.hasPendingLocalChange = false;
    this.deps.setSaveErrorMessage('');
    this.updatePendingState();
  };

  resetBaseline = (): void => {
    this.clearTimer();
    this.lastSavedContent = this.deps.latexSourceRef.current;
    this.hasPendingLocalChange = false;
    this.deps.setSaveErrorMessage('');
    this.updatePendingState();
  };

  flushPendingSave = async (): Promise<boolean> => {
    this.clearTimer();
    if (this.inFlightSave && !(await this.inFlightSave)) return false;
    if (
      this.hasPendingLocalChange
      && this.deps.latexSourceRef.current !== this.lastSavedContent
      && this.deps.hasContextRef.current
    ) {
      return this.saveToBackend(
        this.deps.latexSourceRef.current,
        this.deps.activeChapterPathRef.current,
      );
    }
    return true;
  };
}

export function createSaveMachine(deps: SaveMachineDeps): SaveMachine {
  return new FallbackSaveMachine(deps);
}

interface UseEditModeSaveOptions {
  latexSource: string;
  activeChapterPath: string;
  blueprintReadonly: boolean;
  saveActiveChapter: EditModeChapter['saveActiveChapter'];
  hasContext: boolean;
  collaborative: boolean;
  editSaveState: EditSaveState | null;
}

function useCurrentSaveRefs(options: UseEditModeSaveOptions) {
  const latexSourceRef = useRef(options.latexSource);
  const activeChapterPathRef = useRef(options.activeChapterPath);
  const blueprintReadonlyRef = useRef(options.blueprintReadonly);
  const saveActiveChapterRef = useRef(options.saveActiveChapter);
  const hasContextRef = useRef(options.hasContext);
  const editSaveStateRef = useRef<EditSaveState | null>(options.editSaveState);
  latexSourceRef.current = options.latexSource;
  activeChapterPathRef.current = options.activeChapterPath;
  blueprintReadonlyRef.current = options.blueprintReadonly;
  saveActiveChapterRef.current = options.saveActiveChapter;
  hasContextRef.current = options.hasContext;
  editSaveStateRef.current = options.editSaveState;
  return {
    latexSourceRef,
    activeChapterPathRef,
    blueprintReadonlyRef,
    saveActiveChapterRef,
    hasContextRef,
    editSaveStateRef,
  };
}

function useSaveEffects(
  machine: SaveMachine,
  options: UseEditModeSaveOptions,
  editSaveStateRef: MutableRefObject<EditSaveState | null>,
): void {
  const didMountSource = useRef(false);
  const didMountChapter = useRef(false);
  useEffect(() => {
    if (!didMountSource.current) {
      didMountSource.current = true;
    } else if (!options.collaborative) {
      machine.noteLocalChange(options.latexSource, options.activeChapterPath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.latexSource]);
  useEffect(() => {
    if (!didMountChapter.current) {
      didMountChapter.current = true;
    } else if (!options.collaborative) {
      machine.resetBaseline();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.activeChapterPath]);
  useEffect(() => {
    editSaveStateRef.current?.setFlush?.(machine.flushPendingSave);
    editSaveStateRef.current?.setCleanMarker?.(machine.markContentClean);
    return () => {
      void machine.flushPendingSave();
      clearSaveBindings(editSaveStateRef);
    };
  }, [machine, editSaveStateRef]);
}

/** Cleanup targets the latest page wiring rather than the mount-time object. */
function clearSaveBindings(
  editSaveStateRef: MutableRefObject<EditSaveState | null>,
): void {
  editSaveStateRef.current?.setFlush?.(null);
  editSaveStateRef.current?.setCleanMarker?.(null);
}

export function useEditModeSave(options: UseEditModeSaveOptions): string {
  const [saveErrorMessage, setSaveErrorMessage] = useState('');
  const refs = useCurrentSaveRefs(options);
  const machineRef = useRef<SaveMachine | null>(null);
  if (machineRef.current === null) {
    machineRef.current = createSaveMachine({ ...refs, setSaveErrorMessage });
  }
  useSaveEffects(machineRef.current, options, refs.editSaveStateRef);
  return saveErrorMessage;
}
