import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  JumpToLatest,
  SubagentExpandedBody,
  SubagentExpandedHeader,
} from '@/features/chat/components/subagents/SubagentExpandedContent';

describe('SubagentExpandedContent', () => {
  it('renders header status and close action', () => {
    const onClose = vi.fn();
    render(
      <SubagentExpandedHeader
        title="Formalizer"
        status="proved"
        iterationOptions={[]}
        selectedIteration=""
        onIterationChange={vi.fn()}
        onClose={onClose}
      />,
    );

    expect(screen.getByText('Formalizer')).toBeInTheDocument();
    expect(screen.getByText('Proved')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close subagent view' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('selects loading, error, waiting, and terminal empty states', () => {
    const common = {
      timelineBlocks: [],
      active: false,
      timelineRef: createRef<HTMLDivElement>(),
      onScroll: vi.fn(),
      onExpand: vi.fn(),
      availableFilePaths: [],
    };
    const view = render(
      <SubagentExpandedBody {...common} historyLoading historyError={null} />,
    );
    expect(screen.getByText('Loading timeline...')).toBeInTheDocument();

    view.rerender(
      <SubagentExpandedBody {...common} historyLoading={false} historyError="History failed" />,
    );
    expect(screen.getByText('History failed')).toBeInTheDocument();
    view.rerender(
      <SubagentExpandedBody {...common} historyLoading={false} historyError={null} active />,
    );
    expect(screen.getByText('Waiting for tool calls...')).toBeInTheDocument();
    view.rerender(
      <SubagentExpandedBody {...common} historyLoading={false} historyError={null} />,
    );
    expect(screen.getByText('No tool calls were recorded.')).toBeInTheDocument();
  });

  it('exposes the jump-to-latest action', () => {
    const onClick = vi.fn();
    render(<JumpToLatest onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
