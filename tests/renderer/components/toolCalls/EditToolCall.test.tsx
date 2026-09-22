import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@codemirror/view', () => ({ EditorView: Object.assign(vi.fn().mockImplementation(function EditorView() { return { destroy: vi.fn() }; }), { theme: vi.fn(() => []), editable: { of: vi.fn(() => []) }, lineWrapping: [] }) }));
vi.mock('@codemirror/state', () => ({ EditorState: { readOnly: { of: vi.fn(() => []) } } }));
// `unifiedMergeView` is stubbed because the editor never mounts here, but
// `presentableDiff` stays real: it is what produces the +/- counts under test.
vi.mock('@codemirror/merge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@codemirror/merge')>()),
  unifiedMergeView: vi.fn(() => []),
}));
vi.mock('@/lib/latex-language', () => ({ latex: vi.fn(() => []) }));
vi.mock('@/lib/editor-theme', () => ({ editorTheme: [], latexHighlighting: [], latexStructuralHighlighting: [] }));

import { EditToolCall } from '@/components/toolCalls/EditToolCall';

describe('EditToolCall', () => {
  it('shows added and removed counts', () => {
    render(<EditToolCall rawInput={{ file_path: '/repo/Proof.lean', old_string: 'sorry', new_string: 'by\n  trivial' }} />);
    expect(screen.getByText('Proof.lean')).toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();
  });
  it('counts the diff rather than the size of the two strings', () => {
    // Ten lines of context carried along so the Edit can find its anchor, one
    // line actually rewritten. Measuring the strings would read +11 -11.
    const context = Array.from({ length: 10 }, (_, i) => `  line ${i}`).join('\n');
    render(
      <EditToolCall
        rawInput={{
          file_path: '/repo/Proof.lean',
          old_string: `${context}\n  linarith`,
          new_string: `${context}\n  positivity`,
        }}
      />,
    );
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();
  });
  it('ignores backend line-count metadata, which measures the strings', () => {
    render(<EditToolCall rawInput={{ file_path: '/repo/Proof.lean', old_string: 'one\ntwo', new_string: 'one\nTWO', _fuse_display: { line_counts: { old_string: 250, new_string: 309 } } }} />);
    expect(screen.queryByText('+309')).not.toBeInTheDocument();
    expect(screen.queryByText('-250')).not.toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();
  });
  it('omits diff counts for an empty edit', () => {
    render(<EditToolCall rawInput={{ file_path: '/repo/Proof.lean' }} />);
    expect(screen.queryByText(/^[-+]\d/)).not.toBeInTheDocument();
  });
  it('opens an edited workspace file from its filename', () => {
    const onOpenFile = vi.fn();
    render(
      <EditToolCall
        rawInput={{ file_path: '/repo/lean/kakeya/test_enorm.lean' }}
        availableFilePaths={['lean/kakeya/test_enorm.lean']}
        onOpenFile={onOpenFile}
      />,
    );

    const reference = screen.getByRole('button', {
      name: 'Open lean/kakeya/test_enorm.lean',
    });
    fireEvent.click(reference);
    expect(onOpenFile).toHaveBeenCalledWith('lean/kakeya/test_enorm.lean');
  });
  it('opens a MultiEdit workspace file supplied through path', () => {
    const onOpenFile = vi.fn();
    render(
      <EditToolCall
        rawInput={{ path: '/repo/lean/kakeya/test_enorm.lean' }}
        availableFilePaths={['lean/kakeya/test_enorm.lean']}
        onOpenFile={onOpenFile}
      />,
    );

    fireEvent.click(screen.getByRole('button', {
      name: 'Open lean/kakeya/test_enorm.lean',
    }));
    expect(onOpenFile).toHaveBeenCalledWith('lean/kakeya/test_enorm.lean');
  });
  it('keeps the full agent path as a tooltip when the file is unavailable', () => {
    render(<EditToolCall rawInput={{ file_path: '/repo/Proof.lean' }} />);
    expect(screen.getByText('Proof.lean')).toHaveAttribute('title', '/repo/Proof.lean');
  });
});
