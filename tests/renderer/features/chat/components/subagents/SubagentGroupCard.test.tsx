import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SubagentGroupCard } from '@/features/chat/components/subagents/SubagentGroupCard';
import type { SubagentStream } from '@/features/chat/state/types';

const agent = (id: string, status: SubagentStream['status'], overrides: Partial<SubagentStream> = {}): SubagentStream => ({
  parentToolUseId: id, anchorTurnId: 'turn-0', anchorAfterMessageCount: 0,
  description: `Agent ${id}`, model: null, text: '', status, toolCalls: [], ...overrides,
});

describe('SubagentGroupCard', () => {
  it('dates each row of the group separately', () => {
    render(<SubagentGroupCard subagents={[
      agent('a', 'done', { startedAt: 1_000, endedAt: 46_000 }),
      agent('b', 'done', { startedAt: 1_000, endedAt: 135_000 }),
    ]} onExpand={vi.fn()} />);
    expect(screen.getByText('45s')).toHaveClass('run-duration');
    expect(screen.getByText('2m 14s')).toHaveClass('run-duration');
  });

  it('renders prover progress and status totals', () => {
    const { container } = render(<SubagentGroupCard subagents={[
      agent('a', 'proved', { synthetic: 'prover' }), agent('b', 'failed', { synthetic: 'prover' }),
      agent('c', 'running', { synthetic: 'prover' }), agent('d', 'queued', { synthetic: 'prover' }),
    ]} onExpand={vi.fn()} />);
    expect(screen.getByText('Proving 4 declarations')).toBeInTheDocument();
    expect(screen.getByText('1 proved')).toBeInTheDocument();
    expect(screen.getByText('1 failed')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(container.querySelector('.batch-progress-success')).toHaveStyle({ width: '25%' });
    expect(container.querySelector('.batch-progress-failed')).toHaveStyle({ width: '25%' });
  });

  it('renders prover progress for a delegated regional batch', () => {
    render(<SubagentGroupCard
      batchKind="prover"
      subagents={[
        agent('a', 'running', { synthetic: 'regional-specialist' }),
        agent('b', 'queued', { synthetic: 'regional-specialist' }),
      ]}
      onExpand={vi.fn()}
    />);
    expect(screen.getByText('Proving 2 declarations')).toBeInTheDocument();
    expect(screen.getByText('1 in progress')).toBeInTheDocument();
    expect(screen.getByText('1 queued')).toBeInTheDocument();
  });

  it('shows the last three visible calls and children as one preview', () => {
    const { container } = render(<SubagentGroupCard subagents={[agent('a', 'done', { toolCalls: [
      { tool: 'Read', summary: 'old', order: 1 }, { tool: 'Grep', summary: 'x', hidden: true, order: 2 },
      { tool: 'Read', summary: 'A', order: 3 }, { tool: 'Read', summary: 'B', order: 4 }, { tool: 'Read', summary: 'C', order: 5 },
    ] })]} childSubagents={[
      agent('child-1', 'done', {
        description: 'Survey', parentSubagentId: 'a', order: 2,
      }),
      agent('child-2', 'done', {
        description: 'Reviewer', parentSubagentId: 'a', order: 6,
      }),
    ]} onExpand={vi.fn()} />);
    expect(screen.queryByText('Read old')).not.toBeInTheDocument();
    expect(screen.queryByText('Grep x')).not.toBeInTheDocument();
    expect(screen.queryByText('Read A')).not.toBeInTheDocument();
    expect(screen.queryByText('Agent Survey')).not.toBeInTheDocument();
    expect(screen.getByText('Read B')).toBeInTheDocument();
    expect(screen.getByText('Read C')).toBeInTheDocument();
    expect(screen.getByText('Agent Reviewer')).toBeInTheDocument();
    expect(container.querySelectorAll('.subagent-preview-row')).toHaveLength(3);
  });

  it('keeps prover child launches visible after later tool calls', () => {
    render(<SubagentGroupCard
      batchKind="prover"
      subagents={[agent('a', 'running', {
        synthetic: 'regional-specialist',
        toolCalls: [
          { tool: 'Read', summary: 'A', order: 2 },
          { tool: 'Read', summary: 'B', order: 3 },
          { tool: 'Read', summary: 'C', order: 4 },
        ],
      })]}
      childSubagents={[
        agent('child-1', 'done', {
          description: 'Formalizer', parentSubagentId: 'a', order: 1,
        }),
      ]}
      onExpand={vi.fn()}
    />);

    expect(screen.getByText('Agent Formalizer')).toBeInTheDocument();
    expect(screen.queryByText('Read A')).not.toBeInTheDocument();
    expect(screen.queryByText('Read B')).not.toBeInTheDocument();
    expect(screen.queryByText('Read C')).not.toBeInTheDocument();
  });

  it('renders a coalesced count separately from its truncating label', () => {
    const { container } = render(<SubagentGroupCard
      subagents={[agent('a', 'done', { toolCalls: [
        { tool: 'Read', summary: 'Long/File/Name.lean', order: 1 },
        { tool: 'Read', summary: 'Long/File/Name.lean', order: 2 },
      ] })]}
      onExpand={vi.fn()}
    />);

    expect(screen.getByText('Read Long/File/Name.lean')).toHaveClass(
      'subagent-preview-label',
    );
    expect(screen.getByText('(2)')).toHaveClass('subagent-preview-count');
    expect(container.querySelector('.subagent-preview-row')).toContainElement(
      screen.getByText('(2)'),
    );
  });

  it('labels queued rows and expands the selected member', () => {
    const onExpand = vi.fn();
    render(<SubagentGroupCard subagents={[agent('a', 'queued'), agent('b', 'running')]} onExpand={onExpand} />);
    expect(screen.getByText('Queued')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Agent b/i }));
    expect(onExpand).toHaveBeenCalledWith('b');
  });

  it('names each row outcome rather than leaving it to the colour dot', () => {
    render(<SubagentGroupCard
      batchKind="prover"
      subagents={[
        agent('a', 'cancelled', { synthetic: 'prover' }),
        agent('b', 'failed', { synthetic: 'prover' }),
      ]}
      onExpand={vi.fn()}
    />);
    expect(screen.getByRole('button', { name: /Agent a/i }))
      .toHaveAccessibleName(/Status: Cancelled/);
    expect(screen.getByRole('button', { name: /Agent b/i }))
      .toHaveAccessibleName(/Status: Failed/);
    expect(screen.getByText('Status: Cancelled')).toHaveClass('sr-only');
  });
});
