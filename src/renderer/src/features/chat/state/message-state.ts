import { extractSuggestion } from './suggestion';
import { isPersistedMessageOutsideTranscriptTurn } from './history';
import { isDeliveryState, isOutsideTranscriptTurn } from './types';
import type {
  ChatContextAttachment,
  ChatMessage,
  ChatState,
  LiveSessionState,
  PersistedChatMessage,
} from './types';

function createInitialLiveSessionState(): LiveSessionState {
  return {
    isActiveSession: false,
    canSend: true,
    canCancel: false,
    buildStatus: 'not_started',
    displayStatus: null,
    turnActive: false,
    activeProverBatchId: null,
    activeProverBatchTotal: 0,
    activeProverBatchCompleted: 0,
    activeWorkGroupCount: 0,
  };
}

export function createInitialChatState(): ChatState {
  return {
    messages: [],
    suggestion: null,
    activities: [],
    subagents: [],
    buildHistory: [],
    autonomousRunActive: false,
    sending: false,
    conversationId: null,
    currentJobId: null,
    sessionId: null,
    status: null,
    connected: false,
    viewingConversationId: null,
    historySession: null,
    historyTools: [],
    liveSession: createInitialLiveSessionState(),
    permissions: [],
    focusRequestToken: 0,
  };
}

/** Copies only slices that the store intentionally mutates in place. */
export function buildChatSnapshot(state: ChatState): ChatState {
  return {
    ...state,
    messages: [...state.messages],
    buildHistory: [...state.buildHistory],
  };
}

export function contextAttachmentPayload(
  attachments: ChatContextAttachment[],
): { context_attachments?: ChatContextAttachment[] } {
  if (!attachments.length) return {};
  return {
    context_attachments: attachments.map(toContextAttachmentPayload),
  };
}

function toContextAttachmentPayload(
  attachment: ChatContextAttachment,
): ChatContextAttachment {
  return {
    attachment_kind: attachment.attachment_kind,
    source_id: attachment.source_id ?? null,
    artifact_kind: attachment.artifact_kind ?? null,
    repo_path: attachment.repo_path ?? null,
    selection: attachment.selection || { kind: 'entire_file' },
  };
}

export function createUserMessage(
  text: string,
  contextAttachments: ChatContextAttachment[],
): ChatMessage {
  return {
    role: 'user',
    text,
    ...(contextAttachments.length ? { contextAttachments } : {}),
  };
}

export function buildChatMessages(
  detailMessages: PersistedChatMessage[],
  onSuggestion: (suggestion: string) => void,
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const message of detailMessages) {
    const chatMessage = toChatMessage(message, onSuggestion);
    if (chatMessage) messages.push(chatMessage);
  }
  return messages;
}

function toChatMessage(
  message: PersistedChatMessage,
  onSuggestion: (suggestion: string) => void,
): ChatMessage | null {
  if (message.role === 'agent') {
    const extracted = extractSuggestion(message.content);
    if (extracted.suggestion) onSuggestion(extracted.suggestion);
    return { role: 'agent', text: extracted.displayText };
  }
  if (message.role !== 'user') return null;
  return {
    role: 'user',
    text: message.content,
    messageId: message.id,
    ...(isDeliveryState(message.delivery_state)
      ? { deliveryState: message.delivery_state }
      : {}),
    ...(message.context_attachments?.length
      ? { contextAttachments: message.context_attachments }
      : {}),
  };
}

export function collectPersistedAssistantTurnIds(
  detailMessages: PersistedChatMessage[],
  optimisticTurnMessageIds: ReadonlySet<string>,
): string[] {
  const assistantTurnIds: string[] = [];
  let currentTurnId: string | null = null;
  let assistantMessageCount = 0;
  let transcriptIndex = 0;
  for (const message of detailMessages) {
    if (message.role === 'user') {
      if (isPersistedMessageOutsideTranscriptTurn(
        message,
        optimisticTurnMessageIds,
      )) continue;
      currentTurnId = `turn-${transcriptIndex}`;
      assistantMessageCount = 0;
      transcriptIndex += 1;
      continue;
    }
    if (message.role !== 'agent') continue;
    if (!currentTurnId) currentTurnId = `turn-agent-${transcriptIndex}`;
    assistantTurnIds.push(`${currentTurnId}:assistant-${assistantMessageCount}`);
    assistantMessageCount += 1;
    transcriptIndex += 1;
  }
  return assistantTurnIds;
}

function sameDisplayMessage(left: ChatMessage, right: ChatMessage): boolean {
  return left.role === right.role && left.text === right.text;
}

