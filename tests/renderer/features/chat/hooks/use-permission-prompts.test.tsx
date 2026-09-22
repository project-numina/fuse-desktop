import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { RenderedChatTurn } from '@/features/chat/hooks/chat-turns';
import { usePermissionPrompts } from '@/features/chat/hooks/use-permission-prompts';
import type { PermissionPrompt } from '@/features/chat/state/types';

function prompt(
  requestId: string,
  anchorTurnId: string | null,
  anchorAfterMessageCount: number,
  order: number,
): PermissionPrompt {
  return {
    request_id: requestId,
    tool: 'Bash',
    input: {},
    description: null,
    reason: null,
    suggestions: [],
    tool_use_id: null,
    assistant_turn_id: null,
    anchorTurnId,
    anchorAfterMessageCount,
    order,
  };
}

function turn(id: string, blockCount: number): RenderedChatTurn {
  return {
    id,
    userText: '',
    userContextAttachments: [],
    assistantBlocks: [],
    hasUser: true,
    frozenActivities: [],
    assistantRenderedBlocks: Array.from({ length: blockCount }, (_, index) => ({
      id: `block-${index}`,
      kind: 'message',
      text: '',
      state: 'complete',
      isError: false,
    })),
    assistantPresent: blockCount > 0,
    assistantStreaming: false,
    assistantState: blockCount > 0 ? 'complete' : 'none',
  };
}

describe('usePermissionPrompts', () => {
  it('sorts bucket prompts and leaves invalid anchors for the composer', () => {
    const permissions = [
      prompt('second', 'turn-1', 1, 2),
      prompt('first', 'turn-1', 1, 1),
      prompt('past-end', 'turn-1', 3, 3),
      prompt('unanchored', null, 0, 4),
    ];
    const { result } = renderHook(() =>
      usePermissionPrompts(permissions, [turn('turn-1', 1)]),
    );

    expect(result.current.promptsForBucket('turn-1', 1).map((item) => item.request_id))
      .toEqual(['first', 'second']);
    expect(result.current.promptsForTurn('turn-1')).toHaveLength(3);
    expect(result.current.unplacedPrompts.map((item) => item.request_id))
      .toEqual(['past-end', 'unanchored']);
  });
});
