import { isOutsideTranscriptTurn } from '@/features/chat/state/types';
import type { ActivityItem, ChatMessage } from '@/features/chat/state/types';

interface MessageTurnIndexes {
  firstAgentByTurn: Map<string, number>;
  userByTurn: Map<string, number>;
}

function indexMessageTurns(messages: ChatMessage[]): MessageTurnIndexes {
  const firstAgentByTurn = new Map<string, number>();
  const userByTurn = new Map<string, number>();
  let currentTurnId: string | null = null;
  let ordinal = 0;
  messages.forEach((message, index) => {
    if (message.role === 'user') {
      if (isOutsideTranscriptTurn(message)) return;
      currentTurnId = `turn-${ordinal}`;
      userByTurn.set(currentTurnId, index);
      ordinal += 1;
      return;
    }
    if (!currentTurnId) currentTurnId = `turn-agent-${ordinal}`;
    if (!firstAgentByTurn.has(currentTurnId)) firstAgentByTurn.set(currentTurnId, index);
    if (!message.placeholder) ordinal += 1;
  });
  return { firstAgentByTurn, userByTurn };
}

function turnsNeedingPlaceholder(
  activities: ActivityItem[],
  firstAgentByTurn: Map<string, number>,
): Set<string> {
  const turnIds = new Set<string>();
  for (const activity of activities) {
    if (activity.anchorTurnId && !firstAgentByTurn.has(activity.anchorTurnId)) {
      turnIds.add(activity.anchorTurnId);
    }
  }
  return turnIds;
}

/** Tool-only turns receive a synthetic assistant row at their user boundary. */
function insertActivityPlaceholders(
  messages: ChatMessage[],
  turnIds: Set<string>,
  indexes: MessageTurnIndexes,
): void {
  const insertions = [...turnIds]
    .map((turnId) => ({ turnId, userIndex: indexes.userByTurn.get(turnId) ?? -1 }))
    .filter((entry) => entry.userIndex >= 0)
    .sort((left, right) => right.userIndex - left.userIndex);
  for (const { turnId, userIndex } of insertions) {
    const insertAt = userIndex + 1;
    messages.splice(insertAt, 0, {
      role: 'agent', text: '', activities: [], placeholder: true,
    });
    for (const [otherTurnId, index] of indexes.firstAgentByTurn) {
      if (index >= insertAt) indexes.firstAgentByTurn.set(otherTurnId, index + 1);
    }
    indexes.firstAgentByTurn.set(turnId, insertAt);
  }
}

export function attachActivitiesToMessages(
  messages: ChatMessage[],
  activities: ActivityItem[],
): ChatMessage[] {
  const indexes = indexMessageTurns(messages);
  insertActivityPlaceholders(
    messages,
    turnsNeedingPlaceholder(activities, indexes.firstAgentByTurn),
    indexes,
  );
  for (const activity of activities) {
    if (!activity.anchorTurnId) continue;
    const targetIndex = indexes.firstAgentByTurn.get(activity.anchorTurnId);
    if (targetIndex === undefined) continue;
    messages[targetIndex].activities = [
      ...(messages[targetIndex].activities || []),
      activity,
    ];
  }
  return messages;
}
