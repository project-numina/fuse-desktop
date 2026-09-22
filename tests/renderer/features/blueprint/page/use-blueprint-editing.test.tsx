import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setLatexSource: vi.fn(),
  initFromBlueprint: vi.fn(),
  syncActiveFromBlueprint: vi.fn<() => string | null>(() => 'saved source'),
  loadChapter: vi.fn(async () => true),
  markUserNavigated: vi.fn(),
}));

vi.mock('@/features/blueprint/hooks/latex-parser', () => ({
  useLatexParser: () => ({
    latexSource: 'source',
    setLatexSource: mocks.setLatexSource,
    parsedEntries: [{ label: 'local' }],
    latexSegments: [],
    initFromBlueprint: mocks.initFromBlueprint,
  }),
}));
vi.mock('@/features/blueprint/hooks/chapter', () => ({
  useChapter: () => ({
    chapters: [],
    hasMultipleChapters: false,
    activeChapterPath: 'blueprint.tex',
    chapterContent: 'chapter source',
    restoredFromStorage: false,
    userNavigated: false,
    syncActiveFromBlueprint: mocks.syncActiveFromBlueprint,
    loadChapter: mocks.loadChapter,
    saveActiveChapter: vi.fn(),
    markUserNavigated: mocks.markUserNavigated,
  }),
}));
vi.mock('@/features/blueprint/lib/chapter-entries', () => ({
  singleChapterEntries: (local: unknown[]) => local,
  multiChapterEntries: (local: unknown[]) => local,
}));

import { useBlueprintEditing } from '@/features/blueprint/page/use-blueprint-editing';

it('coordinates saved source initialization, chapter selection, and settings updates', async () => {
  const blueprint = { id: 'fermat', blueprint_content: 'server source' };
  const setBlueprint = vi.fn();
  const applyOcrPhase = vi.fn();
  const { result } = renderHook(() => useBlueprintEditing({
    route: { owner: 'acme', repo: 'mathlib', blueprintId: 'fermat' },
    blueprint,
    blueprintRef: { current: blueprint },
    setBlueprint: setBlueprint as never,
  }));

  act(() => result.current.initializeBlueprint(blueprint, applyOcrPhase));
  expect(mocks.setLatexSource).toHaveBeenCalledWith('saved source');
  expect(applyOcrPhase).toHaveBeenCalledWith(undefined);

  await act(async () => result.current.selectChapter('chapter.tex'));
  expect(mocks.markUserNavigated).toHaveBeenCalled();
  expect(mocks.loadChapter).toHaveBeenCalledWith('chapter.tex');

  act(() => result.current.applySettingsUpdate({
    name: 'Updated', description: 'Description', pr_mode: 'off',
    auto_commit: false, orchestrator_child_concurrency: 2, pr_number: null,
  }));
  const updater = setBlueprint.mock.calls[0][0] as (value: typeof blueprint) => unknown;
  expect(updater(blueprint)).toEqual(expect.objectContaining({ name: 'Updated' }));
});
