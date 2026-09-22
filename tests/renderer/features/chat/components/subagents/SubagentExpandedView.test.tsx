import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/toolCalls/ToolCallStep', () => ({
  default: ({ tool, summary, count, rawInput, onOpenFile }: {
    tool: string;
    summary: string;
    count: number;
    rawInput?: Record<string, unknown>;
    onOpenFile?: (filePath: string, line?: number) => void;
  }) => (
    <div data-testid="tool-step">
      {tool} {summary} ({count})
      {onOpenFile && rawInput?.file_path ? (
        <button
          type="button"
          aria-label={`Open ${String(rawInput.file_path)}`}
          onClick={() => onOpenFile(String(rawInput.file_path), 7)}
        />
      ) : null}
    </div>
  ),
}));
vi.mock('@/features/chat/components/subagents/SubagentCard', () => ({ SubagentCard: ({ subagent, onExpand }: { subagent: { parentToolUseId: string; description: string }; onExpand: (id: string) => void }) => <button type="button" data-testid="child-card" onClick={() => onExpand(subagent.parentToolUseId)}>{subagent.description}</button> }));
vi.mock('@/features/chat/components/SpecialistCard', () => ({ default: ({ group, onExpand }: { group: { title: string; members: Array<{ parentToolUseId: string }> }; onExpand: (id: string) => void }) => <button type="button" data-testid="child-specialist" onClick={() => onExpand(group.members[0].parentToolUseId)}>{group.title}</button> }));
vi.mock('@/features/chat/components/subagents/SubagentGroupCard', () => ({ default: ({ subagents, batchKind, onExpand }: { subagents: Array<{ parentToolUseId: string; description: string }>; batchKind?: string; onExpand: (id: string) => void }) => <div data-testid="child-group" data-batch-kind={batchKind}>{subagents.map((subagent) => <button type="button" key={subagent.parentToolUseId} onClick={() => onExpand(subagent.parentToolUseId)}>{subagent.description}</button>)}</div> }));

import {
  SubagentExpandedView,
  type SubagentScrollPosition,
} from '@/features/chat/components/subagents/SubagentExpandedView';
import type { SubagentStream } from '@/features/chat/state/types';

const agent = (overrides: Partial<SubagentStream> = {}): SubagentStream => ({
  parentToolUseId: 'a', anchorTurnId: 'turn-0', anchorAfterMessageCount: 0,
  description: 'Prove Foo', model: 'Prover', text: '', status: 'running', toolCalls: [], ...overrides,
});

