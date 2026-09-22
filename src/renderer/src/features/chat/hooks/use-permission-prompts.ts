import { useCallback, useMemo } from 'react';

import type { RenderedChatTurn } from '@/features/chat/hooks/chat-turns';
import type { PermissionPrompt } from '@/features/chat/state/types';

/** Places anchored prompts in transcript buckets and returns orphaned fallbacks. */
export function usePermissionPrompts(
  permissions: PermissionPrompt[],
  renderedTurns: RenderedChatTurn[],
) {
  const promptsForBucket = useCallback(
    (turnId: string, messageCount: number): PermissionPrompt[] => permissions
      .filter(
        (prompt) => prompt.anchorTurnId === turnId
          && prompt.anchorAfterMessageCount === messageCount,
      )
      .sort((left, right) => left.order - right.order),
    [permissions],
  );
  const promptsForTurn = useCallback(
    (turnId: string): PermissionPrompt[] => permissions.filter(
      (prompt) => prompt.anchorTurnId === turnId,
    ),
    [permissions],
  );
  const unplacedPrompts = useMemo<PermissionPrompt[]>(() => {
    const rendered = new Set<string>();
    for (const turn of renderedTurns) {
      for (let index = 0; index <= turn.assistantRenderedBlocks.length; index += 1) {
        rendered.add(`${turn.id}\u0000${index}`);
      }
    }
    return permissions.filter(
      (prompt) => prompt.anchorTurnId === null
        || !rendered.has(
          `${prompt.anchorTurnId}\u0000${prompt.anchorAfterMessageCount}`,
        ),
    );
  }, [permissions, renderedTurns]);

  return { promptsForBucket, promptsForTurn, unplacedPrompts };
}
