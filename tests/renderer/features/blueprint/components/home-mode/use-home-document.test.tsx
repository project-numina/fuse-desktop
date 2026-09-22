import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({ statusOf: () => 'proved' }),
}));

import { useHomeDocument } from '@/features/blueprint/components/home-mode/use-home-document';

describe('useHomeDocument', () => {
  it('derives active chapter rendering and automatically leaves an empty entrypoint', async () => {
    const onAutoSelectChapter = vi.fn();
    const chapters = [
      { path: 'content.tex', label: 'content.tex', isEntrypoint: true },
      { path: 'chapter.tex', label: 'chapter.tex', isEntrypoint: false },
    ];
    const { result } = renderHook(() => useHomeDocument({
      blueprint: {
        name: 'Imported',
        entries: [{
          kind: 'lemma', label: 'lem:one', title: 'One', statement: 'A statement.',
          source_file: 'chapter.tex',
        }],
        chapter_contents: { 'chapter.tex': '\\section{Chapter}' },
      },
      entries: [],
      hasMultipleChapters: true,
      chapters,
      activeChapterPath: 'content.tex',
      chapterContent: '\\input{chapter}',
      onAutoSelectChapter,
    }));

    await waitFor(() => expect(onAutoSelectChapter).toHaveBeenCalledWith('chapter.tex'));
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.activeChapterFile).toBe('content.tex');
    expect(result.current.declarationReferences['lem:one']).toEqual({
      kind: 'lemma', number: '1.1',
    });
  });
});
