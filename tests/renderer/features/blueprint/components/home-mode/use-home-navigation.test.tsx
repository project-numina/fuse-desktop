import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HomeModeProps } from '@/features/blueprint/components/HomeMode';
import { useHomeNavigation } from '@/features/blueprint/components/home-mode/use-home-navigation';

const scrollIntoView = vi.fn();
let previousScrollIntoView: PropertyDescriptor | undefined;

function documentModel(overrides: Record<string, unknown> = {}) {
  return {
    renderedBody: '',
    documentIndex: { references: {}, chapterByLabel: {} },
    declarationReferences: {},
    declarationLabelByNumber: new Map(),
    leanTargetByLabel: new Map(),
    ...overrides,
  } as never;
}

function NavigationHarness({
  props,
  model,
  children,
}: {
  props: HomeModeProps;
  model: ReturnType<typeof documentModel>;
  children: React.ReactNode;
}) {
  const navigation = useHomeNavigation(props, model);
  return (
    <div
      ref={navigation.docBodyRef}
      onClick={navigation.handleBodyClick}
      onKeyDown={navigation.handleBodyKeyDown}
    >
      {children}
    </div>
  );
}

beforeEach(() => {
  window.history.replaceState({}, '', '/blueprint');
  previousScrollIntoView = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollIntoView',
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  });
});

afterEach(() => {
  scrollIntoView.mockReset();
  if (previousScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', previousScrollIntoView);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});

describe('useHomeNavigation', () => {
  it('delegates clicks on resolved Lean names to the file workspace', () => {
    const onOpenLeanFile = vi.fn();
    const props: HomeModeProps = { blueprint: { entries: [] }, onOpenLeanFile };
    const model = documentModel({
      leanTargetByLabel: new Map([
        ['lem:one', { file: 'Project/Main.lean', line: 14 }],
      ]),
    });

    render(
      <NavigationHarness props={props} model={model}>
        <div data-decl-label="lem:one">
          <button className="doc-decl-lean">Lean.One</button>
        </div>
      </NavigationHarness>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Lean.One' }));
    expect(onOpenLeanFile).toHaveBeenCalledWith('Project/Main.lean', 14);
  });

  it('records the source and pushes the target fragment before scrolling', () => {
    const onNavigateHash = vi.fn();
    const props: HomeModeProps = { blueprint: { entries: [] }, onNavigateHash };
    const model = documentModel({
      declarationReferences: {
        'lem:source': { kind: 'lemma', number: '1.1' },
        'lem:target': { kind: 'lemma', number: '1.2' },
      },
    });

    render(
      <NavigationHarness props={props} model={model}>
        <div data-decl-label="lem:source">
          <button data-uses-ref="lem:target">target</button>
        </div>
        <div data-decl-label="lem:target">Target declaration</div>
      </NavigationHarness>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'target' }));
    expect(onNavigateHash).toHaveBeenNthCalledWith(1, '1.1', true);
    expect(onNavigateHash).toHaveBeenNthCalledWith(2, '1.2', false);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('supports keyboard reference activation and ignores unrelated keys', () => {
    const onNavigateHash = vi.fn();
    const model = documentModel({
      documentIndex: {
        references: { overview: { kind: 'section', number: '2' } },
        chapterByLabel: { overview: '' },
      },
    });
    render(
      <NavigationHarness
        props={{ blueprint: { entries: [] }, onNavigateHash }}
        model={model}
      >
        <button data-doc-ref="overview">Overview</button>
        <div data-doc-anchor="overview">Overview section</div>
      </NavigationHarness>,
    );

    const reference = screen.getByRole('button', { name: 'Overview' });
    fireEvent.keyDown(reference, { key: 'Escape' });
    expect(onNavigateHash).not.toHaveBeenCalled();
    fireEvent.keyDown(reference, { key: 'Enter' });
    expect(onNavigateHash).toHaveBeenCalledWith('sec-overview', false);
    expect(scrollIntoView).toHaveBeenCalledOnce();
  });

  it('finishes a cross-chapter navigation after the selected chapter renders', async () => {
    const onSelectChapter = vi.fn().mockResolvedValue(true);
    const model = documentModel({
      documentIndex: {
        references: { target: { kind: 'section', number: '2' } },
        chapterByLabel: { target: 'target.tex' },
      },
    });
    const view = render(
      <NavigationHarness
        props={{ blueprint: { entries: [] }, activeChapterPath: 'source.tex', onSelectChapter }}
        model={model}
      >
        <button data-doc-ref="target">Target chapter</button>
      </NavigationHarness>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Target chapter' }));
    expect(onSelectChapter).toHaveBeenCalledWith('target.tex');
    view.rerender(
      <NavigationHarness
        props={{ blueprint: { entries: [] }, activeChapterPath: 'target.tex', onSelectChapter }}
        model={model}
      >
        <div data-doc-anchor="target">Target section</div>
      </NavigationHarness>,
    );

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledOnce());
  });

  it('does not retain a pending navigation when chapter selection is rejected', async () => {
    const onSelectChapter = vi.fn().mockResolvedValue(false);
    const model = documentModel({
      documentIndex: {
        references: { target: { kind: 'section', number: '2' } },
        chapterByLabel: { target: 'target.tex' },
      },
    });
    const view = render(
      <NavigationHarness
        props={{ blueprint: { entries: [] }, activeChapterPath: 'source.tex', onSelectChapter }}
        model={model}
      >
        <button data-doc-ref="target">Rejected target</button>
      </NavigationHarness>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Rejected target' }));
    await act(async () => undefined);
    view.rerender(
      <NavigationHarness
        props={{ blueprint: { entries: [] }, activeChapterPath: 'target.tex', onSelectChapter }}
        model={model}
      >
        <div data-doc-anchor="target">Target section</div>
      </NavigationHarness>,
    );
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('retries an unresolved deep link when declaration metadata arrives', async () => {
    const props: HomeModeProps = { blueprint: { entries: [] }, currentHash: '#1.1' };
    const unresolved = documentModel();
    const view = render(
      <NavigationHarness props={props} model={unresolved}>
        <div data-decl-label="lem:late">Late declaration</div>
      </NavigationHarness>,
    );
    expect(scrollIntoView).not.toHaveBeenCalled();

    view.rerender(
      <NavigationHarness
        props={props}
        model={documentModel({ declarationLabelByNumber: new Map([['1.1', 'lem:late']]) })}
      >
        <div data-decl-label="lem:late">Late declaration</div>
      </NavigationHarness>,
    );
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledOnce());
  });

  it('moves declaration Uses metadata after its following proof', () => {
    const { container } = render(
      <NavigationHarness props={{ blueprint: { entries: [] } }} model={documentModel()}>
        <div className="doc-decl">
          <div className="doc-decl-uses">Uses</div>
        </div>
        <br />
        <div className="doc-proof">Proof</div>
      </NavigationHarness>,
    );

    const proof = container.querySelector('.doc-proof');
    const uses = container.querySelector('.doc-decl-uses');
    expect(proof?.nextElementSibling).toBe(uses);
    expect(container.querySelector('br')).toBeNull();
  });
});
