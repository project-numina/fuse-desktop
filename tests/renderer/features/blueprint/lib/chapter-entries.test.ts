import { describe, expect, it } from 'vitest';

import {
  chapterMenuFile,
  chapterMenuLabel,
  entrySourceFile,
  multiChapterEntries,
  singleChapterEntries,
  type ParsedEntry,
} from '@/features/blueprint/lib/chapter-entries';

function entry(partial: Partial<ParsedEntry> & { label: string }): ParsedEntry {
  return {
    kind: 'theorem',
    title: partial.label,
    uses: [],
    status: 'not_started',
    leanName: '',
    ...partial,
  };
}

describe('entrySourceFile', () => {
  it('prefers source_file, falling back to sourceFile then empty string', () => {
    expect(entrySourceFile(entry({ label: 'a', source_file: 'x.tex' }))).toBe('x.tex');
    expect(entrySourceFile(entry({ label: 'a', sourceFile: 'y.tex' }))).toBe('y.tex');
    expect(entrySourceFile(entry({ label: 'a' }))).toBe('');
  });
});

describe('chapterMenuLabel', () => {
  it('labels the entrypoint as Index', () => {
    expect(chapterMenuLabel({ label: 'main.tex', isEntrypoint: true })).toBe('Index');
  });

  it('prefers a trimmed title when present', () => {
    expect(
      chapterMenuLabel({ label: 'ch/one.tex', title: '  Chapter One ', isEntrypoint: false }),
    ).toBe('Chapter One');
  });

  it('falls back to the final path segment without the .tex suffix', () => {
    expect(chapterMenuLabel({ label: 'chapters/intro.tex', isEntrypoint: false })).toBe('intro');
    expect(chapterMenuLabel({ label: 'intro.tex', isEntrypoint: false })).toBe('intro');
  });
});

describe('chapterMenuFile', () => {
  it('returns the file for the entrypoint and titled sections', () => {
    expect(chapterMenuFile({ label: 'content.tex', isEntrypoint: true })).toBe('content.tex');
    expect(
      chapterMenuFile({ label: 'GWZAdapted/section8.tex', title: 'Main Lemma 1', isEntrypoint: false }),
    ).toBe('GWZAdapted/section8.tex');
  });

  it('returns empty for untitled sections (their label already is the filename)', () => {
    expect(chapterMenuFile({ label: 'GWZAdapted/reference.tex', isEntrypoint: false })).toBe('');
    expect(chapterMenuFile({ label: 'x.tex', title: '   ', isEntrypoint: false })).toBe('');
  });
});

describe('singleChapterEntries', () => {
  it('returns the server set when non-empty', () => {
    const server = [entry({ label: 's' })];
    const local = [entry({ label: 'l' })];
    expect(singleChapterEntries(local, server)).toBe(server);
  });

  it('falls back to the local set when the server set is empty', () => {
    const local = [entry({ label: 'l' })];
    expect(singleChapterEntries(local, [])).toBe(local);
  });
});

describe('multiChapterEntries', () => {
  it('keeps only the active chapter and lets local edits override server copies', () => {
    const server = [
      entry({ label: 'a', title: 'Server A', source_file: 'ch1.tex' }),
      entry({ label: 'b', title: 'Server B', source_file: 'ch2.tex' }),
    ];
    const local = [entry({ label: 'a', title: 'Local A' })];

    const result = multiChapterEntries(local, server, 'ch1.tex');

    expect(result.map(e => e.label)).toEqual(['a']);
    expect(result[0].title).toBe('Local A');
    expect(result[0].source_file).toBe('ch1.tex');
  });

  it('includes brand-new local-only entries in the active chapter', () => {
    const result = multiChapterEntries(
      [entry({ label: 'fresh' })],
      [],
      'ch1.tex',
    );
    expect(result.map(e => e.label)).toEqual(['fresh']);
    expect(result[0].source_file).toBe('ch1.tex');
  });

  it('adds ghost stubs for cross-chapter \\uses references', () => {
    const server = [
      entry({ label: 'a', uses: ['b'], source_file: 'ch1.tex' }),
      entry({ label: 'b', uses: ['c'], source_file: 'ch2.tex' }),
    ];

    const result = multiChapterEntries([], server, 'ch1.tex');

    const ghost = result.find(e => e.label === 'b');
    expect(ghost).toBeDefined();
    expect(ghost!.isExternal).toBe(true);
    // The ghost's own dependencies are stubbed so they don't drag in.
    expect(ghost!.uses).toEqual([]);
  });

  it('drops references that have no matching server entry', () => {
    const server = [entry({ label: 'a', uses: ['missing'], source_file: 'ch1.tex' })];
    const result = multiChapterEntries([], server, 'ch1.tex');
    expect(result.map(e => e.label)).toEqual(['a']);
  });
});
