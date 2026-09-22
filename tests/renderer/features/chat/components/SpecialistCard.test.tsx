import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SpecialistCard } from '@/features/chat/components/SpecialistCard';
import { buildSpecialistGroups } from '@/features/chat/state/specialists';
import type { SubagentStream } from '@/features/chat/state/types';

const run = (
  id: string,
  order: number,
  overrides: Partial<SubagentStream> = {},
): SubagentStream => ({
  parentToolUseId: id,
  anchorTurnId: 'turn-0',
  anchorAfterMessageCount: 0,
  description: 'Formalizer',
  model: null,
  text: '',
  toolCalls: [],
  status: 'done',
  synthetic: 'authoring',
  order,
  ...overrides,
});

const group = (subagents: SubagentStream[]) =>
  buildSpecialistGroups(subagents).groups[0];

describe('SpecialistCard', () => {
  it('shows how long the specialist has worked, ahead of its call count', () => {
    render(<SpecialistCard
      group={group([
        run('w1', 1, { batchId: 'formalize-a', startedAt: 1_000, endedAt: 61_000 }),
        run('r1', 2, {
          description: 'Reviewer',
          batchId: 'formalize-a',
          startedAt: 120_000,
          endedAt: 135_000,
        }),
      ])}
      onExpand={vi.fn()}
    />);

    expect(screen.getByText('2m 14s')).toHaveClass('run-duration');
  });

  it('labels the node by role rather than by pass, and nothing else', () => {
    const { container } = render(<SpecialistCard
      group={group([
        run('w1', 2, { passLabel: 'Pass 1', batchId: 'formalize-a' }),
        run('r1', 3, { description: 'Reviewer', batchId: 'formalize-a' }),
        run('w2', 4, { passLabel: 'Pass 2', batchId: 'formalize-a' }),
      ])}
      onExpand={vi.fn()}
    />);

    // The title shares its row with the duration and the call count, so it is
    // the only thing on the left of the card: anything beside it truncates.
    expect(screen.getByText('Formalizer')).toHaveClass('description');
    expect(screen.queryByText(/Pass \d/)).not.toBeInTheDocument();
    expect(container.querySelector('.specialist-work')).toBeNull();
  });

  it('does not chip the card while its reviewer holds the floor', () => {
    const { container } = render(<SpecialistCard
      group={group([
        run('w1', 1, { batchId: 'formalize-a' }),
        run('r1', 2, {
          description: 'Reviewer',
          status: 'running',
          batchId: 'formalize-a',
        }),
      ])}
      onExpand={vi.fn()}
    />);

    expect(container.querySelector('.phase-badge')).toBeNull();
    expect(screen.queryByText('Reviewing')).not.toBeInTheDocument();
    // The dot still reports that the specialist is working.
    expect(screen.getByText('Status: Running')).toHaveClass('sr-only');
  });

  it('counts and previews the whole exchange, not one pass of it', () => {
    render(<SpecialistCard
      group={group([
        run('w1', 1, {
          batchId: 'formalize-a',
          toolCalls: [
            { tool: 'Read', summary: 'A.lean', order: 2 },
            { tool: 'Edit', summary: 'A.lean', order: 3 },
          ],
        }),
        run('r1', 4, {
          description: 'Reviewer',
          batchId: 'formalize-a',
          toolCalls: [{ tool: 'Read', summary: 'A.lean', order: 5 }],
        }),
      ])}
      onExpand={vi.fn()}
    />);

    expect(screen.getByText('3 calls')).toBeInTheDocument();
    expect(screen.getByText('Edit A.lean')).toBeInTheDocument();
  });

  it('opens the exchange at the run the node is keyed on', () => {
    const onExpand = vi.fn();
    render(<SpecialistCard
      group={group([
        run('w1', 1, { batchId: 'formalize-a' }),
        run('r1', 2, { description: 'Reviewer', batchId: 'formalize-a' }),
      ])}
      onExpand={onExpand}
    />);

    fireEvent.click(screen.getByRole('button', { name: /Formalizer/ }));
    expect(onExpand).toHaveBeenCalledWith('w1');
  });

  it('marks a queued specialist without claiming a call count', () => {
    render(<SpecialistCard
      group={group([run('w1', 1, { status: 'queued' })])}
      onExpand={vi.fn()}
    />);

    expect(screen.getByText('Queued')).toBeInTheDocument();
    expect(screen.queryByText(/calls/)).not.toBeInTheDocument();
  });
});
