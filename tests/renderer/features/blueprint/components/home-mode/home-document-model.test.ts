import { describe, expect, it } from 'vitest';

import {
  buildChapterSources,
  buildDeclarationReferences,
  buildLeanTargets,
  entriesGroupedByChapter,
  resolveHomeEntries,
} from '@/features/blueprint/components/home-mode/home-document-model';

const chapters = [
  { path: 'content.tex', label: 'content.tex', isEntrypoint: true },
  { path: 'chapter.tex', label: 'chapter.tex', isEntrypoint: false },
];

describe('home document model', () => {
  it('merges live entries only into the active chapter', () => {
    const server = [
      { kind: 'lemma', label: 'active', title: 'Old', statement: 'Old', source_file: 'chapter.tex' },
      { kind: 'lemma', label: 'other', title: 'Other', statement: 'Other', source_file: 'other.tex' },
    ];
    const live = [
      { kind: 'lemma', label: 'active', title: 'New', statement: 'New' },
      { kind: 'lemma', label: 'added', title: 'Added', statement: 'Added' },
    ];

    expect(resolveHomeEntries({ entries: server }, live, true, 'chapter.tex')).toEqual([
      expect.objectContaining({ label: 'active', title: 'New', source_file: 'chapter.tex' }),
      expect.objectContaining({ label: 'other', title: 'Other', source_file: 'other.tex' }),
      expect.objectContaining({ label: 'added', source_file: 'chapter.tex' }),
    ]);
  });

  it('numbers labeled declarations by chapter without counting unlabeled metadata', () => {
    const references = buildDeclarationReferences([
      { kind: 'note', label: '', title: '', statement: '', source_file: 'chapter.tex' },
      { kind: 'lemma', label: 'lem:one', title: 'One', statement: '', source_file: 'chapter.tex' },
    ], chapters, true);

    expect(references['lem:one']).toEqual({ kind: 'lemma', number: '1.1' });
  });

  it('builds chapter sources and authoritative Lean targets', () => {
    const blueprint = {
      blueprint_content: '\\input{chapter}',
      chapter_contents: { 'chapter.tex': 'cached chapter' },
    };
    expect(buildChapterSources(blueprint, chapters, 'chapter.tex', 'live chapter')).toEqual([
      { path: 'content.tex', source: '\\input{chapter}', sectionNumber: 1 },
      { path: 'chapter.tex', source: 'live chapter', sectionNumber: 1 },
    ]);
    expect(buildLeanTargets([{
      kind: 'lemma', label: 'lem:one', title: 'One', statement: '',
      lean_file: 'Project/Main.lean', lean_line: 12,
    }]).get('lem:one')).toEqual({ file: 'Project/Main.lean', line: 12 });
  });

  it('groups entries by their normalized source path', () => {
    const grouped = entriesGroupedByChapter([
      { kind: 'lemma', label: 'a', title: 'A', statement: '', sourceFile: 'a.tex' },
      { kind: 'lemma', label: 'b', title: 'B', statement: '', source_file: 'a.tex' },
    ]);
    expect(grouped.get('a.tex')?.map((entry) => entry.label)).toEqual(['a', 'b']);
  });
});
