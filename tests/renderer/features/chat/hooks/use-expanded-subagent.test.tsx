import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useExpandedSubagent } from '@/features/chat/hooks/use-expanded-subagent';
import type { SubagentStream } from '@/features/chat/state/types';

function subagent(
  parentToolUseId: string,
  synthetic?: SubagentStream['synthetic'],
): SubagentStream {
  return {
    parentToolUseId,
    anchorTurnId: 'turn-0',
    anchorAfterMessageCount: 0,
    description: 'Inspect files',
    model: null,
    text: '',
    status: 'running',
    toolCalls: [],
    order: 1,
    synthetic,
  };
}

describe('useExpandedSubagent', () => {
  it('hydrates aggregate explore runs without opening the detail overlay', () => {
    const loadSubagentHistory = vi.fn(async () => {});
    const explore = subagent('explore-1', 'explore');
    const { result } = renderHook(() => useExpandedSubagent({
      subagents: [explore],
      specialists: { groups: [], groupByRunId: new Map() },
      viewedConversationId: 'conversation-1',
      loadSubagentHistory,
    }));

    act(() => result.current.expandSubagent('explore-1'));

    expect(loadSubagentHistory).toHaveBeenCalledWith('explore-1');
    expect(result.current.expandedSubagent).toBeNull();
  });

  it('opens regular runs and closes them back to the transcript', () => {
    const run = subagent('agent-1');
    const { result } = renderHook(() => useExpandedSubagent({
      subagents: [run],
      specialists: { groups: [], groupByRunId: new Map() },
      viewedConversationId: 'conversation-1',
      loadSubagentHistory: vi.fn(async () => {}),
    }));

    act(() => result.current.expandSubagent('agent-1'));
    expect(result.current.expandedSubagent).toBe(run);
    act(() => result.current.collapseSubagent());
    expect(result.current.expandedSubagent).toBeNull();
  });
});
