import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/toolCalls/WriteToolCall', () => ({ default: ({ rawInput }: { rawInput: Record<string, unknown> }) => <div>Write {String(rawInput.file_path).split('/').pop()} +{String(rawInput.content).split('\n').length}</div> }));
vi.mock('@/components/toolCalls/EditToolCall', () => ({ default: ({ rawInput }: { rawInput: Record<string, unknown> }) => <div>Edit {String(rawInput.file_path).split('/').pop()}</div> }));

import { ToolCallStep } from '@/components/toolCalls/ToolCallStep';

const renderStep = (tool: string, summary: string, rawInput?: Record<string, unknown>, count?: number) =>
  render(<ToolCallStep tool={tool} summary={summary} rawInput={rawInput} count={count} />);

describe('ToolCallStep', () => {
  it.each([
    ['Read', 'Main.lean', { file_path: '/repo/Main.lean', offset: 10, limit: 20 }, ['Read', 'Main.lean', 'lines 10–29']],
    ['Read', 'Main.lean', { file_path: '/repo/Main.lean', offset: 4 }, ['from line 4']],
    ['Bash', 'build', { command: 'lake build' }, ['Bash', 'lake build']],
    ['Grep', 'theorem', { pattern: 'theorem.*Nat', path: '/repo/src/Mathlib/Data', type: 'lean' }, ['Grep', 'theorem.*Nat', 'src/Mathlib/Data', '(lean)']],
    ['Glob', '**/*.lean', { pattern: '**/*.lean' }, ['Glob', '**/*.lean']],
    ['lean-explore', 'search', { query: 'compact space' }, ['lean-explore', 'search', 'compact space']],
    ['lean-lsp', 'declarations', { name: 'Nat.add_comm' }, ['lean-lsp', 'declarations', 'Nat.add_comm']],
  ])('routes %s to its specialized renderer', (tool, summary, input, labels) => {
    renderStep(tool, summary, input);
    for (const label of labels) expect(screen.getByText(label, { exact: false })).toBeInTheDocument();
  });

  it('routes Write and Edit to their rich renderers', () => {
    const { rerender } = render(<ToolCallStep tool="Write" summary="Foo.lean" rawInput={{ file_path: '/tmp/Foo.lean', content: 'one\ntwo' }} />);
    expect(screen.getByText('Write Foo.lean +2')).toBeInTheDocument();
    rerender(<ToolCallStep tool="Edit" summary="Foo.lean" rawInput={{ file_path: '/tmp/Foo.lean' }} />);
    expect(screen.getByText('Edit Foo.lean')).toBeInTheDocument();
  });

  it('uses the auto-hiding horizontal scroller for Bash commands', () => {
    renderStep('Bash', 'inspect', { command: 'find /workspace -name "*.lean"' });

    expect(screen.getByText('find /workspace -name "*.lean"')).toHaveClass(
      'tool-command-scroll',
    );
  });

  it('falls back for unknown tools and specialized tools without raw input', () => {
    const { rerender } = render(<ToolCallStep tool="SomethingNew" summary="doing work" />);
    expect(screen.getByText('SomethingNew')).toBeInTheDocument();
    expect(screen.getByText('doing work')).toBeInTheDocument();
    rerender(<ToolCallStep tool="Read" summary="Main.lean" />);
    expect(screen.getByText('Main.lean')).toBeInTheDocument();
  });

  it('shows only coalesced counts greater than one', () => {
    const { rerender } = render(<ToolCallStep tool="Read" summary="x" count={1} />);
    expect(screen.queryByText('(1)')).not.toBeInTheDocument();
    rerender(<ToolCallStep tool="Read" summary="x" count={3} />);
    expect(screen.getByText('(3)')).toBeInTheDocument();
  });

  it('strikes through failed tool calls and states the failure for assistive tech', () => {
    const { container } = render(<ToolCallStep tool="Bash" summary="inspect" rawInput={{ command: 'find /data/clones' }} isError errorMessage="outside workspace" />);
    const failedCall = container.querySelector('.line-through');
    expect(failedCall).toHaveAttribute('title', 'outside workspace');
    expect(failedCall).toHaveTextContent('find /data/clones');
    // No visible badge (the strikethrough carries it visually), but the
    // outcome and its reason must not be hover-and-sight-only.
    const status = screen.getByText('Failed: outside workspace');
    expect(status).toHaveClass('sr-only');
    expect(failedCall).not.toContainElement(status);
  });

  it('states a bare failure when the tool reported no error message', () => {
    render(<ToolCallStep tool="Read" summary="Missing.lean" isError />);
    expect(screen.getByText('Failed')).toHaveClass('sr-only');
  });

  it('does not announce a failure for a successful call', () => {
    render(<ToolCallStep tool="Read" summary="Main.lean" />);
    expect(screen.queryByText(/^Failed/)).not.toBeInTheDocument();
  });

  it('opens a readable workspace file at the first line in the read range', () => {
    const onOpenFile = vi.fn();
    render(
      <ToolCallStep
        tool="Read"
        summary="Cordoba.lean"
        rawInput={{
          file_path: '/data/clones/project/lean/geometry/Cordoba.lean',
          offset: 193,
          limit: 130,
        }}
        availableFilePaths={['lean/geometry/Cordoba.lean']}
        onOpenFile={onOpenFile}
      />,
    );

    const reference = screen.getByRole('button', {
      name: 'Open lean/geometry/Cordoba.lean at line 193',
    });
    fireEvent.click(reference);
    expect(onOpenFile).toHaveBeenCalledWith('lean/geometry/Cordoba.lean', 193);
  });

  it('opens a read file without inventing a jump line when no offset is present', () => {
    const onOpenFile = vi.fn();
    render(
      <ToolCallStep
        tool="Read"
        summary="Cordoba.lean"
        rawInput={{ file_path: '/repo/lean/geometry/Cordoba.lean' }}
        availableFilePaths={['lean/geometry/Cordoba.lean']}
        onOpenFile={onOpenFile}
      />,
    );

    fireEvent.click(screen.getByRole('button', {
      name: 'Open lean/geometry/Cordoba.lean',
    }));
    expect(onOpenFile).toHaveBeenCalledWith('lean/geometry/Cordoba.lean');
  });

  it('leaves unavailable and failed read references non-clickable', () => {
    const onOpenFile = vi.fn();
    const { rerender } = render(
      <ToolCallStep
        tool="Read"
        summary="Notes.md"
        rawInput={{ file_path: '/tmp/Notes.md', offset: 4 }}
        availableFilePaths={['Main.lean']}
        onOpenFile={onOpenFile}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Notes.md')).toHaveAttribute('title', '/tmp/Notes.md');

    rerender(
      <ToolCallStep
        tool="Read"
        summary="Main.lean"
        rawInput={{ file_path: '/tmp/Main.lean', offset: 4 }}
        availableFilePaths={['Main.lean']}
        onOpenFile={onOpenFile}
        isError
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
