import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import HomeMode from '@/features/blueprint/components/HomeMode';
import type { ChapterDescriptor } from '@/features/blueprint/hooks/chapter';

const chapters: ChapterDescriptor[] = Array.from({ length: 24 }, (_, index) => ({
  path: `blueprint/src/GWZAdapted/section_${index}.tex`,
  label: `GWZAdapted/section_${index}.tex`,
  isEntrypoint: false,
}));

describe('HomeMode', () => {
  it('uses kind-aware labels without changing terminal styling', () => {
    const definition = {
      kind: 'definition',
      label: 'def:complete',
      title: 'Complete definition',
      statement: 'A definition.',
      proof: null,
      status: 'proved',
    };
    const theorem = {
      kind: 'theorem',
      label: 'thm:complete',
      title: 'Complete theorem',
      statement: 'A theorem.',
      proof: 'A proof.',
      status: 'proved',
    };
    const lemma = {
      kind: 'lemma',
      label: 'lem:pending',
      title: 'Pending lemma',
      statement: 'A lemma.',
      proof: null,
      status: 'in_progress',
    };
    const { container } = render(
      <HomeMode
        blueprint={{
          name: 'Status semantics',
          blueprint_content: '\\begin{definition}\\label{def:complete}'
            + 'A definition.\\end{definition}\n'
            + '\\begin{theorem}\\label{thm:complete}A theorem.\\end{theorem}\n'
            + '\\begin{proof}A proof.\\end{proof}\n'
            + '\\begin{lemma}\\label{lem:pending}A lemma.\\end{lemma}',
          entries: [definition, theorem, lemma],
        }}
        entries={[definition, theorem, lemma]}
      />,
    );

    const definitionBadge = container
      .querySelector('[data-decl-label="def:complete"] .doc-decl-status');
    const theoremBadge = container
      .querySelector('[data-decl-label="thm:complete"] .doc-decl-status');
    const lemmaBadge = container
      .querySelector('[data-decl-label="lem:pending"] .doc-decl-status');
    expect(definitionBadge).toHaveTextContent('Formalized');
    expect(definitionBadge).toHaveClass('status-proved');
    expect(theoremBadge).toHaveTextContent('Proved');
    expect(theoremBadge).toHaveClass('status-proved');
    expect(lemmaBadge).toHaveTextContent('Formalized');
    expect(lemmaBadge).toHaveClass('status-formalized');
  });

  it('moves the Uses disclosure immediately after the following Proof', () => {
    const { container } = render(
      <HomeMode
        blueprint={{
          name: 'Blueprint editor',
          blueprint_content: '\\begin{note}\n'
            + '\\begin{lemma}[Volume]\\label{lem:plankFVolumeAlg}'
            + '\\lean{Kakeya.plankFVolumeAlg}\\uses{lem:plankFGenKFAlg}'
            + 'A statement.\\end{lemma}\n'
            + '\\begin{proof}A proof.\\end{proof}\n'
            + '\\end{note}',
          entries: [{
            kind: 'lemma',
            label: 'lem:plankFVolumeAlg',
            title: 'Volume',
            statement: 'A statement.',
          }],
        }}
        entries={[{
          kind: 'lemma',
          label: 'lem:plankFVolumeAlg',
          title: 'Volume',
          statement: 'A statement.',
        }]}
      />,
    );

    const proof = container.querySelector('.doc-proof');
    const uses = container.querySelector('.doc-decl-uses');
    expect(proof).not.toBeNull();
    expect(uses).not.toBeNull();
    expect(proof?.nextElementSibling).toBe(uses);
  });

  it('renders a resolved Lean target with the same link state used by clicks', () => {
    const onOpenLeanFile = vi.fn();
    const entry = {
      kind: 'lemma',
      label: 'lem:densityEnlarge',
      title: 'Density under enlargement',
      statement: 'A statement.',
      lean_file: 'lean/kakeya/Kakeya/ConvexNet.lean',
      lean_line: 98,
    };
    const { container } = render(
      <HomeMode
        blueprint={{
          entries: [entry],
          blueprint_content: '\\begin{lemma}\\label{lem:densityEnlarge}'
            + '\\lean{Kakeya.densityIn_le_of_le_of_volume_le}'
            + 'A statement.\\end{lemma}',
        }}
        entries={[entry]}
        onOpenLeanFile={onOpenLeanFile}
      />,
    );

    const leanName = container.querySelector('.doc-decl-lean');
    expect(leanName).toHaveClass('is-linked');
    expect(leanName).toHaveAttribute('role', 'link');
    expect(leanName).toHaveAttribute('tabindex', '0');

    fireEvent.click(leanName!);
    expect(onOpenLeanFile).toHaveBeenCalledWith(
      'lean/kakeya/Kakeya/ConvexNet.lean',
      98,
    );
  });

  it('renders active prose without duplicating the floating chapter navigation', () => {
    const { container } = render(
      <HomeMode
        blueprint={{ name: 'Blueprint editor' }}
        entries={[
          {
            kind: 'lemma',
            label: 'lemmafactmax',
            title: 'Maximal density factoring lemma',
            statement: 'Let V be a finite family of convex subsets.',
          },
        ]}
        hasMultipleChapters
        chapters={chapters}
        activeChapterPath={chapters[4].path}
        chapterContent={'\\section{Organizing convex sets}\n\nThe active chapter is visible.'}
        onSelectChapter={() => {}}
      />,
    );

    expect(container.firstElementChild).toHaveClass('w-full');
    expect(screen.queryByRole('navigation', { name: 'Blueprint chapters' })).not.toBeInTheDocument();
    const documentBody = container.querySelector('.doc-body');
    expect(documentBody).not.toHaveClass('prose-bubble');
    expect(documentBody).not.toHaveClass('blueprint-prose');
    expect(screen.getByRole('heading', { name: 'Organizing convex sets' })).toBeVisible();
    expect(screen.getByText('The active chapter is visible.')).toBeVisible();
  });

  it('shows the chapter file and resolves declaration references to section.item numbers', () => {
    const active = chapters[4];
    const { container } = render(
      <HomeMode
        blueprint={{
          name: 'Blueprint editor',
          entries: [{
            kind: 'lemma',
            label: 'lem:active',
            title: 'Active lemma',
            statement: 'A statement.',
            source_file: active.path,
          }],
        }}
        entries={[{
          kind: 'lemma',
          label: 'lem:active',
          title: 'Active lemma',
          statement: 'A statement.',
          source_file: active.path,
        }]}
        hasMultipleChapters
        chapters={chapters}
        activeChapterPath={active.path}
        chapterContent={'\\section{Active}\\label{sec:active}\n'
          + '\\begin{lemma}\\label{lem:active}A statement.\\end{lemma}\n'
          + 'See \\ref{lem:active}.'}
      />,
    );

    expect(screen.getByText(active.label)).toHaveClass('doc-chapter-file');
    expect(container.querySelector('[data-uses-ref="lem:active"]')).toHaveTextContent('4.1');
    expect(container.querySelector('.doc-body')).toHaveStyle({
      counterReset: 'doc-section 4 doc-item 0 doc-subsection 0 doc-subsubsection 0',
    });
  });

  it('switches chapters when a document reference points to another file', () => {
    const onSelectChapter = vi.fn();
    const first = chapters[1];
    const second = chapters[2];
    const { container } = render(
      <HomeMode
        blueprint={{
          name: 'Blueprint editor',
          entries: [{
            kind: 'lemma', label: 'lem:first', title: 'First', statement: 'First.',
            source_file: first.path,
          }],
          chapter_contents: {
            [second.path]: '\\section{Target}\\label{sec:target}',
          },
        }}
        entries={[{
          kind: 'lemma', label: 'lem:first', title: 'First', statement: 'First.',
          source_file: first.path,
        }]}
        hasMultipleChapters
        chapters={chapters}
        activeChapterPath={first.path}
        chapterContent={'\\section{First}\nSee \\ref{sec:target}.'}
        onSelectChapter={onSelectChapter}
      />,
    );

    fireEvent.click(container.querySelector('[data-doc-ref="sec:target"]')!);
    expect(onSelectChapter).toHaveBeenCalledWith(second.path);
  });

  it('uses server entries when the active entrypoint parser is empty and auto-advances', async () => {
    const entrypoint: ChapterDescriptor = {
      path: 'blueprint/src/content.tex', label: 'content.tex', isEntrypoint: true,
    };
    const content: ChapterDescriptor = {
      path: 'blueprint/src/chapter/main.tex', label: 'chapter/main.tex', isEntrypoint: false,
    };
    const onAutoSelectChapter = vi.fn();
    render(
      <HomeMode
        blueprint={{
          name: 'Imported blueprint',
          blueprint_content: '\\input{chapter/main}',
          entries: [{
            kind: 'lemma', label: 'lem:main', title: 'Main', statement: 'Main.',
            source_file: content.path,
          }],
        }}
        entries={[]}
        hasMultipleChapters
        chapters={[entrypoint, content]}
        activeChapterPath={entrypoint.path}
        chapterContent={'\\input{chapter/main}'}
        onAutoSelectChapter={onAutoSelectChapter}
      />,
    );

    expect(screen.queryByText('No declarations yet')).not.toBeInTheDocument();
    await waitFor(() => expect(onAutoSelectChapter).toHaveBeenCalledWith(content.path));
  });

  it('writes a shareable fragment when a numbered declaration reference is clicked', () => {
    window.history.replaceState({}, '', '/blueprint');
    const active = chapters[1];
    const { container } = render(
      <HomeMode
        blueprint={{
          entries: [{
            kind: 'lemma', label: 'lem:target', title: 'Target', statement: 'Target.',
            source_file: active.path,
          }],
        }}
        entries={[]}
        hasMultipleChapters
        chapters={chapters}
        activeChapterPath={active.path}
        chapterContent={'\\section{First}\n'
          + '\\begin{lemma}\\label{lem:target}Target.\\end{lemma}\n'
          + 'See \\ref{lem:target}.'}
      />,
    );

    fireEvent.click(container.querySelector('[data-uses-ref="lem:target"]')!);
    expect(window.location.hash).toBe('#1.1');
  });

  it('retries a deep-link fragment after declaration metadata arrives', async () => {
    const previousScrollIntoView = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView',
    );
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const entry = {
      kind: 'lemma',
      label: 'lem:late',
      title: 'Late metadata',
      statement: 'Target.',
    };
    const source = '\\begin{lemma}\\label{lem:late}Target.\\end{lemma}';

    try {
      const view = render(
        <HomeMode
          blueprint={{ blueprint_content: source, entries: [] }}
          entries={[]}
          currentHash="#1.1"
        />,
      );
      expect(scrollIntoView).not.toHaveBeenCalled();

      view.rerender(
        <HomeMode
          blueprint={{ blueprint_content: source, entries: [entry] }}
          entries={[]}
          currentHash="#1.1"
        />,
      );

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    } finally {
      if (previousScrollIntoView) {
        Object.defineProperty(
          HTMLElement.prototype,
          'scrollIntoView',
          previousScrollIntoView,
        );
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
      }
    }
  });

  it('retries a document fragment after chapter text arrives', async () => {
    const previousScrollIntoView = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView',
    );
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const entry = {
      kind: 'lemma',
      label: 'lem:placeholder',
      title: 'Placeholder',
      statement: 'Placeholder.',
    };

    try {
      const view = render(
        <HomeMode
          blueprint={{ blueprint_content: 'Waiting.', entries: [entry] }}
          entries={[]}
          currentHash="#sec-late"
        />,
      );
      expect(scrollIntoView).not.toHaveBeenCalled();

      view.rerender(
        <HomeMode
          blueprint={{
            blueprint_content: '\\section{Late}\\label{late}',
            entries: [entry],
          }}
          entries={[]}
          currentHash="#sec-late"
        />,
      );

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    } finally {
      if (previousScrollIntoView) {
        Object.defineProperty(
          HTMLElement.prototype,
          'scrollIntoView',
          previousScrollIntoView,
        );
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
      }
    }
  });
});
