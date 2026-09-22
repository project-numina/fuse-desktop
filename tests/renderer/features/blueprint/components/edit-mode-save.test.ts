import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CHAPTER_SAVE_ERROR_MESSAGE,
  createSaveMachine,
} from '@/features/blueprint/components/edit-mode-save';

function setup(saveActiveChapter = vi.fn().mockResolvedValue(undefined)) {
  const source = { current: 'initial' };
  const chapterPath = { current: 'chapters/intro.tex' };
  const readonly = { current: false };
  const hasContext = { current: true };
  const setPending = vi.fn();
  const setError = vi.fn();
  const machine = createSaveMachine({
    latexSourceRef: source,
    activeChapterPathRef: chapterPath,
    blueprintReadonlyRef: readonly,
    saveActiveChapterRef: { current: saveActiveChapter },
    hasContextRef: hasContext,
    editSaveStateRef: { current: { setPending } },
    setSaveErrorMessage: setError,
  });
  return {
    machine,
    source,
    chapterPath,
    readonly,
    hasContext,
    saveActiveChapter,
    setPending,
    setError,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('EditMode fallback save machine', () => {
  it('debounces local changes and clears pending state after saving', async () => {
    vi.useFakeTimers();
    const values = setup();
    values.source.current = 'changed';
    values.machine.noteLocalChange('changed', values.chapterPath.current);

    expect(values.setPending).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(1999);
    expect(values.saveActiveChapter).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(values.saveActiveChapter).toHaveBeenCalledWith(
      'changed',
      'chapters/intro.tex',
    );
    expect(values.setPending).toHaveBeenLastCalledWith(false);
  });

  it('serializes a second flush behind the save already in flight', async () => {
    let resolveFirst!: () => void;
    const firstRequest = new Promise<void>((resolve) => { resolveFirst = resolve; });
    const save = vi.fn()
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValueOnce(undefined);
    const values = setup(save);

    values.source.current = 'first';
    values.machine.noteLocalChange('first', values.chapterPath.current);
    const firstFlush = values.machine.flushPendingSave();
    values.source.current = 'second';
    values.machine.noteLocalChange('second', values.chapterPath.current);
    const secondFlush = values.machine.flushPendingSave();
    expect(save).toHaveBeenCalledTimes(1);

    resolveFirst();
    await expect(firstFlush).resolves.toBe(true);
    await expect(secondFlush).resolves.toBe(true);
    expect(save.mock.calls).toEqual([
      ['first', 'chapters/intro.tex'],
      ['second', 'chapters/intro.tex'],
    ]);
  });

  it('preserves failed edits and clears them only when marked clean', async () => {
    const values = setup(vi.fn().mockRejectedValue(new Error('offline')));
    values.source.current = 'unsaved';
    values.machine.noteLocalChange('unsaved', values.chapterPath.current);

    await expect(values.machine.flushPendingSave()).resolves.toBe(false);
    expect(values.setError).toHaveBeenCalledWith(CHAPTER_SAVE_ERROR_MESSAGE);
    expect(values.setPending).toHaveBeenLastCalledWith(true);

    values.machine.markContentClean('unsaved');
    expect(values.setError).toHaveBeenLastCalledWith('');
    expect(values.setPending).toHaveBeenLastCalledWith(false);
  });

  it('ignores readonly changes and does not flush without repository context', async () => {
    const values = setup();
    values.readonly.current = true;
    values.machine.noteLocalChange('readonly edit', values.chapterPath.current);
    expect(values.saveActiveChapter).not.toHaveBeenCalled();

    values.readonly.current = false;
    values.hasContext.current = false;
    values.source.current = 'local edit';
    values.machine.noteLocalChange('local edit', values.chapterPath.current);
    await expect(values.machine.flushPendingSave()).resolves.toBe(true);
    expect(values.saveActiveChapter).not.toHaveBeenCalled();
  });
});
