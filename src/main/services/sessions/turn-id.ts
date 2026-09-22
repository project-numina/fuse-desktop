/**
 * The `assistant_turn_id` formula. The frontend reconstructs the same ids
 * from persisted history (`turn-<ordinal>:assistant-<count>`), so a live
 * assistant row and its reloaded twin anchor tool cards identically only if
 * this walk matches the backend's byte for byte.
 */

export interface TurnWalkMessage {
  role: 'user' | 'agent';
}

/**
 * Id for the next assistant row given the messages so far. `offset` counts
 * streamed text blocks of the current model message that were announced
 * but have not been appended yet.
 */
export function assistantTurnId(messages: readonly TurnWalkMessage[], offset = 0): string {
  let turnId: string | null = null;
  let assistantMessageCount = 0;
  let messageOrdinal = 0;
  for (const message of messages) {
    if (message.role === 'user') {
      turnId = `turn-${messageOrdinal}`;
      assistantMessageCount = 0;
      messageOrdinal += 1;
    } else if (message.role === 'agent') {
      if (turnId === null) turnId = `turn-agent-${messageOrdinal}`;
      assistantMessageCount += 1;
      messageOrdinal += 1;
    }
  }
  if (turnId === null) turnId = `turn-agent-${messageOrdinal}`;
  return `${turnId}:assistant-${assistantMessageCount + offset}`;
}
