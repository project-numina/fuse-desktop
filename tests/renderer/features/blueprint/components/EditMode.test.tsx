import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import EditMode, { type EditModeProps } from '@/features/blueprint/components/EditMode';
import type { Collaboration } from '@/features/blueprint/hooks/use-collaboration';

const mocks = vi.hoisted(() => ({
  requestMeasure: vi.fn(),
  scheduleLayout: vi.fn(),
  scheduleLayoutBurst: vi.fn(),
  schedulePositionRefresh: vi.fn(),
  useCodeMirror: vi.fn(),
}));

vi.mock('@/hooks/use-code-mirror', () => ({
  useCodeMirror: mocks.useCodeMirror,
}));

vi.mock('@/features/blueprint/hooks/card-positioning', async () => {
  const actual = await vi.importActual<
    typeof import('@/features/blueprint/hooks/card-positioning')
  >('@/features/blueprint/hooks/card-positioning');
  return {
    ...actual,
    useCardPositioning: () => ({
      cardTopByDeclKey: { 'lemma:one#0': 42 },
      layoutReady: true,
      scheduleLayout: mocks.scheduleLayout,
      scheduleLayoutBurst: mocks.scheduleLayoutBurst,
      schedulePositionRefresh: mocks.schedulePositionRefresh,
    }),
  };
});

const entry = {
  kind: 'lemma',
  label: 'lemma:one',
  title: 'First lemma',
  statement: 'Every $x$ is equal to itself.',
  proof: 'By reflexivity.',
  leanName: 'Example.first',
  leanFile: 'Example.lean',
  uses: ['definition:zero'],
  status: 'proved',
};

function makeProps(overrides: Partial<EditModeProps> = {}): EditModeProps {
  return {
    blueprint: {
      id: 'sample',
      blueprint_file: 'blueprint.tex',
      entries: [entry],
    },
    collaboration: null,
    latexSource: '\\begin{lemma}First lemma\\end{lemma}',
    latexSegments: [],
    onSourceChange: vi.fn(),
    chapter: {
      chapters: [{
        path: 'chapters/intro.tex',
        label: 'chapters/intro.tex',
        title: 'Introduction',
        isEntrypoint: false,
      }],
      hasMultipleChapters: false,
      activeChapterPath: 'chapters/intro.tex',
      saveActiveChapter: vi.fn().mockResolvedValue(undefined),
    },
    context: { owner: 'local', repo: 'sample', blueprintId: 'sample' },
    showCards: true,
    onShowCardsChange: vi.fn(),
    active: true,
    ...overrides,
  };
}

function makeCollaboration(): Collaboration {
  const doc = new Y.Doc();
  return {
    doc,
    text: doc.getText('codemirror'),
    awareness: null,
    provider: null,
    connected: false,
    synced: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    destroy: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useCodeMirror.mockReturnValue({ current: { requestMeasure: mocks.requestMeasure } });
});

describe('EditMode', () => {
  it('renders the active file and forwards editor and annotation-toggle state', async () => {
    const props = makeProps({ blueprintReadonly: true });
    render(<EditMode {...props} />);

    expect(screen.getByText('intro.tex')).toBeVisible();
    expect(mocks.useCodeMirror).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        source: props.latexSource,
        onChange: props.onSourceChange,
        readonly: true,
      }),
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Show annotation cards' }));
    expect(props.onShowCardsChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(mocks.requestMeasure).toHaveBeenCalled());
    expect(mocks.scheduleLayoutBurst).toHaveBeenCalledWith([0, 80], true);
  });

  it('renders declaration cards with status, proof, dependencies, and chapter title', async () => {
    const props = makeProps({
      latexSegments: [{
        type: 'decl',
        text: 'lemma source',
        lineStart: 3,
        lineEnd: 7,
        entry,
        declKey: 'lemma:one#0',
      }],
      chapter: {
        ...makeProps().chapter,
        hasMultipleChapters: true,
      },
    });
    const { container } = render(<EditMode {...props} />);

    expect(screen.getByText('Introduction')).toBeVisible();
    expect(screen.getByText('Lemma')).toBeVisible();
    expect(screen.getByText('Proved')).toHaveClass('status-proved');
    expect(screen.getByText('First lemma')).toBeVisible();
    expect(screen.getByText('Proof')).toBeVisible();
    expect(screen.getByText('Uses')).toBeVisible();
    expect(screen.getByText('definition:zero')).toBeInTheDocument();
    expect(container.querySelector('.edit-card-position')).toHaveStyle({ top: '42px' });

    fireEvent.click(screen.getByText('Proof'));
    await waitFor(() => expect(mocks.scheduleLayout).toHaveBeenCalled());
  });

  it('flushes changed source and reports a failed fallback save without losing the edit', async () => {
    const saveActiveChapter = vi.fn().mockRejectedValue(new Error('offline'));
    let flush: (() => Promise<boolean>) | null = null;
    let markClean: ((content: string) => void) | null = null;
    const setPending = vi.fn();
    const props = makeProps({
      chapter: { ...makeProps().chapter, saveActiveChapter },
      editSaveState: {
        setPending,
        setFlush: (callback) => { flush = callback; },
        setCleanMarker: (callback) => { markClean = callback; },
      },
    });
    const { rerender } = render(<EditMode {...props} />);

    rerender(<EditMode {...props} latexSource="changed source" />);
    await waitFor(() => expect(setPending).toHaveBeenCalledWith(true));
    expect(flush).not.toBeNull();

    let result = true;
    await act(async () => {
      result = await flush!();
    });

    expect(result).toBe(false);
    expect(saveActiveChapter).toHaveBeenCalledWith('changed source', 'chapters/intro.tex');
    expect(screen.getByText(/Could not save this chapter/)).toHaveTextContent(
      'Could not save this chapter. Your edits are still in the editor.',
    );

    act(() => markClean?.('changed source'));
  });

  it('lets Yjs own collaborative content and remounts for a new document', () => {
    const first = makeCollaboration();
    const second = makeCollaboration();
    const props = makeProps({ collaboration: first });
    const { rerender } = render(<EditMode {...props} />);

    expect(mocks.useCodeMirror).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ source: undefined }),
    );
    rerender(<EditMode {...props} collaboration={second} />);
    expect(mocks.useCodeMirror).toHaveBeenCalledTimes(2);
  });
});