describe('SubagentExpandedView', () => {
  const renderView = (
    subagent: SubagentStream,
    options: {
      members?: SubagentStream[];
      title?: string;
      childSubagents?: SubagentStream[];
      initialScroll?: SubagentScrollPosition;
      onScrollPositionChange?: (position: SubagentScrollPosition) => void;
      onExpand?: (id: string) => void;
      onClose?: () => void;
      availableFilePaths?: readonly string[];
      onOpenFile?: (filePath: string, line?: number) => void;
    } = {},
  ) => render(
    <SubagentExpandedView
      subagent={subagent}
      members={options.members}
      title={options.title}
      childSubagents={options.childSubagents}
      initialScroll={options.initialScroll}
      onScrollPositionChange={options.onScrollPositionChange}
      onExpand={options.onExpand ?? vi.fn()}
      onClose={options.onClose ?? vi.fn()}
      availableFilePaths={options.availableFilePaths}
      onOpenFile={options.onOpenFile}
    />,
  );

  it('shows an empty waiting state and closes', () => {
    const onClose = vi.fn();
    renderView(agent(), { onClose });
    expect(screen.getByText('Waiting for tool calls...')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close subagent view' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each([
    ['queued', 'Queued'],
    ['proved', 'Proved'],
    ['failed', 'Failed'],
    ['cancelled', 'Cancelled'],
  ] as const)('shows the actual %s lifecycle status', (status, label) => {
    renderView(agent({ status }));
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText('Running')).not.toBeInTheDocument();
  });

  it('filters hidden calls, coalesces equal calls, and interleaves children by order', () => {
    const onExpand = vi.fn();
    renderView(agent({ status: 'done', toolCalls: [
      { tool: 'Read', summary: 'A.lean', order: 1 },
      { tool: 'Read', summary: 'A.lean', order: 2 },
      { tool: 'Grep', summary: 'hidden', hidden: true, order: 3 },
      { tool: 'Bash', summary: 'lake build', order: 5 },
    ] }), {
      childSubagents: [agent({ parentToolUseId: 'child', description: 'Explore', order: 4 })],
      onExpand,
    });
    expect(screen.getByText('Done')).toBeInTheDocument();
    const entries = screen.getAllByTestId(/tool-step|child-card/);
    expect(entries.map((entry) => entry.textContent)).toEqual(['Read A.lean (2)', 'Explore', 'Bash lake build (1)']);
    expect(screen.queryByText('hidden')).not.toBeInTheDocument();
    // Spacing after a tool-call row is owned by chat-transcript.css
    // (`.chat-inline-toolcall + .subagent-inline-card`), not an inline style.
    const inlineCard = screen.getByTestId('child-card')
      .parentElement as HTMLElement;
    expect(inlineCard).toHaveClass('subagent-inline-card');
    expect(inlineCard.previousElementSibling).toHaveClass('chat-inline-toolcall');
    expect(inlineCard.style.marginTop).toBe('');
    fireEvent.click(screen.getByTestId('child-card'));
    expect(onExpand).toHaveBeenCalledWith('child');
  });

  it('closes the modal before opening a file from its timeline', () => {
    const calls: string[] = [];
    const onClose = vi.fn(() => calls.push('close'));
    const onOpenFile = vi.fn(() => calls.push('open'));
    renderView(agent({
      toolCalls: [{
        tool: 'Read',
        summary: 'Main.lean',
        rawInput: { file_path: 'lean/Main.lean' },
        order: 1,
      }],
    }), {
      availableFilePaths: ['lean/Main.lean'],
      onClose,
      onOpenFile,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open lean/Main.lean' }));
    expect(calls).toEqual(['close', 'open']);
    expect(onOpenFile).toHaveBeenCalledWith('lean/Main.lean', 7);
  });

  it('shows one specialist node for a nested writer and its reviewer', () => {
    const onExpand = vi.fn();
    renderView(agent({
      synthetic: 'delegated-multistep',
      toolCalls: [{ tool: 'authoring-tools', summary: 'formalize', order: 1 }],
    }), {
      childSubagents: [
        agent({ parentToolUseId: 'writer', description: 'Formalizer pass 1', synthetic: 'authoring', order: 2 }),
        agent({ parentToolUseId: 'reviewer', description: 'Review pass 1', synthetic: 'authoring', order: 3 }),
      ],
      onExpand,
    });

    const nodes = screen.getAllByTestId('child-specialist');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toHaveTextContent('Formalizer');
    expect(nodes[0]).not.toHaveTextContent('pass');
    expect(screen.queryByTestId('tool-step')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('child-card')).toHaveLength(0);
    // Opening the node opens the exchange, keyed on the run it is rendered at.
    fireEvent.click(nodes[0]);
    expect(onExpand).toHaveBeenCalledWith('writer');
  });

  it('folds a re-entered formalize into the specialist’s one node', () => {
    renderView(agent({
      synthetic: 'delegated-multistep',
      toolCalls: [
        {
          tool: 'authoring-tools',
          summary: 'formalize',
          toolUseId: 'formalize-1',
          order: 1,
        },
        {
          tool: 'authoring-tools',
          summary: 'formalize',
          toolUseId: 'formalize-2',
          order: 4,
        },
      ],
    }), {
      childSubagents: [
        agent({
          parentToolUseId: 'writer-1',
          description: 'Formalizer pass 3',
          synthetic: 'authoring',
          order: 2,
        }),
        agent({
          parentToolUseId: 'reviewer-1',
          description: 'Review pass 3',
          synthetic: 'authoring',
          order: 3,
        }),
        agent({
          parentToolUseId: 'writer-2',
          description: 'Formalizer pass 1',
          synthetic: 'authoring',
          order: 5,
        }),
        agent({
          parentToolUseId: 'reviewer-2',
          description: 'Review pass 1',
          synthetic: 'authoring',
          order: 6,
        }),
      ],
    });

    // Two calls, one standing formalizer: the second invocation fills the node
    // the first opened rather than adding a second card beside it.
    const nodes = screen.getAllByTestId('child-specialist');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toHaveTextContent('Formalizer');
    expect(screen.queryByTestId('child-group')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tool-step')).not.toBeInTheDocument();
  });

  it('collapses a legacy regional pass sequence into one specialist node', () => {
    renderView(agent({
      synthetic: 'delegated-multistep',
      toolCalls: [
        {
          tool: 'authoring-tools',
          summary: 'formalize',
          toolUseId: 'formalize-theorem',
          order: 1,
        },
        {
          tool: 'authoring-tools',
          summary: 'formalize',
          toolUseId: 'formalize-scales',
          order: 3,
        },
      ],
    }), {
      childSubagents: [
        agent({ parentToolUseId: 'writer-a1', description: 'Formalizer pass 1', synthetic: 'regional-specialist', order: 2 }),
        agent({ parentToolUseId: 'review-a1', description: 'Review pass 1', synthetic: 'regional-specialist', order: 4 }),
        agent({ parentToolUseId: 'writer-a2', description: 'Formalizer pass 2', synthetic: 'regional-specialist', order: 5 }),
        agent({ parentToolUseId: 'review-a2', description: 'Review pass 2', synthetic: 'regional-specialist', order: 6 }),
        agent({ parentToolUseId: 'writer-a3', description: 'Formalizer pass 3', synthetic: 'regional-specialist', order: 7 }),
        agent({ parentToolUseId: 'review-a3', description: 'Review pass 3', synthetic: 'regional-specialist', order: 8 }),
        agent({ parentToolUseId: 'writer-b1', description: 'Formalizer pass 1', synthetic: 'regional-specialist', order: 9 }),
        agent({ parentToolUseId: 'review-b1', description: 'Review pass 1', synthetic: 'regional-specialist', order: 10 }),
      ],
    });

    // Persisted before batch ids existed: eight per-pass cards, one specialist.
    const nodes = screen.getAllByTestId('child-specialist');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toHaveTextContent('Formalizer');
    expect(screen.queryByTestId('child-group')).not.toBeInTheDocument();
  });

  it('pairs each reviewer with the writer it shares a batch with', () => {
    renderView(agent({
      synthetic: 'delegated-multistep',
      toolCalls: [
        { tool: 'authoring-tools', summary: 'formalize', order: 1 },
        { tool: 'authoring-tools', summary: 'formalize', order: 2 },
      ],
    }), {
      childSubagents: [
        agent({ parentToolUseId: 'a1', description: 'Writer A', synthetic: 'authoring', batchId: 'batch-a', order: 3 }),
        agent({ parentToolUseId: 'a2', description: 'Reviewer A', synthetic: 'authoring', batchId: 'batch-a', order: 4 }),
        agent({ parentToolUseId: 'b1', description: 'Writer B', synthetic: 'authoring', batchId: 'batch-b', order: 5 }),
        agent({ parentToolUseId: 'b2', description: 'Reviewer B', synthetic: 'authoring', batchId: 'batch-b', order: 6 }),
      ],
    });

    const nodes = screen.getAllByTestId('child-specialist');
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toHaveTextContent('Writer A');
    expect(nodes[1]).toHaveTextContent('Writer B');
    // Each structured batch consumes its own launcher, so neither raw workflow
    // row leaks into the timeline beside the richer specialist nodes.
    expect(screen.queryByTestId('tool-step')).not.toBeInTheDocument();
  });

  it('marks a grouped run_provers workflow as a prover batch', () => {
    renderView(agent({
      synthetic: 'delegated-multistep',
      toolCalls: [{ tool: 'prover-tools', summary: 'run_provers', order: 1 }],
    }), {
      childSubagents: [
        agent({ parentToolUseId: 'prover-a', synthetic: 'regional-specialist', order: 2 }),
        agent({ parentToolUseId: 'prover-b', synthetic: 'regional-specialist', order: 3 }),
      ],
    });

    expect(screen.getByTestId('child-group')).toHaveAttribute(
      'data-batch-kind',
      'prover',
    );
    expect(screen.queryByTestId('tool-step')).not.toBeInTheDocument();
  });

  it('recognizes a prover batch when child events arrive before its launcher', () => {
    renderView(agent({
      synthetic: 'delegated-multistep',
      toolCalls: [{ tool: 'prover-tools', summary: 'run_provers', order: 10 }],
    }), {
      childSubagents: [
        agent({
          parentToolUseId: 'prover-a',
          description: 'Prove Foo.first',
          synthetic: 'regional-specialist',
          order: 2,
        }),
        agent({
          parentToolUseId: 'prover-b',
          description: 'Prove Foo.second',
          synthetic: 'regional-specialist',
          order: 3,
        }),
      ],
    });

    expect(screen.getByTestId('child-group')).toHaveAttribute(
      'data-batch-kind',
      'prover',
    );
    expect(screen.queryByTestId('tool-step')).not.toBeInTheDocument();
  });

  it('shows prover progress for a legacy Prove worker before its launcher arrives', () => {
    renderView(agent({
      synthetic: 'delegated-multistep',
      toolCalls: [],
    }), {
      childSubagents: [agent({
        parentToolUseId: 'prover-a',
        description: 'Prove Foo.first',
        synthetic: 'regional-specialist',
        order: 2,
      })],
    });

    expect(screen.getByTestId('child-group')).toHaveAttribute(
      'data-batch-kind',
      'prover',
    );
    expect(screen.queryByTestId('child-card')).not.toBeInTheDocument();
  });

  it('shows prover progress for a worker group before its launcher arrives', () => {
    renderView(agent({
      synthetic: 'delegated-multistep',
      toolCalls: [],
    }), {
      childSubagents: [
        agent({
          parentToolUseId: 'prover-a',
          description: 'Prove Foo.first',
          synthetic: 'regional-specialist',
          batchId: 'prover-batch',
          launcherTool: 'prover-tools',
          order: 2,
        }),
        agent({
          parentToolUseId: 'prover-b',
          description: 'Prove Foo.second',
          synthetic: 'regional-specialist',
          batchId: 'prover-batch',
          launcherTool: 'prover-tools',
          order: 3,
        }),
      ],
    });

    const group = screen.getByTestId('child-group');
    expect(group).toHaveAttribute('data-batch-kind', 'prover');
    expect(group.querySelectorAll('button')).toHaveLength(2);
    expect(screen.queryByTestId('child-card')).not.toBeInTheDocument();
  });

  it('keeps one prover batch grouped when its launcher arrives between worker spawns', () => {
    renderView(agent({
      synthetic: 'delegated-multistep',
      toolCalls: [{
        tool: 'prover-tools',
        summary: 'run_provers',
        toolUseId: 'run-provers',
        order: 5,
      }],
    }), {
      childSubagents: [
        ...Array.from({ length: 4 }, (_, index) => agent({
          parentToolUseId: `prover-${index}`,
          description: `Prove Foo.${index}`,
          synthetic: 'regional-specialist',
          batchId: 'prover-batch',
          launcherTool: 'prover-tools',
          order: index + 1,
        })),
        agent({
          parentToolUseId: 'prover-4',
          description: 'Prove Foo.4',
          synthetic: 'regional-specialist',
          batchId: 'prover-batch',
          launcherTool: 'prover-tools',
          order: 6,
        }),
      ],
    });

    const groups = screen.getAllByTestId('child-group');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveAttribute('data-batch-kind', 'prover');
    expect(groups[0].querySelectorAll('button')).toHaveLength(5);
    expect(screen.queryByTestId('tool-step')).not.toBeInTheDocument();
  });

  it('does not give an unrelated regional specialist prover chrome by proximity', () => {
    renderView(agent({
      synthetic: 'delegated-multistep',
      toolCalls: [{
        tool: 'prover-tools',
        summary: 'run_provers',
        toolUseId: 'run-provers',
        order: 1,
      }],
    }), {
      childSubagents: [agent({
        parentToolUseId: 'repairer',
        description: 'Repair the project build',
        synthetic: 'regional-specialist',
        order: 2,
      })],
    });

    expect(screen.getByTestId('child-card')).toHaveTextContent(
      'Repair the project build',
    );
    expect(screen.queryByTestId('child-group')).not.toBeInTheDocument();
  });

  it('uses structured launcher metadata before legacy title inference', () => {
    renderView(agent({
      synthetic: 'delegated-multistep',
      toolCalls: [
        { tool: 'authoring-tools', summary: 'formalize', order: 1 },
        { tool: 'prover-tools', summary: 'run_provers', order: 2 },
      ],
    }), {
      childSubagents: [
        agent({
          parentToolUseId: 'writer',
          description: 'Prove-looking legacy title',
          synthetic: 'regional-specialist',
          launcherTool: 'authoring-tools',
          order: 3,
        }),
      ],
    });

    // The launcher, not the title, decides what this child is: an authoring
    // launcher makes it a specialist rather than a prover.
    expect(screen.getByTestId('child-specialist')).toHaveTextContent(
      'Prove-looking legacy title',
    );
    expect(screen.getByTestId('tool-step')).toHaveTextContent(
      'prover-tools run_provers',
    );
  });

  it('keeps an unmatched failed launcher while hiding a successful child launcher', () => {
    renderView(agent({
      synthetic: 'delegated-multistep',
      toolCalls: [
        {
          tool: 'prover-tools',
          summary: 'formalize',
          order: 1,
          isError: true,
        },
        { tool: 'authoring-tools', summary: 'formalize', order: 2 },
      ],
    }), {
      childSubagents: [
        agent({
          parentToolUseId: 'writer',
          description: 'Formalizer pass 1',
          synthetic: 'authoring',
          order: 3,
        }),
        agent({
          parentToolUseId: 'reviewer',
          description: 'Review pass 1',
          synthetic: 'authoring',
          order: 4,
        }),
      ],
    });

    expect(screen.getByTestId('tool-step')).toHaveTextContent(
      'prover-tools formalize',
    );
    expect(screen.queryByText(/authoring-tools formalize/)).not.toBeInTheDocument();
    expect(screen.getByTestId('child-specialist')).toBeInTheDocument();
  });

  it('shows delegated orchestrator chat alongside its tool timeline', () => {
    renderView(agent({
      synthetic: 'delegated-multistep',
      text: 'I inspected the **section dependencies**.',
      toolCalls: [{ tool: 'Read', summary: 'section_8.tex', order: 1 }],
    }));

    expect(screen.queryByText('Agent transcript')).not.toBeInTheDocument();
    expect(screen.getByText('section dependencies')).toBeInTheDocument();
    expect(screen.getByTestId('tool-step')).toBeInTheDocument();
    expect(screen.getByText('section dependencies').closest('.agent-text')).not.toBeNull();
  });

  it.each([
    ['regional specialist', 'regional-specialist'],
    ['authoring pass', 'authoring'],
    ['live ordinary child', undefined],
  ] as const)('shows %s chat alongside its tool timeline', (_label, synthetic) => {
    renderView(agent({
      synthetic,
      messages: [{ text: 'I sent an update.', order: 1 }],
      toolCalls: [{ tool: 'Read', summary: 'Main.lean', order: 2 }],
    }));

    expect(screen.getByText('I sent an update.')).toBeInTheDocument();
    expect(screen.getByTestId('tool-step')).toBeInTheDocument();
  });

  it('places a text-only prover conclusion after its tool timeline', () => {
    const child = agent({
      parentToolUseId: 'nested-explore',
      description: 'Nested explore',
      synthetic: 'explore',
      order: 5,
    });
    renderView(agent({
      synthetic: 'prover',
      text: 'PROVED: the declaration now compiles.',
      order: 1,
      toolCalls: [{ tool: 'Bash', summary: 'lake build', order: 2 }],
    }), { childSubagents: [child] });

    const tool = screen.getByTestId('tool-step');
    const childCard = screen.getByTestId('child-card');
    const conclusion = screen.getByText('PROVED: the declaration now compiles.');
    expect(
      tool.compareDocumentPosition(childCard) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      childCard.compareDocumentPosition(conclusion)
        & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows text from a terminal subagent with no tool calls', () => {
    renderView(agent({
      synthetic: 'prover',
      status: 'failed',
      text: 'Prover was not started: no process slot was available.',
      toolCalls: [],
    }));

    expect(screen.getByText(
      'Prover was not started: no process slot was available.',
    )).toBeInTheDocument();
    expect(
      screen.queryByText('No tool calls were recorded.'),
    ).not.toBeInTheDocument();
  });

  it('does not duplicate final text already represented by a message', () => {
    renderView(agent({
      synthetic: 'regional-specialist',
      text: 'The same final update.',
      messages: [{ text: 'The same final update.', order: 2 }],
      toolCalls: [{ tool: 'Read', summary: 'Main.lean', order: 1 }],
    }));

    expect(screen.getAllByText('The same final update.')).toHaveLength(1);
  });

  it('interleaves delegated orchestrator messages with tool calls', () => {
    const { container } = renderView(agent({
      synthetic: 'delegated-multistep',
      text: 'Inspecting.\n\nNow editing.',
      messages: [
        { text: 'Inspecting.', order: 1 },
        { text: 'Now editing.', order: 3 },
      ],
      toolCalls: [{ tool: 'Read', summary: 'Section.lean', order: 2 }],
    }));

    const first = screen.getByText('Inspecting.');
    const tool = screen.getByTestId('tool-step');
    const second = screen.getByText('Now editing.');
    expect(first.compareDocumentPosition(tool) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tool.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(first.closest('.agent-text')).toContainElement(tool);
    expect(second.closest('.agent-text')).not.toContainElement(tool);
    expect(container.querySelector('.subagent-expanded-message')).toBeNull();
  });

  it('shows persisted orchestrator messages when a cancelled run has no final text', () => {
    renderView(agent({
      synthetic: 'delegated-multistep',
      status: 'cancelled',
      text: '',
      messages: [
        { text: 'I inspected the persisted section state.', order: 1 },
      ],
      toolCalls: [{ tool: 'Read', summary: 'section_5.tex', order: 2 }],
    }));

    expect(screen.getByText('I inspected the persisted section state.')).toBeInTheDocument();
    expect(screen.getByTestId('tool-step')).toBeInTheDocument();
  });

  it('shows only the selected turn of an exchange', () => {
    const writer = agent({
      parentToolUseId: 'writer',
      description: 'Formalizer',
      status: 'done',
      synthetic: 'authoring',
      messages: [{ text: 'Wrote the statements.', order: 1 }],
      toolCalls: [{ tool: 'Edit', summary: 'A.lean', order: 2 }],
    });
    const reviewer = agent({
      parentToolUseId: 'reviewer',
      description: 'Review pass 1',
      status: 'done',
      synthetic: 'authoring',
      messages: [{ text: 'FAIL: the bound is wrong.', order: 3 }],
      toolCalls: [{ tool: 'Edit', summary: 'A.lean', order: 4 }],
    });
    const secondPass = agent({
      parentToolUseId: 'writer-2',
      description: 'Formalizer',
      status: 'running',
      synthetic: 'authoring',
      messages: [{ text: 'Fixed the bound.', order: 5 }],
      toolCalls: [{ tool: 'Edit', summary: 'A.lean', order: 6 }],
    });
    const { container } = renderView(writer, {
      members: [writer, reviewer, secondPass],
      title: 'Formalizer',
    });

    expect(container.querySelector('.subagent-expanded-title'))
      .toHaveTextContent('Formalizer');
    // The newest turn, and only it: the turns before it are their own pages.
    expect(screen.getByText('Fixed the bound.')).toBeInTheDocument();
    expect(screen.queryByText('Wrote the statements.')).not.toBeInTheDocument();
    expect(screen.queryByText('FAIL: the bound is wrong.')).not.toBeInTheDocument();
    // Every turn made the same call, so a merged view would show three rows or
    // one row counted three times.
    expect(screen.getAllByTestId('tool-step').map((step) => step.textContent))
      .toEqual(['Edit A.lean (1)']);
    // The picker names the speaker, so the timeline does not repeat it.
    expect(container.querySelector('.subagent-speaker')).toBeNull();
    // A live member speaks for the exchange the node is reporting.
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  /** A formalizer's exchange: a pass, its review, and the pass that followed. */
  const exchangeMembers = (
    overrides: Partial<SubagentStream> = {},
  ): SubagentStream[] => [
    agent({
      parentToolUseId: 'writer-1',
      description: 'Formalizer',
      passLabel: 'Pass 1',
      status: 'done',
      synthetic: 'authoring',
      messages: [{ text: 'Wrote the statements.', order: 1 }],
      toolCalls: [{ tool: 'Edit', summary: 'A.lean', order: 2 }],
      ...overrides,
    }),
    agent({
      parentToolUseId: 'reviewer-1',
      description: 'Formalizer-reviewer',
      passLabel: 'Pass 1',
      status: 'done',
      synthetic: 'authoring',
      messages: [{ text: 'FAIL: the bound is wrong.', order: 3 }],
      ...overrides,
    }),
    agent({
      parentToolUseId: 'writer-2',
      description: 'Formalizer',
      passLabel: 'Pass 2',
      status: 'done',
      synthetic: 'authoring',
      messages: [{ text: 'Fixed the bound.', order: 4 }],
      ...overrides,
    }),
  ];

  /** One run of an exchange, described and pass-labelled as the workflow does. */
  const exchangeRun = (
    id: string,
    description: string,
    passLabel: string,
  ): SubagentStream => agent({
    parentToolUseId: id,
    description,
    passLabel,
    status: 'done',
    synthetic: 'authoring',
  });

  it('offers no iteration picker when the view holds one run', () => {
    renderView(agent({
      description: 'Formalizer',
      status: 'done',
      toolCalls: [{ tool: 'Read', summary: 'A.lean', order: 1 }],
    }));

    expect(screen.queryByRole('button', { name: /^Iteration: / })).toBeNull();
  });

  it('lists every turn of the exchange in order', async () => {
    const members = exchangeMembers();
    renderView(members[0], { members, title: 'Formalizer' });

    // The picker starts on the turn the view itself opens on.
    fireEvent.click(
      screen.getByRole('button', { name: 'Iteration: Formalizer 2' }),
    );

    const options = await screen.findAllByRole('menuitemradio');
    expect(options.map((option) => option.textContent)).toEqual([
      'Formalizer 1',
      'Reviewer 1',
      'Formalizer 2',
    ]);
  });

  it('leaves out a turn that logged nothing at all', async () => {
    // A writer that died on launch (ProcessError before its first tool call)
    // is a real run with a real failure, but as a turn it is a dead end: it
    // has no timeline to show. The node's own status still reports it.
    const members = [
      agent({
        parentToolUseId: 'w1',
        description: 'Formalizer',
        status: 'done',
        synthetic: 'authoring',
        toolCalls: [{ tool: 'Read', summary: 'A.lean', order: 1 }],
      }),
      agent({
        parentToolUseId: 'w2',
        description: 'Formalizer',
        status: 'failed',
        synthetic: 'authoring',
        toolCalls: [],
      }),
      agent({
        parentToolUseId: 'r1',
        description: 'Review pass 1',
        status: 'done',
        synthetic: 'authoring',
        toolCalls: [{ tool: 'Read', summary: 'B.lean', order: 2 }],
      }),
    ];
    renderView(members[0], { members, title: 'Formalizer' });

    fireEvent.click(screen.getByRole('button', { name: /^Iteration: / }));

    const options = await screen.findAllByRole('menuitemradio');
    // Two entries, and the numbering counts what is offered: no "Formalizer 2"
    // standing for a turn the reader cannot open.
    expect(options.map((option) => option.textContent)).toEqual([
      'Formalizer 1',
      'Reviewer 1',
    ]);
  });

  it('keeps a running turn that has not logged anything yet', async () => {
    // The newest turn is where a live specialist is working, so it stays
    // selectable however little it has published.
    const members = [
      agent({
        parentToolUseId: 'w1',
        description: 'Formalizer',
        status: 'done',
        synthetic: 'authoring',
        toolCalls: [{ tool: 'Read', summary: 'A.lean', order: 1 }],
      }),
      agent({
        parentToolUseId: 'r1',
        description: 'Review pass 1',
        status: 'running',
        synthetic: 'authoring',
        toolCalls: [],
      }),
    ];
    renderView(members[0], { members, title: 'Formalizer' });

    fireEvent.click(
      screen.getByRole('button', { name: 'Iteration: Reviewer 1' }),
    );

    const options = await screen.findAllByRole('menuitemradio');
    expect(options.map((option) => option.textContent)).toEqual([
      'Formalizer 1',
      'Reviewer 1',
    ]);
  });

  it('still offers every turn when the whole exchange logged nothing', async () => {
    // Dropping all of them would leave a reader with no way into an exchange
    // whose runs all died, which is worse than offering empty turns.
    const members = [
      exchangeRun('w1', 'Formalizer', 'Pass 1'),
      exchangeRun('r1', 'Review pass 1', 'Pass 1'),
    ];
    renderView(members[0], { members, title: 'Formalizer' });

    fireEvent.click(screen.getByRole('button', { name: /^Iteration: / }));

    const options = await screen.findAllByRole('menuitemradio');
    expect(options.map((option) => option.textContent)).toEqual([
      'Formalizer 1',
      'Reviewer 1',
    ]);
  });

  it('numbers each speaker by its own turns, not by the pass they share', async () => {
    // The workflow stamps one pass label on a writer and the reviewer that
    // answers it, so the first review is on "Pass 1" and reads "Review pass 1".
    const members = [
      exchangeRun('w1', 'Formalizer', 'Pass 1'),
      exchangeRun('r1', 'Review pass 1', 'Pass 1'),
      exchangeRun('w2', 'Formalizer', 'Pass 2'),
      exchangeRun('r2', 'Review pass 2', 'Pass 2'),
      exchangeRun('w3', 'Formalizer', 'Pass 3'),
    ];
    renderView(members[0], { members, title: 'Formalizer' });

    fireEvent.click(screen.getByRole('button', { name: /^Iteration: / }));

    const options = await screen.findAllByRole('menuitemradio');
    expect(options.map((option) => option.textContent)).toEqual([
      'Formalizer 1',
      'Reviewer 1',
      'Formalizer 2',
      'Reviewer 2',
      'Formalizer 3',
    ]);
  });

  it.each([
    'Review pass 1',
    'Reviewer',
    'Formalizer-reviewer',
    'Blueprint-reviewer',
  ])('names a "%s" run Reviewer', (description) => {
    const members = [
      exchangeRun('w1', 'Formalizer', 'Pass 1'),
      exchangeRun('r1', description, 'Pass 1'),
    ];
    renderView(members[0], { members, title: 'Formalizer' });

    expect(screen.getByRole('button', { name: 'Iteration: Reviewer 1' }))
      .toBeInTheDocument();
  });

  it('replaces the page when the reader picks another turn', async () => {
    const members = exchangeMembers();
    renderView(members[0], { members, title: 'Formalizer' });

    fireEvent.click(screen.getByRole('button', { name: /^Iteration: / }));
    fireEvent.click(
      await screen.findByRole('menuitemradio', { name: 'Reviewer 1' }),
    );

    expect(
      screen.getByRole('button', { name: 'Iteration: Reviewer 1' }),
    ).toBeInTheDocument();
    // Selecting a turn shows that turn alone, rather than scrolling a merged
    // conversation to it.
    expect(screen.getByText('FAIL: the bound is wrong.')).toBeInTheDocument();
    expect(screen.queryByText('Wrote the statements.')).not.toBeInTheDocument();
    expect(screen.queryByText('Fixed the bound.')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tool-step')).not.toBeInTheDocument();
  });

  it('opens on the newest turn and follows it as it streams', () => {
    const [writer, reviewer, latest] = exchangeMembers();
    const live: SubagentStream = { ...latest, status: 'running' };
    const { container, rerender } = render(
      <SubagentExpandedView
        subagent={writer}
        members={[writer, reviewer, live]}
        title="Formalizer"
        onExpand={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Iteration: Formalizer 2' }),
    ).toBeInTheDocument();
    const timeline = container.querySelector(
      '.subagent-expanded-timeline',
    ) as HTMLElement;
    Object.defineProperty(timeline, 'scrollHeight', {
      configurable: true,
      value: 640,
    });

    rerender(
      <SubagentExpandedView
        subagent={writer}
        members={[writer, reviewer, {
          ...live,
          toolCalls: [{ tool: 'Read', summary: 'B.lean', order: 5 }],
        }]}
        title="Formalizer"
        onExpand={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId('tool-step')).toHaveTextContent('Read B.lean (1)');
    expect(timeline.scrollTop).toBe(640);
  });

  it('waits on a newest turn that has produced nothing yet', () => {
    const members = [
      ...exchangeMembers(),
      agent({
        parentToolUseId: 'reviewer-2',
        description: 'Review pass 2',
        status: 'queued',
        synthetic: 'authoring',
        toolCalls: [],
      }),
    ];
    const { container } = renderView(members[0], {
      members,
      title: 'Formalizer',
    });

    expect(
      screen.getByRole('button', { name: 'Iteration: Reviewer 2' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Waiting for tool calls...')).toBeInTheDocument();
    expect(container.querySelector('.waiting-spinner')).not.toBeNull();
  });

  it('scrolls the timeline to the newest tool call after updates', () => {
    const value = agent({ toolCalls: [{ tool: 'Read', summary: 'A', order: 1 }] });
    const onExpand = vi.fn();
    const onClose = vi.fn();
    const { container, rerender } = render(
      <SubagentExpandedView
        subagent={value}
        onExpand={onExpand}
        onClose={onClose}
      />,
    );
    const timeline = container.querySelector('.subagent-expanded-timeline') as HTMLElement;
    Object.defineProperty(timeline, 'scrollHeight', { configurable: true, value: 480 });
    rerender(<SubagentExpandedView subagent={{ ...value, toolCalls: [...value.toolCalls, { tool: 'Read', summary: 'B', order: 2 }] }} onExpand={onExpand} onClose={onClose} />);
    expect(timeline.scrollTop).toBe(480);
  });

  it('follows activity added to a nested child card', () => {
    const parent = agent({
      synthetic: 'delegated-multistep',
      toolCalls: [{
        tool: 'authoring-tools',
        summary: 'formalize',
        toolUseId: 'formalize-1',
        order: 1,
      }],
    });
    const child = agent({
      parentToolUseId: 'writer-1',
      parentSubagentId: parent.parentToolUseId,
      synthetic: 'authoring',
      batchId: 'batch-1',
      order: 2,
    });
    const onExpand = vi.fn();
    const onClose = vi.fn();
    const { container, rerender } = render(
      <SubagentExpandedView
        subagent={parent}
        childSubagents={[child]}
        onExpand={onExpand}
        onClose={onClose}
      />,
    );
    const timeline = container.querySelector('.subagent-expanded-timeline') as HTMLElement;
    Object.defineProperty(timeline, 'scrollHeight', {
      configurable: true,
      value: 520,
    });

    rerender(
      <SubagentExpandedView
        subagent={parent}
        childSubagents={[{
          ...child,
          toolCalls: [{ tool: 'Read', summary: 'Foo.lean', order: 3 }],
        }]}
        onExpand={onExpand}
        onClose={onClose}
      />,
    );

    expect(timeline.scrollTop).toBe(520);
  });

  it('opens a finished timeline at the top and does not follow updates', () => {
    const value = agent({
      status: 'done',
      toolCalls: [{ tool: 'Read', summary: 'A', order: 1 }],
    });
    const { container, rerender } = render(
      <SubagentExpandedView
        subagent={value}
        onExpand={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const timeline = container.querySelector('.subagent-expanded-timeline') as HTMLElement;
    Object.defineProperty(timeline, 'scrollHeight', { configurable: true, value: 480 });
    timeline.scrollTop = 0;
    rerender(<SubagentExpandedView
      subagent={{
        ...value,
        toolCalls: [...value.toolCalls, { tool: 'Read', summary: 'B', order: 2 }],
      }}
      onExpand={vi.fn()}
      onClose={vi.fn()}
    />);
    expect(timeline.scrollTop).toBe(0);
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).not.toBeInTheDocument();
  });

  it('pauses live following after scrolling up and resumes on request', () => {
    const value = agent({ toolCalls: [{ tool: 'Read', summary: 'A', order: 1 }] });
    const { container, rerender } = render(
      <SubagentExpandedView
        subagent={value}
        onExpand={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const timeline = container.querySelector('.subagent-expanded-timeline') as HTMLElement;
    Object.defineProperty(timeline, 'scrollHeight', { configurable: true, value: 480 });
    Object.defineProperty(timeline, 'clientHeight', { configurable: true, value: 100 });
    timeline.scrollTop = 100;
    fireEvent.scroll(timeline);

    const jumpButton = screen.getByRole('button', { name: 'Jump to latest' });
    expect(jumpButton).toBeInTheDocument();
    expect(jumpButton).toHaveTextContent('');
    expect(jumpButton.querySelector('svg')).toBeInTheDocument();
    rerender(<SubagentExpandedView
      subagent={{
        ...value,
        toolCalls: [...value.toolCalls, { tool: 'Read', summary: 'B', order: 2 }],
      }}
      onExpand={vi.fn()}
      onClose={vi.fn()}
    />);
    expect(timeline.scrollTop).toBe(100);

    fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }));
    expect(timeline.scrollTop).toBe(480);
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).not.toBeInTheDocument();
  });

  it('restores and reports a saved timeline position', () => {
    const onScrollPositionChange = vi.fn();
    const { container } = renderView(agent({
      status: 'done',
      toolCalls: [{ tool: 'Read', summary: 'A', order: 1 }],
    }), {
      initialScroll: { scrollTop: 175, following: false },
      onScrollPositionChange,
    });
    const timeline = container.querySelector('.subagent-expanded-timeline') as HTMLElement;
    expect(timeline.scrollTop).toBe(175);

    timeline.scrollTop = 120;
    fireEvent.scroll(timeline);
    expect(onScrollPositionChange).toHaveBeenLastCalledWith({
      scrollTop: 120,
      following: false,
    });
  });

  it('resumes follow-latest instead of a stale offset when the user was pinned', () => {
    const value = agent({
      toolCalls: [
        { tool: 'Read', summary: 'A', order: 1 },
        { tool: 'Read', summary: 'B', order: 2 },
      ],
    });
    const { container } = renderView(value, {
      // Saved while the parent had far less content: replaying the raw pixel
      // offset would park the user mid-timeline with follow-latest off.
      initialScroll: { scrollTop: 40, following: true },
    });
    const timeline = container.querySelector('.subagent-expanded-timeline') as HTMLElement;
    Object.defineProperty(timeline, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(timeline, 'clientHeight', { configurable: true, value: 100 });

    expect(timeline.scrollTop).not.toBe(40);
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).not.toBeInTheDocument();
  });

  it.each([
    ['cancelled', 'Cancelled'],
    ['failed', 'Failed'],
  ] as const)(
    'does not spin waiting for calls a %s agent will never make',
    (status, label) => {
      const { container } = renderView(agent({ status, toolCalls: [] }));
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.queryByText('Waiting for tool calls...')).not.toBeInTheDocument();
      expect(container.querySelector('.waiting-spinner')).toBeNull();
      expect(screen.getByText('No tool calls were recorded.')).toBeInTheDocument();
    },
  );

  it('keeps spinning for a queued child that has not started yet', () => {
    const { container } = renderView(agent({ status: 'queued', toolCalls: [] }));
    expect(screen.getByText('Waiting for tool calls...')).toBeInTheDocument();
    expect(container.querySelector('.waiting-spinner')).not.toBeNull();
  });

  it('does not re-pair children with launchers on every streamed token', () => {
    // Streaming appends deltas to the parent's text, never to its tool calls.
    // Launcher pairing must therefore be memoized on `(toolCalls, children)`;
    // previously `visibleCalls`, `timeline` and an unmemoized `isProverBatch`
    // in the render body each re-scanned every call for every child per token,
    // which is O(children x toolCalls) work on every delta.
    const launcherCount = 8;
    const toolCalls = Array.from({ length: launcherCount }, (_, index) => ({
      tool: 'prover-tools',
      summary: 'run_provers',
      toolUseId: `launch-${index}`,
      order: index * 10,
    }));
    const childSubagents = Array.from({ length: launcherCount }, (_, index) => agent({
      parentToolUseId: `prover-${index}`,
      description: `Prove Item ${index}`,
      synthetic: 'prover',
      order: index * 10 + 1,
    }));

    // Candidate scanning is exactly what reads `summary`, so counting reads
    // measures the pairing work without reaching into implementation details.
    const summaryReads = vi.fn();
    for (const call of toolCalls) {
      const value = call.summary;
      Object.defineProperty(call, 'summary', {
        configurable: true,
        get() {
          summaryReads();
          return value;
        },
      });
    }

    const base = agent({
      synthetic: 'delegated-multistep',
      toolCalls,
      text: 'Delegating.',
    });
    const { rerender } = render(
      <SubagentExpandedView
        subagent={base}
        childSubagents={childSubagents}
        onExpand={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const afterMount = summaryReads.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);

    const tokens = 10;
    for (let token = 1; token <= tokens; token += 1) {
      rerender(
        <SubagentExpandedView
          subagent={{ ...base, text: `Delegating.${'x'.repeat(token)}` }}
          childSubagents={childSubagents}
          onExpand={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    }

    // A full re-pair costs at least one scan of the candidate list per child
    // (launcherCount x launcherCount). Staying at or below one read per child
    // proves the pairing itself was not redone.
    const readsPerToken = (summaryReads.mock.calls.length - afterMount) / tokens;
    expect(readsPerToken).toBeLessThanOrEqual(launcherCount);
  });

  it('keeps a replayed turn in its own order', () => {
    // Live streaming numbers every entry from one session-wide counter, but a
    // replayed transcript numbers each run's own timeline from the start. The
    // page holds one run, so that run's own numbering orders it.
    const writer = agent({
      parentToolUseId: 'writer',
      description: 'Formalizer pass 1',
      synthetic: 'authoring',
      order: 1,
      messages: [
        { text: 'writer first', order: 1 },
        { text: 'writer second', order: 2 },
      ],
    });
    const reviewer = agent({
      parentToolUseId: 'reviewer',
      description: 'Formalizer-reviewer pass 1',
      synthetic: 'authoring',
      order: 2,
      messages: [
        { text: 'review first', order: 1 },
        { text: 'review second', order: 2 },
      ],
    });
    renderView(writer, { members: [writer, reviewer], title: 'Formalizer' });

    const rendered = screen.getAllByText(/writer first|writer second|review first|review second/)
      .map((node) => node.textContent);

    expect(rendered).toEqual(['review first', 'review second']);
  });
});
