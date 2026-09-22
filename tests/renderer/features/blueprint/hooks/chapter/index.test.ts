import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchBlueprintChapter, updateBlueprintChapter } from '@/lib/api';
import {
  commonDirectoryPrefix,
  deriveChapterLabel,
  useChapter,
} from '@/features/blueprint/hooks/chapter';

vi.mock('@/lib/api', () => ({
  fetchBlueprintChapter: vi.fn(),
  updateBlueprintChapter: vi.fn(),
}));

const fetchChapterMock = vi.mocked(fetchBlueprintChapter);
const updateChapterMock = vi.mocked(updateBlueprintChapter);
const context = { owner: 'numina', repo: 'math', blueprintId: 'workspace' };

type Blueprint = NonNullable<Parameters<typeof useChapter>[0]>;
type ChapterContentResponse = Awaited<ReturnType<typeof fetchBlueprintChapter>>;

function blueprint(overrides: Partial<Blueprint> = {}): Blueprint {
  return {
    id: 'froda',
    blueprint_file: 'blueprint/src/content.tex',
    blueprint_content: 'table of contents',
    included_files: [
      'blueprint/src/content.tex',
      'blueprint/src/chapter/intro.tex',
      'blueprint/src/chapter/results.tex',
    ],
    chapter_titles: {
      'blueprint/src/chapter/intro.tex': 'Introduction',
    },
    chapter_contents: {
      'blueprint/src/chapter/intro.tex': 'intro content',
      'blueprint/src/chapter/results.tex': 'results content',
    },
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  fetchChapterMock.mockReset();
  updateChapterMock.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('chapter path helpers', () => {
  it.each([
    [[], ''],
    [['content.tex'], ''],
    [['blueprint/src/content.tex', 'blueprint/src/chapter/intro.tex'], 'blueprint/src/'],
    [['a/x.tex', 'b/y.tex'], ''],
    [['a/b/x.tex', 'a/b/y.tex', 'a/c/z.tex'], 'a/'],
  ])('computes the common directory prefix for %j', (paths, expected) => {
    expect(commonDirectoryPrefix(paths)).toBe(expected);
  });

  it('strips a shared prefix from chapter labels', () => {
    expect(deriveChapterLabel('blueprint/src/chapter/intro.tex', 'blueprint/src/')).toBe(
      'chapter/intro.tex',
    );
  });

  it('falls back to the basename when there is no applicable prefix', () => {
    expect(deriveChapterLabel('blueprint/src/chapter/intro.tex', 'other/')).toBe('intro.tex');
    expect(deriveChapterLabel('content.tex', '')).toBe('content.tex');
  });
});

describe('useChapter', () => {
  it('derives unique chapter metadata and seeds the entrypoint content', () => {
    const bp = blueprint({
      included_files: [
        '',
        'blueprint/src/content.tex',
        'blueprint/src/chapter/intro.tex',
        'blueprint/src/chapter/intro.tex',
      ],
    });
    const { result } = renderHook(() => useChapter(bp, context));

    expect(result.current.chapters).toEqual([
      {
        path: 'blueprint/src/content.tex',
        label: 'content.tex',
        title: undefined,
        isEntrypoint: true,
      },
      {
        path: 'blueprint/src/chapter/intro.tex',
        label: 'chapter/intro.tex',
        title: 'Introduction',
        isEntrypoint: false,
      },
    ]);
    expect(result.current.hasMultipleChapters).toBe(true);
    expect(result.current.activeChapterPath).toBe('blueprint/src/content.tex');
    expect(result.current.chapterContent).toBe('table of contents');
    expect(localStorage.getItem('numina-fuse:active-chapter:froda')).toBe(
      'blueprint/src/content.tex',
    );
  });

  it('handles an absent blueprint and no-op callbacks safely', async () => {
    const { result } = renderHook(() => useChapter(null, context));

    expect(result.current.chapters).toEqual([]);
    expect(result.current.hasMultipleChapters).toBe(false);
    await expect(result.current.loadChapter('anything.tex')).resolves.toBe(false);
    await expect(result.current.loadChapter('')).resolves.toBe(false);
    await expect(result.current.saveActiveChapter('ignored')).resolves.toBeUndefined();
    expect(result.current.syncActiveFromBlueprint()).toBeNull();
    expect(fetchChapterMock).not.toHaveBeenCalled();
    expect(updateChapterMock).not.toHaveBeenCalled();
  });

  it('restores a known preloaded chapter and tracks explicit user navigation', () => {
    const first = blueprint({ id: 'first' });
    const { result, rerender } = renderHook(
      ({ current }) => useChapter(current, context),
      { initialProps: { current: first } },
    );
    localStorage.setItem(
      'numina-fuse:active-chapter:froda',
      'blueprint/src/chapter/intro.tex',
    );
    rerender({ current: blueprint() });

    expect(result.current.restoredFromStorage).toBe(true);
    expect(result.current.activeChapterPath).toBe('blueprint/src/chapter/intro.tex');
    expect(result.current.chapterContent).toBe('intro content');
    expect(result.current.userNavigated).toBe(false);
    act(() => result.current.markUserNavigated());
    expect(result.current.userNavigated).toBe(true);
    expect(fetchChapterMock).not.toHaveBeenCalled();
  });

  it('falls back to the entrypoint when persisted state is stale', () => {
    localStorage.setItem('numina-fuse:active-chapter:froda', 'removed.tex');
    const { result } = renderHook(() => useChapter(blueprint(), context));

    expect(result.current.restoredFromStorage).toBe(false);
    expect(result.current.activeChapterPath).toBe('blueprint/src/content.tex');
    expect(result.current.chapterContent).toBe('table of contents');
  });

  it('switches synchronously between entrypoint, preloaded, and public missing chapters', async () => {
    const bp = blueprint({
      included_files: [
        'blueprint/src/content.tex',
        'blueprint/src/chapter/intro.tex',
        'blueprint/src/chapter/missing.tex',
      ],
    });
    const { result } = renderHook(() => useChapter(bp, context, { allowFetch: false }));

    await act(async () => {
      expect(await result.current.loadChapter('blueprint/src/chapter/intro.tex')).toBe(true);
    });
    expect(result.current.chapterContent).toBe('intro content');

    await act(async () => {
      expect(await result.current.loadChapter('blueprint/src/content.tex')).toBe(true);
    });
    expect(result.current.chapterContent).toBe('table of contents');

    await act(async () => {
      expect(await result.current.loadChapter('blueprint/src/chapter/missing.tex')).toBe(true);
    });
    expect(result.current.activeChapterPath).toBe('blueprint/src/chapter/missing.tex');
    expect(result.current.chapterContent).toBe('');
    expect(result.current.loadError).toBeNull();
    expect(fetchChapterMock).not.toHaveBeenCalled();
  });

  it('loads a missing chapter over the network and reports loading state', async () => {
    let resolve!: (value: ChapterContentResponse) => void;
    fetchChapterMock.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const path = 'blueprint/src/chapter/remote.tex';
    const bp = blueprint({
      included_files: ['blueprint/src/content.tex', path],
      chapter_contents: {},
    });
    const { result } = renderHook(() => useChapter(bp, context));
    let pending!: Promise<boolean>;

    act(() => { pending = result.current.loadChapter(path); });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.loadError).toBeNull();
    expect(fetchChapterMock).toHaveBeenCalledWith(
      'numina', 'math', 'workspace', path,
    );

    await act(async () => resolve({ path, content: 'loaded remotely' }));
    await expect(pending).resolves.toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.activeChapterPath).toBe(path);
    expect(result.current.chapterContent).toBe('loaded remotely');
  });

  it('surfaces Error and non-Error load failures', async () => {
    const path = 'blueprint/src/chapter/missing.tex';
    const bp = blueprint({ included_files: ['blueprint/src/content.tex', path], chapter_contents: {} });
    fetchChapterMock.mockRejectedValueOnce(new Error('chapter unavailable'));
    const { result } = renderHook(() => useChapter(bp, context));

    await act(async () => {
      expect(await result.current.loadChapter(path)).toBe(false);
    });
    expect(result.current.loadError).toBe('chapter unavailable');
    expect(result.current.isLoading).toBe(false);

    fetchChapterMock.mockRejectedValueOnce('bad response');
    await act(async () => {
      expect(await result.current.loadChapter(path)).toBe(false);
    });
    expect(result.current.loadError).toBe('Could not load chapter.');
  });

  it('discards a slow response after navigation to a newer chapter', async () => {
    const paths = ['blueprint/src/chapter/slow.tex', 'blueprint/src/chapter/fast.tex'];
    let resolveSlow!: (value: ChapterContentResponse) => void;
    let resolveFast!: (value: ChapterContentResponse) => void;
    fetchChapterMock.mockImplementation((_owner, _repo, _id, path) => new Promise((resolve) => {
      if (path === paths[0]) resolveSlow = resolve;
      else resolveFast = resolve;
    }));
    const bp = blueprint({
      included_files: ['blueprint/src/content.tex', ...paths],
      chapter_contents: {},
    });
    const { result } = renderHook(() => useChapter(bp, context));

    let slow!: Promise<boolean>;
    let fast!: Promise<boolean>;
    act(() => {
      slow = result.current.loadChapter(paths[0]);
      fast = result.current.loadChapter(paths[1]);
    });
    await act(async () => resolveFast({ path: paths[1], content: 'new selection' }));
    await expect(fast).resolves.toBe(true);
    await act(async () => resolveSlow({ path: paths[0], content: 'stale selection' }));
    await expect(slow).resolves.toBe(false);

    expect(result.current.activeChapterPath).toBe(paths[1]);
    expect(result.current.chapterContent).toBe('new selection');
    expect(result.current.isLoading).toBe(false);
  });

  it('saves chapters, updates cached content, and resets saving state after failure', async () => {
    const bp = blueprint();
    const { result } = renderHook(() => useChapter(bp, context));
    await act(async () => result.current.loadChapter('blueprint/src/chapter/intro.tex'));

    let resolveSave!: () => void;
    updateChapterMock.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveSave = resolve;
    }));
    let pending!: Promise<void>;
    act(() => { pending = result.current.saveActiveChapter('edited intro'); });
    expect(result.current.isSaving).toBe(true);
    expect(updateChapterMock).toHaveBeenCalledWith(
      'numina', 'math', 'workspace', 'blueprint/src/chapter/intro.tex', 'edited intro',
    );
    await act(async () => resolveSave());
    await pending;
    expect(result.current.isSaving).toBe(false);

    await act(async () => result.current.loadChapter('blueprint/src/content.tex'));
    await act(async () => result.current.loadChapter('blueprint/src/chapter/intro.tex'));
    expect(result.current.chapterContent).toBe('edited intro');

    updateChapterMock.mockRejectedValueOnce(new Error('save failed'));
    await expect(act(async () => result.current.saveActiveChapter(
      'entry edit',
      'blueprint/src/content.tex',
    ))).rejects.toThrow('save failed');
    expect(result.current.isSaving).toBe(false);
  });

  it('creates a chapter cache when saving into a payload without one', async () => {
    const bp = blueprint({ chapter_contents: undefined });
    const { result } = renderHook(() => useChapter(bp, context));

    await act(async () => result.current.saveActiveChapter(
      'new cached chapter',
      'blueprint/src/chapter/new.tex',
    ));
    expect(bp.chapter_contents).toEqual({
      'blueprint/src/chapter/new.tex': 'new cached chapter',
    });

    await act(async () => result.current.saveActiveChapter(
      'new entrypoint',
      'blueprint/src/content.tex',
    ));
    expect(bp.blueprint_content).toBe('new entrypoint');
  });

  it('synchronizes active content from refreshed blueprint payloads', async () => {
    const bp = blueprint();
    const { result, rerender } = renderHook(
      ({ current }) => useChapter(current, context),
      { initialProps: { current: bp as Blueprint | null } },
    );

    bp.blueprint_content = 'refreshed entrypoint';
    rerender({ current: bp });
    let synced: string | null = null;
    act(() => { synced = result.current.syncActiveFromBlueprint(); });
    expect(synced).toBe('refreshed entrypoint');
    expect(result.current.chapterContent).toBe('refreshed entrypoint');

    await act(async () => result.current.loadChapter('blueprint/src/chapter/intro.tex'));
    bp.chapter_contents = {};
    rerender({ current: bp });
    expect(result.current.syncActiveFromBlueprint()).toBeNull();

    bp.chapter_contents = { 'blueprint/src/chapter/intro.tex': 'refreshed intro' };
    rerender({ current: bp });
    act(() => { synced = result.current.syncActiveFromBlueprint(); });
    expect(synced).toBe('refreshed intro');
    expect(result.current.chapterContent).toBe('refreshed intro');
  });

  it('reseeds when an entrypoint appears or changes, but preserves a surviving chapter', async () => {
    const initial = blueprint({ blueprint_file: '', blueprint_content: '', included_files: [] });
    const { result, rerender } = renderHook(
      ({ current }) => useChapter(current, context),
      { initialProps: { current: initial } },
    );
    expect(result.current.activeChapterPath).toBe('');

    const created = blueprint();
    rerender({ current: created });
    expect(result.current.activeChapterPath).toBe('blueprint/src/content.tex');
    expect(result.current.chapterContent).toBe('table of contents');

    await act(async () => result.current.loadChapter('blueprint/src/chapter/intro.tex'));
    const swapped = blueprint({
      blueprint_file: 'blueprint/src/new-content.tex',
      blueprint_content: 'new table',
      included_files: [
        'blueprint/src/new-content.tex',
        'blueprint/src/chapter/intro.tex',
      ],
    });
    rerender({ current: swapped });
    expect(result.current.activeChapterPath).toBe('blueprint/src/chapter/intro.tex');

    await act(async () => result.current.loadChapter('blueprint/src/new-content.tex'));
    const replacedAgain = blueprint({
      blueprint_file: 'blueprint/src/final-content.tex',
      blueprint_content: 'final table',
      included_files: ['blueprint/src/final-content.tex'],
    });
    rerender({ current: replacedAgain });
    expect(result.current.activeChapterPath).toBe('blueprint/src/final-content.tex');
    expect(result.current.chapterContent).toBe('final table');
  });

  it('keeps operational callback identities stable across state updates', () => {
    const { result } = renderHook(() => useChapter(blueprint(), context));
    const callbacks = {
      loadChapter: result.current.loadChapter,
      saveActiveChapter: result.current.saveActiveChapter,
      syncActiveFromBlueprint: result.current.syncActiveFromBlueprint,
      markUserNavigated: result.current.markUserNavigated,
    };

    act(() => result.current.setChapterContent('draft'));

    expect(result.current).toMatchObject(callbacks);
  });

  it('tolerates unavailable localStorage while restoring and persisting', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    expect(() => renderHook(() => useChapter(blueprint(), context))).not.toThrow();
  });
});
