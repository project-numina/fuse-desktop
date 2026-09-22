import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  extractChapterLabel,
  extractChapterTitle,
  loadBlueprintMacros,
  loadChapterReferences,
  loadChapterTitles,
  parseNewcommandDefinitions,
  readBraceGroup,
  readCommandTarget,
} from '@main/services/blueprint/latex/macros';

let tmp: string;

function write(relative: string, content: string): string {
  const target = path.join(tmp, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuse-latex-macros-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('parseNewcommandDefinitions', () => {
  it('parses balanced macros and operators and skips argument macros', () => {
    const source = '\n\\newcommand{\\rhobar}{\\ensuremath{\\overline{\\rho}}}\n\\renewcommand\\rhobar{\\bar\\rho}\n\\newcommand{\\set}[1]{\\{#1\\}}\n\\DeclareMathOperator*{\\colim}{colim}\n% \\newcommand{\\hidden}{no}\n';
    expect(parseNewcommandDefinitions(source)).toEqual({ rhobar: '\\bar\\rho', colim: '\\operatorname*{colim}' });
  });

  it('does not let a malformed macro prevent a later definition', () => {
    expect(parseNewcommandDefinitions('\\newcommand [1]{broken}\n\\newcommand{\\good}{\\alpha}')).toEqual({ good: '\\alpha' });
  });

  it.each([
    ['\\newcommand{\\foo}{\\alpha}', { foo: '\\alpha' }],
    ['\\newcommand\\foo{\\bar}', { foo: '\\bar' }],
    ['\\providecommand{\\foo}{\\alpha}\\renewcommand{\\foo}{\\beta}', { foo: '\\beta' }],
    ['\\newcommand{\\x}{\\overline{\\rho}}', { x: '\\overline{\\rho}' }],
    ['\\newcommand{\\x}{\\ensuremath{a} trailing}', { x: '\\ensuremath{a} trailing' }],
    ['\\newcommand{\\x}[1]{#1}\\newcommand{\\y}{y}', { y: 'y' }],
    ['\\DeclareMathOperator{\\GL}{GL}', { GL: '\\operatorname{GL}' }],
    ['\\newcommand{\\x}{\\% not a comment}', { x: '\\% not a comment' }],
    ['ordinary prose', {}],
    ['\\newcommand{\\foo}{\\alpha} % a comment with \\newcommand{\\bogus}{\\zeta}\n\\newcommand{\\bar}{\\beta}', { foo: '\\alpha', bar: '\\beta' }],
    ['\\newcommand{\\foo}[2][default]{\\bar{#1}{#2}}\\newcommand{\\calO}{\\mathcal{O}}', { calO: '\\mathcal{O}' }],
    ['\\newcommand{\\rhobar}{\\ensuremath{\\bar\\rho}}', { rhobar: '\\bar\\rho' }],
    ['\n\\DeclareMathOperator{\\GL}{GL}\n\\DeclareMathOperator*{\\colim}{colim}\n', { GL: '\\operatorname{GL}', colim: '\\operatorname*{colim}' }],
  ])('parses %s', (source, expected) => {
    expect(parseNewcommandDefinitions(source)).toEqual(expected);
  });

  it('handles low-level malformed input', () => {
    expect(readBraceGroup('{unterminated', 0)).toEqual([null, 0]);
    expect(readBraceGroup('x', 0)).toEqual([null, 0]);
    expect(readCommandTarget('{not-command}', 0)).toEqual([null, 13]);
    expect(readCommandTarget('\\', 0)).toEqual([null, 0]);
    expect(parseNewcommandDefinitions('\\DeclareMathOperator nope')).toEqual({});
    expect(parseNewcommandDefinitions('\\DeclareMathOperator{\\x}')).toEqual({});
  });
});

describe('loadBlueprintMacros', () => {
  it('loads macros from nested chapter includes in order, keeping providecommand as a fallback', () => {
    write('blueprint/src/macros/common.tex', String.raw`\newcommand{\Q}{common}`);
    write('blueprint/src/content.tex', String.raw`\input{chapters/one}
\input{chapters/two}
\renewcommand{\Q}{entry}`);
    write('blueprint/src/chapters/one.tex', String.raw`\providecommand{\ethick}{\mathrm{eth}}
\renewcommand{\Q}{chapter}
\input{chapters/nested}`);
    write('blueprint/src/chapters/nested.tex', String.raw`\newcommand{\R}{\mathbb{R}}`);
    write('blueprint/src/chapters/two.tex', String.raw`\providecommand{\ethick}{wrong}
\providecommand{\Q}{wrong}`);
    expect(loadBlueprintMacros(tmp, 'blueprint/src/content.tex')).toEqual({
      Q: 'entry', ethick: String.raw`\mathrm{eth}`, R: String.raw`\mathbb{R}`,
    });
  });

  it('ignores commented includes, stops cycles, and refuses escaped or symlinked includes', () => {
    const root = path.join(tmp, 'project');
    write('outside.tex', String.raw`\newcommand{\outside}{secret}`);
    write('project/commented.tex', String.raw`\newcommand{\commented}{hidden}`);
    write('project/main.tex', String.raw`% \input{commented}
\input{../outside}
\input{link}
\input{chapter}`);
    write('project/chapter.tex', String.raw`\newcommand{\safe}{yes}\input{main}`);
    fs.symlinkSync(path.join(tmp, 'outside.tex'), path.join(root, 'link.tex'));
    expect(loadBlueprintMacros(root, 'main.tex')).toEqual({ safe: 'yes' });
  });

  it('loads contained macros in LaTeX precedence order', () => {
    const root = path.join(tmp, 'project');
    write('project/blueprint/src/macros/common.tex', '\\newcommand{\\Q}{common}');
    write('project/blueprint/src/macros/web.tex', '\\newcommand{\\Q}{web}');
    write('project/blueprint/src/content.tex', '\\newcommand{\\Q}{entry}');
    expect(loadBlueprintMacros(root, 'blueprint/src/content.tex')).toEqual({ Q: 'entry' });
  });

  it('merges common, web and the entrypoint', () => {
    const clone = path.join(tmp, 'clone');
    write('clone/blueprint/src/macros/common.tex', '\\newcommand{\\Q}{\\mathbb{Q}}\n\\newcommand{\\Z}{\\mathbb{Z}}');
    write('clone/blueprint/src/macros/web.tex', '\\newcommand{\\Z}{\\mathbb{Zee}}');
    write('clone/blueprint/src/content.tex', '\\newcommand{\\extra}{\\alpha}');
    expect(loadBlueprintMacros(clone, 'blueprint/src/content.tex')).toEqual({
      Q: '\\mathbb{Q}',
      Z: '\\mathbb{Zee}',
      extra: '\\alpha',
    });
  });

  it('finds the singular macro directory', () => {
    const clone = path.join(tmp, 'clone');
    write('clone/blueprint/src/macro/common.tex', '\\newcommand{\\Q}{\\mathbb{Q}}');
    write('clone/blueprint/src/content.tex', '');
    expect(loadBlueprintMacros(clone, 'blueprint/src/content.tex')).toEqual({ Q: '\\mathbb{Q}' });
  });

  it('tolerates missing macro files and a bare clone', () => {
    const clone = path.join(tmp, 'clone');
    write('clone/blueprint/src/content.tex', '\\newcommand{\\foo}{\\bar}');
    expect(loadBlueprintMacros(clone, 'blueprint/src/content.tex')).toEqual({ foo: '\\bar' });
    const bare = path.join(tmp, 'bare');
    fs.mkdirSync(bare);
    expect(loadBlueprintMacros(bare, 'blueprint/src/content.tex')).toEqual({});
  });

  it('does not read outside the project and tolerates a broken reader', () => {
    const root = path.join(tmp, 'project');
    fs.mkdirSync(root);
    write('outside.tex', '\\chapter{Outside}\\newcommand{\\bad}{bad}');
    expect(loadBlueprintMacros(root, '../outside.tex')).toEqual({});
    expect(loadChapterTitles(root, ['../outside.tex'])).toEqual({});
    const brokenReader = (): string | null => {
      throw new Error('unavailable');
    };
    expect(loadBlueprintMacros(root, 'main.tex', brokenReader)).toEqual({});
    expect(loadChapterTitles(root, ['main.tex'], brokenReader)).toEqual({});
  });

  it('reads the entrypoint at the repository root', () => {
    write('content.tex', '\\newcommand{\\foo}{\\bar}');
    write('macros/common.tex', '\\newcommand{\\Q}{\\mathbb{Q}}');
    expect(loadBlueprintMacros(tmp, 'content.tex')).toEqual({ Q: '\\mathbb{Q}', foo: '\\bar' });
  });
});

describe('chapter headings', () => {
  it.each([
    ['\\chapter{Introduction}', 'Introduction', null],
    ['\\chapter*{Preface}', 'Preface', null],
    ['\\section{Article}', 'Article', null],
    ['\\subsection{Detail}', null, null],
    ['\\chapter{Main}\\label{ch:main}', 'Main', 'ch:main'],
    ['\\section{Front}\n\\chapter{Main}', 'Main', null],
    ['\\chapter{Miniproject: Frobenius elements}\\label{Frob}', 'Miniproject: Frobenius elements', 'Frob'],
    ['\\chapter{Galois \\(\\ell\\)-representations}', 'Galois \\(\\ell\\)-representations', null],
    ['\\chapter{One {nested}}\\label{ch:one}', 'One {nested}', 'ch:one'],
    ['\\chapter{Overview}\n  \\label{ch_overview}', 'Overview', 'ch_overview'],
    ['\\section{Overview}\\label{sec:overview}', 'Overview', null],
    ['\\section*{Notation}', 'Notation', null],
    ['\\chapter{Just a Title}', 'Just a Title', null],
    ['\\chapter nope', null, null],
    ['% \\chapter{commented}', null, null],
    ['just some prose, no chapter command', null, null],
  ])('extracts from %s', (source, title, label) => {
    expect(extractChapterTitle(source)).toBe(title);
    expect(extractChapterLabel(source)).toBe(label);
  });

  it('prefers a chapter over a leading section', () => {
    expect(extractChapterTitle('\\section{Front}\\chapter*{Main}')).toBe('Main');
  });

  it('loads titles and references from files', () => {
    const root = path.join(tmp, 'project');
    write('project/chapters/one.tex', '\\chapter{One {nested}}\\label{ch:one}');
    write('project/chapters/two.tex', '\\section*{Two}');
    expect(loadChapterTitles(root, ['chapters/one.tex', 'chapters/two.tex'])).toEqual({
      'chapters/one.tex': 'One {nested}',
      'chapters/two.tex': 'Two',
    });
    expect(loadChapterReferences(root, ['chapters/one.tex', 'chapters/two.tex'])).toEqual({ 'ch:one': '1' });
  });

  it('numbers labelled chapters in order and skips files without a heading', () => {
    const clone = path.join(tmp, 'clone');
    write('clone/chapter/intro.tex', '\\chapter{Intro}\\label{ch_intro}');
    write('clone/chapter/biblio.tex', 'no chapter heading here');
    write('clone/chapter/two.tex', '\\chapter{Reductions}\\label{ch_reductions}');
    write('clone/chapter/three.tex', '\\chapter{Overview}\\label{ch_overview}');
    expect(loadChapterReferences(clone, ['chapter/intro.tex', 'chapter/two.tex', 'chapter/three.tex'])).toEqual({
      ch_intro: '1',
      ch_reductions: '2',
      ch_overview: '3',
    });
    expect(loadChapterReferences(clone, ['chapter/intro.tex', 'chapter/biblio.tex', 'chapter/three.tex'])).toEqual({
      ch_intro: '1',
      ch_overview: '2',
    });
    expect(loadChapterTitles(clone, ['chapter/intro.tex', 'chapter/biblio.tex'])).toEqual({ 'chapter/intro.tex': 'Intro' });
  });

  it('reads the fixture chapters', () => {
    const fixture = path.resolve(__dirname, '../../../../../fixtures/sample-blueprint');
    const chapters = ['blueprint/src/content.tex', 'blueprint/src/chapters/doubling.tex', 'blueprint/src/chapters/squares.tex'];
    expect(loadChapterTitles(fixture, chapters)).toEqual({
      'blueprint/src/content.tex': 'Introduction',
      'blueprint/src/chapters/doubling.tex': 'Doubling',
      'blueprint/src/chapters/squares.tex': 'Squares',
    });
    expect(loadChapterReferences(fixture, chapters)).toEqual({ 'chap:intro': '1', 'chap:doubling': '2', 'chap:squares': '3' });
  });
});
