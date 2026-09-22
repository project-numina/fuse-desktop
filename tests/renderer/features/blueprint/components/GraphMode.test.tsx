import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import GraphMode from '@/features/blueprint/components/GraphMode';
import type { ParsedEntry } from '@/features/blueprint/lib/chapter-entries';

const mocks = vi.hoisted(() => ({
  fit: vi.fn(),
  layout: vi.fn(),
  onCanvasMouseDown: vi.fn(),
  onWheel: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
}));

vi.mock('@/features/blueprint/components/graph/use-pan-zoom', () => ({
  usePanZoom: () => ({
    fit: mocks.fit,
    zoomIn: mocks.zoomIn,
    zoomOut: mocks.zoomOut,
    onCanvasMouseDown: mocks.onCanvasMouseDown,
    onWheel: mocks.onWheel,
  }),
}));

vi.mock('elkjs/lib/elk.bundled.js', () => ({
  default: class MockElk {
    layout = mocks.layout;
  },
}));

vi.mock('@/features/blueprint/components/SectionSelector', () => ({
  default: ({ onSelect }: { onSelect: (path: string) => void }) => (
    <button type="button" onClick={() => onSelect('chapter-two.tex')}>
      Choose chapter two
    </button>
  ),
}));

const entries: ParsedEntry[] = [
  {
    kind: 'definition',
    label: 'def:base',
    title: 'Base definition',
    uses: [],
    status: 'in_progress',
    leanName: 'Example.base',
  },
  {
    kind: 'theorem',
    label: 'thm:result',
    title: 'Main result',
    uses: ['def:base'],
    status: 'proved',
    leanName: 'Example.result',
    isExternal: true,
  },
];

beforeAll(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('ResizeObserver', class ResizeObserverMock {
    observe() {}
    disconnect() {}
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.layout.mockResolvedValue({
    width: 360,
    height: 240,
    children: [
      { id: 'def:base', x: 20, y: 20, width: 208, height: 80 },
      { id: 'thm:result', x: 20, y: 140, width: 208, height: 80 },
    ],
    edges: [{
      sources: ['def:base'],
      targets: ['thm:result'],
      sections: [{
        startPoint: { x: 124, y: 100 },
        endPoint: { x: 124, y: 140 },
      }],
    }],
  });
});

describe('GraphMode', () => {
  it('shows the empty-state guidance without graph controls', () => {
    render(<GraphMode parsedEntries={[]} />);

    expect(screen.getByText('No declarations yet')).toBeVisible();
    expect(screen.getByText(/dependency graph/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Zoom in' })).not.toBeInTheDocument();
    expect(mocks.layout).not.toHaveBeenCalled();
  });

  it('lays out declarations, statuses, external nodes, and dependency edges', async () => {
    const { container } = render(<GraphMode parsedEntries={entries} latexMacros={{ RR: '\\mathbb{R}' }} />);

    await waitFor(() => expect(container.querySelectorAll('[title]').length).toBe(2));
    expect(screen.getAllByText('Base definition')).toHaveLength(2);
    expect(screen.getAllByText('Main result')).toHaveLength(2);
    expect(container.querySelector('[title="Definition — Formalized"]')).toBeInTheDocument();
    expect(container.querySelector(
      '[title="Theorem — Complete — from another chapter"]',
    )).toHaveClass('border-dashed');
    const edgePath = container.querySelector('path[marker-end="url(#graph-arrow)"]');
    expect(edgePath).toBeInTheDocument();
    expect(edgePath?.closest('svg')?.parentElement).toHaveStyle({
      width: '360px',
      height: '240px',
    });
  });

  it('forwards zoom, fit, canvas, wheel, and chapter-selection interactions', async () => {
    const onSelectChapter = vi.fn();
    const { container } = render(
      <GraphMode
        parsedEntries={entries}
        activeChapterPath="chapter-one.tex"
        chapters={[
          { path: 'chapter-one.tex', label: 'Chapter one', isEntrypoint: false },
          { path: 'chapter-two.tex', label: 'Chapter two', isEntrypoint: false },
        ]}
        onSelectChapter={onSelectChapter}
      />,
    );
    await waitFor(() => expect(container.querySelector('[title="Definition — Formalized"]'))
      .toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fit graph to view' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose chapter two' }));
    const canvas = container.querySelector('.cursor-grab')!;
    fireEvent.mouseDown(canvas);
    fireEvent.wheel(canvas);

    expect(mocks.zoomOut).toHaveBeenCalledOnce();
    expect(mocks.zoomIn).toHaveBeenCalledOnce();
    expect(mocks.fit).toHaveBeenCalled();
    expect(mocks.onCanvasMouseDown).toHaveBeenCalledOnce();
    expect(mocks.onWheel).toHaveBeenCalledOnce();
    expect(onSelectChapter).toHaveBeenCalledWith('chapter-two.tex');
  });

  it('defers ELK while hidden, catches up on activation, and omits optional controls', async () => {
    const { container, rerender } = render(
      <GraphMode parsedEntries={entries} isActive={false} showControls={false} />,
    );

    expect(mocks.layout).not.toHaveBeenCalled();
    expect(container.querySelector('.graph-toolbar')).not.toBeInTheDocument();
    expect(container.querySelector('[data-node-label]')).not.toBeInTheDocument();

    rerender(<GraphMode parsedEntries={entries} isActive showControls={false} />);
    await waitFor(() => expect(mocks.layout).toHaveBeenCalledOnce());
    expect(container.querySelector('[title="Definition — Formalized"]')).toBeInTheDocument();
  });
});
