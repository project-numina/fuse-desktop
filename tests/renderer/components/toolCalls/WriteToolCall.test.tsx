import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@codemirror/view', () => ({
  EditorView: Object.assign(vi.fn().mockImplementation(function EditorView() { return { destroy: vi.fn() }; }), {
    theme: vi.fn(() => []), editable: { of: vi.fn(() => []) }, lineWrapping: [],
  }),
  lineNumbers: vi.fn(() => []),
}));
vi.mock('@codemirror/state', () => ({ EditorState: { create: vi.fn(() => ({})), readOnly: { of: vi.fn(() => []) } } }));
vi.mock('@/lib/latex-language', () => ({ latex: vi.fn(() => []) }));
vi.mock('@/lib/editor-theme', () => ({ editorTheme: [], latexHighlighting: [], latexStructuralHighlighting: [] }));

import { WriteToolCall } from '@/components/toolCalls/WriteToolCall';

describe('WriteToolCall', () => {
  it('shows filename and fallback content line count', () => {
    render(<WriteToolCall rawInput={{ file_path: '/tmp/Foo.lean', content: 'one\ntwo\n' }} />);
    expect(screen.getByText('Foo.lean')).toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
  });
  it('prefers authoritative line metadata for truncated previews', () => {
    render(<WriteToolCall rawInput={{ path: '/tmp/Foo.tex', new_string: 'preview...', _fuse_display: { line_counts: { new_string: 309 } } }} />);
    expect(screen.getByText('+309')).toBeInTheDocument();
  });
  it('does not show a count or preview for empty writes', () => {
    const { container } = render(<WriteToolCall rawInput={{ file_path: '/tmp/Foo.lean' }} />);
    expect(container.textContent).toBe('WriteFoo.lean');
    expect(container.querySelectorAll('div')).toHaveLength(2);
  });
  it('opens a written workspace file from its filename', () => {
    const onOpenFile = vi.fn();
    render(
      <WriteToolCall
        rawInput={{ file_path: '/repo/lean/kakeya/NewProof.lean', content: 'example : True := by trivial' }}
        availableFilePaths={['lean/kakeya/NewProof.lean']}
        onOpenFile={onOpenFile}
      />,
    );

    const reference = screen.getByRole('button', {
      name: 'Open lean/kakeya/NewProof.lean',
    });
    fireEvent.click(reference);
    expect(onOpenFile).toHaveBeenCalledWith('lean/kakeya/NewProof.lean');
  });
  it('keeps the full agent path as a tooltip when the file is unavailable', () => {
    render(<WriteToolCall rawInput={{ file_path: '/tmp/Foo.lean' }} />);
    expect(screen.getByText('Foo.lean')).toHaveAttribute('title', '/tmp/Foo.lean');
  });
});
