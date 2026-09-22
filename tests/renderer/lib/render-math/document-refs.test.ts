import { describe, expect, it } from 'vitest';

import {
  buildDocumentReferences,
  scanDocumentLabels,
} from '@/lib/render-math/document-refs';

describe('scanDocumentLabels', () => {
  it('numbers a labelled section with the file\'s section number', () => {
    const labels = scanDocumentLabels('\\section{Main Lemma 2}\\label{secmainlemma2}', 9);
    expect(labels).toEqual([
      { label: 'secmainlemma2', kind: 'section', number: '9' },
    ]);
  });

  it('counts subsections within the section', () => {
    const source = [
      '\\section{Main Lemma 2}\\label{sec:ml2}',
      '\\subsection{Setup}\\label{extra9SubsecSetup}',
      '\\subsection{Reduction}\\label{extra9SubsecReduction}',
    ].join('\n');
    expect(scanDocumentLabels(source, 9).map(entry => entry.number))
      .toEqual(['9', '9.1', '9.2']);
  });

  it('counts subsubsections within the subsection', () => {
    const source = [
      '\\subsection{Thin}\\label{a}',
      '\\subsubsection{Transverse}\\label{b}',
      '\\subsubsection{Tangential}\\label{c}',
    ].join('\n');
    expect(scanDocumentLabels(source, 9).map(entry => entry.number))
      .toEqual(['9.1', '9.1.1', '9.1.2']);
  });

  it('advances the counter past an unlabelled heading', () => {
    const source = '\\subsection{Setup}\n\\subsection{Reduction}\\label{reduction}';
    expect(scanDocumentLabels(source, 4)).toEqual([
      { label: 'reduction', kind: 'subsection', number: '4.2' },
    ]);
  });

  it('reads a \\label separated from its heading by a newline and a comment', () => {
    const source = '\\subsection{Setup}\n  % a comment\n  \\label{setup}';
    expect(scanDocumentLabels(source, 4)).toEqual([
      { label: 'setup', kind: 'subsection', number: '4.1' },
    ]);
  });

  it('skips a \\label that belongs to a following declaration, not the heading', () => {
    const source = '\\subsection{Setup}\n\\begin{lemma}\\label{lem:foo}\\end{lemma}';
    expect(scanDocumentLabels(source, 4)).toEqual([]);
  });

  it('handles a heading whose title contains braces and a \\ref', () => {
    const source = '\\subsection{Proofs in Section~\\ref{secmainlemma2}}\\label{extra9Section}';
    expect(scanDocumentLabels(source, 9)).toEqual([
      { label: 'extra9Section', kind: 'subsection', number: '9.1' },
    ]);
  });

  it('skips a heading\'s optional short title', () => {
    const source = '\\section[Short]{A much longer title}\\label{sec:long}';
    expect(scanDocumentLabels(source, 3)).toEqual([
      { label: 'sec:long', kind: 'section', number: '3' },
    ]);
  });

  it('numbers labelled equations within the section', () => {
    const source = [
      '\\begin{equation}\\label{eqgoalmuT} \\mu = 1 \\end{equation}',
      '\\begin{equation}\\label{eqgoalUT} U = 2 \\end{equation}',
    ].join('\n');
    expect(scanDocumentLabels(source, 9)).toEqual([
      { label: 'eqgoalmuT', kind: 'equation', number: '9.1' },
      { label: 'eqgoalUT', kind: 'equation', number: '9.2' },
    ]);
  });

  it('numbers each labelled row of a multi-label align', () => {
    const source = '\\begin{align}\\label{a} x &= 1 \\\\ \\label{b} y &= 2\\end{align}';
    expect(scanDocumentLabels(source, 2).map(entry => entry.number))
      .toEqual(['2.1', '2.2']);
  });

  it('ignores labels in starred (unnumbered) environments', () => {
    const source = '\\begin{equation*}\\label{nope} x = 1 \\end{equation*}';
    expect(scanDocumentLabels(source, 9)).toEqual([]);
  });

  it('finds an equation nested inside a declaration environment', () => {
    const source = [
      '\\begin{lemma}\\label{lem:foo}',
      '  \\begin{equation}\\label{boundOnMuTildeTTb} \\mu \\leq 1 \\end{equation}',
      '\\end{lemma}',
    ].join('\n');
    expect(scanDocumentLabels(source, 9)).toEqual([
      { label: 'boundOnMuTildeTTb', kind: 'equation', number: '9.1' },
    ]);
  });

  it('ignores a commented-out subsection so numbering matches the visible headings', () => {
    const source = [
      '% \\subsection{Old}\\label{old}',
      '\\subsection{Reduction}\\label{reduction}',
    ].join('\n');
    expect(scanDocumentLabels(source, 9)).toEqual([
      { label: 'reduction', kind: 'subsection', number: '9.1' },
    ]);
  });

  it('ignores a commented-out equation label and does not consume its number', () => {
    const source = [
      '%     \\begin{equation} \\label{eqOld} x = 0 \\end{equation}',
      '\\begin{equation}\\label{eqReal} y = 1 \\end{equation}',
    ].join('\n');
    expect(scanDocumentLabels(source, 6)).toEqual([
      { label: 'eqReal', kind: 'equation', number: '6.1' },
    ]);
  });

  it('keeps ignoring comments after the first real equation label', () => {
    const source = [
      '\\begin{align}',
      '  \\label{first} x &= 1 \\\\',
      '  % \\label{commented} stale &= 0 \\\\',
      '  \\label{second} y &= 2',
      '\\end{align}',
    ].join('\n');
    expect(scanDocumentLabels(source, 6)).toEqual([
      { label: 'first', kind: 'equation', number: '6.1' },
      { label: 'second', kind: 'equation', number: '6.2' },
    ]);
  });

  it('does not treat an escaped percent as a comment', () => {
    const source = '\\subsection{50\\% dense}\\label{dense}';
    expect(scanDocumentLabels(source, 3)).toEqual([
      { label: 'dense', kind: 'subsection', number: '3.1' },
    ]);
  });

  it('handles a short title containing a bracket', () => {
    const source = '\\section[$A[0]$]{The set $A[0]$}\\label{sec:a0}';
    expect(scanDocumentLabels(source, 4)).toEqual([
      { label: 'sec:a0', kind: 'section', number: '4' },
    ]);
  });

  it('keeps section and equation counters independent', () => {
    const source = [
      '\\subsection{Setup}\\label{setup}',
      '\\begin{equation}\\label{first} x = 1 \\end{equation}',
      '\\subsection{Reduction}\\label{reduction}',
      '\\begin{equation}\\label{second} y = 2 \\end{equation}',
    ].join('\n');
    expect(scanDocumentLabels(source, 9)).toEqual([
      { label: 'setup', kind: 'subsection', number: '9.1' },
      { label: 'first', kind: 'equation', number: '9.1' },
      { label: 'reduction', kind: 'subsection', number: '9.2' },
      { label: 'second', kind: 'equation', number: '9.2' },
    ]);
  });
});

