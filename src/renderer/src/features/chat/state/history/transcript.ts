import {
  isUndeliveredDeliveryState,
  type PersistedChatMessage,
  type ToolHistoryEvent,
} from '@/features/chat/state/types';

export interface ToolResult {
  isError: boolean;
  result: string | null;
}

export function isPersistedMessageOutsideTranscriptTurn(
  message: PersistedChatMessage,
  optimisticTurnMessageIds?: ReadonlySet<string>,
): boolean {
  return isUndeliveredDeliveryState(message.delivery_state ?? undefined)
    && optimisticTurnMessageIds?.has(message.id) !== true;
}

export function parseToolHistoryEvent(
  message: PersistedChatMessage,
): ToolHistoryEvent | null {
  if (message.role !== 'tool') return null;
  try {
    return JSON.parse(message.content) as ToolHistoryEvent;
  } catch {
    return null;
  }
}

export function collectToolResults(
  messages: PersistedChatMessage[],
): Map<string, ToolResult> {
  const results = new Map<string, ToolResult>();
  for (const message of messages) {
    const event = parseToolHistoryEvent(message);
    if (event?.kind !== 'tool_result' || typeof event.tool_use_id !== 'string') continue;
    results.set(event.tool_use_id, {
      isError: event.is_error === true,
      result: typeof event.result === 'string' ? event.result : null,
    });
  }
  return results;
}

export class TranscriptPosition {
  currentTurnId: string | null = null;
  assistantMessageCount = 0;
  transcriptIndex = 0;

  observe(
    message: PersistedChatMessage,
    optimisticTurnMessageIds?: ReadonlySet<string>,
  ): boolean {
    if (message.role === 'user') {
      if (!isPersistedMessageOutsideTranscriptTurn(message, optimisticTurnMessageIds)) {
        this.currentTurnId = `turn-${this.transcriptIndex}`;
        this.assistantMessageCount = 0;
        this.transcriptIndex += 1;
      }
      return true;
    }
    if (message.role !== 'agent') return false;
    if (!this.currentTurnId) {
      this.currentTurnId = `turn-agent-${this.transcriptIndex}`;
    }
    this.assistantMessageCount += 1;
    this.transcriptIndex += 1;
    return true;
  }
}

/** Indexes with a later delivered user row terminate stale child runs. */
export function indexesBeforeLaterUser(
  messages: PersistedChatMessage[],
  optimisticTurnMessageIds?: ReadonlySet<string>,
): Set<number> {
  const indexes = new Set<number>();
  let seenUserAfter = false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (
      messages[index].role === 'user'
      && !isPersistedMessageOutsideTranscriptTurn(
        messages[index],
        optimisticTurnMessageIds,
      )
    ) {
      seenUserAfter = true;
    }
    if (seenUserAfter) indexes.add(index);
  }
  return indexes;
}
