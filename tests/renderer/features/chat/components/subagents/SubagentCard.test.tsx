import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SubagentCard } from '@/features/chat/components/subagents/SubagentCard';
import type { SubagentStream } from '@/features/chat/state/types';

const subagent = (overrides: Partial<SubagentStream> = {}): SubagentStream => ({
  parentToolUseId: 'agent-1', anchorTurnId: 'turn-0', anchorAfterMessageCount: 0,
  description: 'Prove Foo', model: 'Prover', text: '', status: 'running',
  toolCalls: [{ tool: 'Read', summary: 'Foo.lean', order: 1 }, { tool: 'Read', summary: 'Foo.lean', order: 2 }, { tool: 'Grep', summary: 'theorem', order: 3 }], ...overrides,
});

describe('SubagentCard', () => {
  it('shows how long a finished agent took, ahead of its call count', () => {
    render(<SubagentCard subagent={subagent({ status: 'done', startedAt: 1_000, endedAt: 46_000 })} onExpand={vi.fn()} />);
    expect(screen.getByText('45s')).toHaveClass('run-duration');
    expect(screen.getByText('3 calls')).toBeInTheDocument();
  });
  it('says nothing about duration for a run it cannot date', () => {
    render(<SubagentCard subagent={subagent({ status: 'done' })} onExpand={vi.fn()} />);
    expect(document.querySelector('.run-duration')).toBeNull();
  });
  it('shows visible count, coalesced preview, badge, and expands', () => {
    const onExpand = vi.fn();
    render(<SubagentCard subagent={subagent({ passLabel: 'Pass 1', toolCalls: [...subagent().toolCalls, { tool: 'Read', summary: 'secret', hidden: true }] })} onExpand={onExpand} />);
    expect(screen.getByText('3 calls')).toBeInTheDocument();
    expect(screen.getByText('(2)')).toBeInTheDocument();
    expect(screen.getByText('Pass 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(onExpand).toHaveBeenCalledWith('agent-1');
  });
  it('interleaves child subagents in the three-entry preview', () => {
    render(<SubagentCard subagent={subagent()} childSubagents={[
      subagent({ parentToolUseId: 'child-1', description: 'Survey', order: 2 }),
      subagent({ parentToolUseId: 'child-2', description: 'Reviewer', order: 4 }),
    ]} onExpand={vi.fn()} />);
    expect(screen.queryByText('Read Foo.lean')).not.toBeInTheDocument();
    expect(screen.getByText('Agent Survey')).toBeInTheDocument();
    expect(screen.getByText('Grep theorem')).toBeInTheDocument();
    expect(screen.getByText('Agent Reviewer')).toBeInTheDocument();
    expect(screen.getAllByText(/^(Read|Grep|Agent) /)).toHaveLength(3);
  });
  it('renders queued state instead of a call count', () => {
    render(<SubagentCard subagent={subagent({ status: 'queued' })} onExpand={vi.fn()} />);
    expect(screen.getByText('Queued')).toBeInTheDocument();
  });
  it.each([
    ['queued', 'Status: Queued'],
    ['running', 'Status: Running'],
    ['proved', 'Status: Proved'],
    ['failed', 'Status: Failed'],
    ['cancelled', 'Status: Cancelled'],
    ['done', 'Status: Done'],
  ] as const)('names the %s outcome for readers who cannot see the dot', (status, label) => {
    render(<SubagentCard subagent={subagent({ status })} onExpand={vi.fn()} />);
    expect(screen.getByText(label)).toHaveClass('sr-only');
    expect(screen.getByRole('button')).toHaveAccessibleName(new RegExp(label));
  });
  it('renders explore as a non-clickable aggregate summary', () => {
    render(<SubagentCard subagent={subagent({ synthetic: 'explore', toolCalls: [
      { tool: 'Read', summary: 'A.lean' }, { tool: 'Read', summary: 'A.lean' },
      { tool: 'Grep', summary: 'x' }, { tool: 'lean-explore', summary: 'search' },
      { tool: 'blueprint-tools', summary: 'update_declarations', rawInput: { updates: [{ label: 'foo' }, { label: 'bar' }] } },
    ] })} onExpand={vi.fn()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Read 1 file')).toBeInTheDocument();
    expect(screen.getByText('Made 2 searches')).toBeInTheDocument();
    expect(screen.getByText('Updated 2 declarations')).toBeInTheDocument();
  });
  it('keeps an unloaded explore card flat while allowing its first load', () => {
    const onExpand = vi.fn();
    render(<SubagentCard subagent={subagent({
      synthetic: 'explore',
      historyLoaded: false,
      toolCalls: [
        { tool: 'Read', summary: 'Partial.lean' },
        { tool: 'Grep', summary: 'partial' },
      ],
    })} onExpand={onExpand} />);

    expect(screen.queryByText(/calls$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Read 1 file/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Made 1 search/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Prove Foo/i }));
    expect(onExpand).toHaveBeenCalledWith('agent-1');
  });
});