describe('buildDocumentReferences', () => {
  const chapters = [
    { path: 'content.tex', source: '\\section{Intro}\\label{intro}', sectionNumber: 1 },
    {
      path: 'section8.tex',
      source: '\\section{Main Lemma 2}\\label{secmainlemma2}\n'
        + '\\begin{equation}\\label{eqgoalmuT} \\mu = 1 \\end{equation}',
      sectionNumber: 1,
    },
    {
      path: 'section9.tex',
      source: '\\subsection{Reduction}\\label{extra9SubsecReduction}',
      sectionNumber: 2,
    },
  ];

  it('indexes labels across every chapter', () => {
    const { references } = buildDocumentReferences(chapters);
    expect(references.secmainlemma2).toEqual({ kind: 'section', number: '1' });
    expect(references.eqgoalmuT).toEqual({ kind: 'equation', number: '1.1' });
    expect(references.extra9SubsecReduction)
      .toEqual({ kind: 'subsection', number: '2.1' });
  });

  it('records the chapter that defines each label', () => {
    const { chapterByLabel } = buildDocumentReferences(chapters);
    expect(chapterByLabel.secmainlemma2).toBe('section8.tex');
    expect(chapterByLabel.extra9SubsecReduction).toBe('section9.tex');
  });

  it('keeps the first definition when a label is defined twice', () => {
    const { chapterByLabel } = buildDocumentReferences([
      { path: 'a.tex', source: '\\section{A}\\label{dup}', sectionNumber: 1 },
      { path: 'b.tex', source: '\\section{B}\\label{dup}', sectionNumber: 2 },
    ]);
    expect(chapterByLabel.dup).toBe('a.tex');
  });

  it('skips chapters whose source has not loaded', () => {
    const { references } = buildDocumentReferences([
      { path: 'a.tex', source: '', sectionNumber: 1 },
    ]);
    expect(references).toEqual({});
  });
});