function indexLocalMessagesById(
  localMessages: ChatMessage[],
): Map<string, ChatMessage> {
  return new Map(
    localMessages
      .filter((message) => Boolean(message.messageId))
      .map((message) => [message.messageId as string, message]),
  );
}

function reconcilePersistedMessage(
  message: ChatMessage,
  localMessagesById: ReadonlyMap<string, ChatMessage>,
): ChatMessage {
  if (!message.messageId) return message;
  const local = localMessagesById.get(message.messageId);
  if (!local?.deliveryState) return message;
  if (message.deliveryState === 'queued' && local.optimisticTurn) {
    return { ...message, optimisticTurn: true };
  }
  if (message.deliveryState === 'queued' && local.deliveryState !== 'queued') {
    return { ...message, deliveryState: local.deliveryState };
  }
  return message;
}

function hasMatchingDisplayPrefix(
  persistedMessages: ChatMessage[],
  localMessages: ChatMessage[],
): boolean {
  return persistedMessages.every((message, index) =>
    sameDisplayMessage(message, localMessages[index])
  );
}

/** Reconciles durable rows without dropping a newer optimistic local tail. */
export function mergePendingLocalMessages(
  persistedMessages: ChatMessage[],
  localMessages: ChatMessage[],
): ChatMessage[] {
  const localMessagesById = indexLocalMessagesById(localMessages);
  const reconciledPersisted = persistedMessages.map((message) =>
    reconcilePersistedMessage(message, localMessagesById)
  );
  if (persistedMessages.length >= localMessages.length) {
    return reconciledPersisted;
  }
  if (!hasMatchingDisplayPrefix(reconciledPersisted, localMessages)) {
    return reconciledPersisted;
  }
  return [...reconciledPersisted, ...localMessages.slice(reconciledPersisted.length)];
}

export function collectOptimisticTurnMessageIds(
  messages: ChatMessage[],
): Set<string> {
  return new Set(
    messages
      .filter((message) => message.optimisticTurn && message.messageId)
      .map((message) => message.messageId as string),
  );
}

export function findLastStreamingMessage(
  messages: ChatMessage[],
  assistantTurnId?: string | null,
): ChatMessage | undefined {
  return findLastMessage(messages, (message) =>
    message.streaming === true
      && (!assistantTurnId || message.assistantTurnId === assistantTurnId)
  );
}

export function findLastPendingStreamMessage(
  messages: ChatMessage[],
  assistantTurnId?: string | null,
): ChatMessage | undefined {
  return findLastMessage(messages, (message) =>
    message.role === 'agent'
      && message.fromStream === true
      && message.finalized !== true
      && (!assistantTurnId || message.assistantTurnId === assistantTurnId)
  );
}

function findLastMessage(
  messages: ChatMessage[],
  predicate: (message: ChatMessage) => boolean,
): ChatMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (predicate(message)) return message;
  }
  return undefined;
}

export function currentTurnContext(messages: ChatMessage[]): {
  turnId: string | null;
  assistantMessageCount: number;
} {
  let turnId: string | null = null;
  let assistantMessageCount = 0;
  let messageOrdinal = 0;
  messages.forEach((message) => {
    if (message.role === 'user') {
      if (isOutsideTranscriptTurn(message)) return;
      turnId = `turn-${messageOrdinal}`;
      assistantMessageCount = 0;
      messageOrdinal += 1;
    } else {
      if (!turnId) turnId = `turn-agent-${messageOrdinal}`;
      if (!message.placeholder) {
        assistantMessageCount += 1;
        messageOrdinal += 1;
      }
    }
  });
  return { turnId, assistantMessageCount };
}

export function updateUserMessageDeliveryState(
  messages: ChatMessage[],
  message: ChatMessage,
  nextDeliveryState: ChatMessage['deliveryState'],
): void {
  const wasQueued = message.deliveryState === 'queued';
  const openedTurnOptimistically = message.optimisticTurn === true;
  message.deliveryState = nextDeliveryState;
  if (nextDeliveryState !== 'queued') delete message.optimisticTurn;
  if (!shouldMoveDeliveredMessage(
    wasQueued,
    openedTurnOptimistically,
    nextDeliveryState,
  )) return;
  const index = messages.indexOf(message);
  if (index < 0 || index === messages.length - 1) return;
  messages.splice(index, 1);
  messages.push(message);
}

function shouldMoveDeliveredMessage(
  wasQueued: boolean,
  openedTurnOptimistically: boolean,
  nextDeliveryState: ChatMessage['deliveryState'],
): boolean {
  return wasQueued
    && !openedTurnOptimistically
    && (
      nextDeliveryState === 'delivered'
      || nextDeliveryState === 'steered'
      || nextDeliveryState === 'retained'
    );
}
