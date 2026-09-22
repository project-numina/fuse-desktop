import {
  findLastPendingStreamMessage,
  findLastStreamingMessage,
  updateUserMessageDeliveryState,
} from './message-state';
import { parseSseEventData } from './sse';
import { extractSuggestion } from './suggestion';
import { isDeliveryState } from './types';
import type { ChatMessage, ChatState } from './types';

interface AssistantStreamDependencies {
  state: ChatState;
  appliedTurnIds: Set<string>;
  finalizedTurnIds: Set<string>;
  freezeActivities: () => void;
  emit: () => void;
  scrollToLatest: () => void;
}

interface AssistantStreamRuntime extends AssistantStreamDependencies {
  unkeyedRawText: string | null;
  rawTextByTurnId: Map<string, string>;
  pendingDeliveryStates: Map<string, ChatMessage['deliveryState']>;
}

interface ChatEventData extends Record<string, unknown> {
  role?: unknown;
  content?: unknown;
  assistant_turn_id?: unknown;
  message_id?: unknown;
  delivery_state?: unknown;
}

function assistantTurnId(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function resetStreamText(runtime: AssistantStreamRuntime): void {
  runtime.unkeyedRawText = null;
  runtime.rawTextByTurnId.clear();
}

function reset(runtime: AssistantStreamRuntime): void {
  resetStreamText(runtime);
  runtime.pendingDeliveryStates.clear();
}

function findAssistantMessage(
  runtime: AssistantStreamRuntime,
  turnId: string,
): ChatMessage | undefined {
  return runtime.state.messages.find(
    (message) => message.role === 'agent' && message.assistantTurnId === turnId,
  );
}

function prepareStreamStart(
  runtime: AssistantStreamRuntime,
  turnId: string | null,
): boolean {
  if (!turnId) {
    runtime.unkeyedRawText = '';
    return true;
  }
  if (runtime.finalizedTurnIds.has(turnId)) return false;
  if (runtime.appliedTurnIds.has(turnId)) {
    const existing = findAssistantMessage(runtime, turnId);
    if (existing && !runtime.rawTextByTurnId.has(turnId)) {
      runtime.rawTextByTurnId.set(turnId, existing.text);
    }
    return false;
  }
  runtime.appliedTurnIds.add(turnId);
  runtime.rawTextByTurnId.set(turnId, '');
  return true;
}

function handleStart(runtime: AssistantStreamRuntime, event: Event): void {
  const data = parseSseEventData<{ assistant_turn_id?: unknown }>(event);
  const turnId = assistantTurnId(data?.assistant_turn_id);
  if (!prepareStreamStart(runtime, turnId)) return;
  runtime.freezeActivities();
  runtime.state.messages.push({
    role: 'agent',
    text: '',
    ...(turnId ? { assistantTurnId: turnId } : {}),
    streaming: true,
    fromStream: true,
    finalized: false,
  });
  runtime.scrollToLatest();
}

function findDeltaMessage(
  runtime: AssistantStreamRuntime,
  turnId: string | null,
): ChatMessage | undefined {
  const streaming = findLastStreamingMessage(runtime.state.messages, turnId);
  if (streaming || !turnId) return streaming;
  const existing = findAssistantMessage(runtime, turnId);
  if (!existing || existing.finalized === true) return undefined;
  existing.streaming = true;
  existing.fromStream = true;
  return existing;
}

function currentRawText(
  runtime: AssistantStreamRuntime,
  turnId: string | null,
  message: ChatMessage,
): string {
  return turnId
    ? runtime.rawTextByTurnId.get(turnId) ?? message.text
    : runtime.unkeyedRawText ?? message.text;
}

function setRawText(
  runtime: AssistantStreamRuntime,
  turnId: string | null,
  text: string,
): void {
  if (turnId) runtime.rawTextByTurnId.set(turnId, text);
  else runtime.unkeyedRawText = text;
}

function handleDelta(runtime: AssistantStreamRuntime, event: Event): void {
  const data = parseSseEventData<{
    text?: unknown;
    assistant_turn_id?: unknown;
  }>(event);
  if (!data || typeof data.text !== 'string') return;
  const turnId = assistantTurnId(data.assistant_turn_id);
  if (turnId && runtime.finalizedTurnIds.has(turnId)) return;
  const message = findDeltaMessage(runtime, turnId);
  if (!message) return;
  const nextRawText = `${currentRawText(runtime, turnId, message)}${data.text}`;
  setRawText(runtime, turnId, nextRawText);
  const extracted = extractSuggestion(nextRawText);
  message.text = extracted.displayText;
  if (extracted.suggestion) runtime.state.suggestion = extracted.suggestion;
  runtime.scrollToLatest();
}

function setUserMessageIdentity(
  runtime: AssistantStreamRuntime,
  message: ChatMessage,
  messageId: string,
  rawDeliveryState: unknown,
): void {
  const existingTerminalState = message.messageId === messageId
    && message.deliveryState !== 'queued'
    ? message.deliveryState
    : undefined;
  message.messageId = messageId;
  const nextDeliveryState = runtime.pendingDeliveryStates.get(messageId)
    ?? existingTerminalState
    ?? (isDeliveryState(rawDeliveryState) ? rawDeliveryState : 'queued');
  updateUserMessageDeliveryState(runtime.state.messages, message, nextDeliveryState);
  runtime.pendingDeliveryStates.delete(messageId);
}

function adoptUserMessageIdentity(
  runtime: AssistantStreamRuntime,
  content: string,
  rawMessageId: unknown,
  rawDeliveryState: unknown,
): void {
  if (typeof rawMessageId !== 'string') return;
  for (const message of runtime.state.messages) {
    if (
      message.role !== 'user'
      || message.messageId
      || message.deliveryState !== 'queued'
      || message.text !== content
    ) continue;
    setUserMessageIdentity(runtime, message, rawMessageId, rawDeliveryState);
    runtime.emit();
    return;
  }
}

function finalizePendingMessage(
  runtime: AssistantStreamRuntime,
  message: ChatMessage,
  turnId: string | null,
  text: string,
): void {
  message.text = text;
  message.assistantTurnId = turnId ?? message.assistantTurnId;
  message.streaming = false;
  message.finalized = true;
  if (turnId) runtime.rawTextByTurnId.delete(turnId);
  else runtime.unkeyedRawText = null;
}

function finalizeUnmatchedMessage(
  runtime: AssistantStreamRuntime,
  turnId: string | null,
  text: string,
): void {
  if (!turnId) {
    runtime.state.messages.push({ role: 'agent', text });
    return;
  }
  const existing = findAssistantMessage(runtime, turnId);
  if (!existing) {
    runtime.state.messages.push({ role: 'agent', text, assistantTurnId: turnId });
    return;
  }
  existing.text = text;
  existing.streaming = false;
  existing.fromStream = true;
  existing.finalized = true;
  runtime.rawTextByTurnId.delete(turnId);
}

function finalizeAssistantChat(
  runtime: AssistantStreamRuntime,
  content: string,
  turnId: string | null,
): void {
  if (turnId && runtime.finalizedTurnIds.has(turnId)) return;
  const extracted = extractSuggestion(content);
  if (extracted.suggestion) runtime.state.suggestion = extracted.suggestion;
  const pending = findLastPendingStreamMessage(runtime.state.messages, turnId);
  if (pending) {
    finalizePendingMessage(runtime, pending, turnId, extracted.displayText);
  } else {
    finalizeUnmatchedMessage(runtime, turnId, extracted.displayText);
  }
  if (turnId) {
    runtime.appliedTurnIds.add(turnId);
    runtime.finalizedTurnIds.add(turnId);
  }
  runtime.scrollToLatest();
}

function handleChat(runtime: AssistantStreamRuntime, event: Event): void {
  const data = parseSseEventData<ChatEventData>(event);
  if (!data || typeof data.content !== 'string') return;
  if (data.role === 'user') {
    adoptUserMessageIdentity(
      runtime,
      data.content,
      data.message_id,
      data.delivery_state,
    );
    return;
  }
  if (data.role !== 'assistant' && data.role !== 'agent') return;
  finalizeAssistantChat(
    runtime,
    data.content,
    assistantTurnId(data.assistant_turn_id),
  );
}

function handleDelivery(runtime: AssistantStreamRuntime, event: Event): void {
  const data = parseSseEventData<{ message_id?: unknown; state?: unknown }>(event);
  if (!data || typeof data.message_id !== 'string') return;
  if (!isDeliveryState(data.state)) return;
  const message = runtime.state.messages.find(
    (candidate) => candidate.messageId === data.message_id,
  );
  if (!message) {
    runtime.pendingDeliveryStates.set(data.message_id, data.state);
    return;
  }
  if (message.deliveryState === data.state) return;
  updateUserMessageDeliveryState(runtime.state.messages, message, data.state);
  runtime.emit();
}

/** Owns assistant stream assembly and user-message delivery reconciliation. */
export function createAssistantStreamState(
  dependencies: AssistantStreamDependencies,
) {
  const runtime: AssistantStreamRuntime = {
    ...dependencies,
    unkeyedRawText: null,
    rawTextByTurnId: new Map(),
    pendingDeliveryStates: new Map(),
  };
  return {
    reset: () => reset(runtime),
    resetStreamText: () => resetStreamText(runtime),
    setUserMessageIdentity: (
      message: ChatMessage,
      messageId: string,
      deliveryState: unknown,
    ) => setUserMessageIdentity(runtime, message, messageId, deliveryState),
    handleStart: (event: Event) => handleStart(runtime, event),
    handleDelta: (event: Event) => handleDelta(runtime, event),
    handleChat: (event: Event) => handleChat(runtime, event),
    handleDelivery: (event: Event) => handleDelivery(runtime, event),
  };
}
