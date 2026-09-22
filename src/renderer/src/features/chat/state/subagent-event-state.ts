import { parseSseEventData } from './sse';
import { applySubagentText } from './subagents';
import type { ChatState, SubagentMessage, SubagentStream } from './types';

interface SubagentEventDependencies {
  state: ChatState;
  nextActivityOrder: () => number;
  currentTurnContext: () => {
    turnId: string | null;
    assistantMessageCount: number;
  };
  rememberEvent: (eventId: string) => boolean;
  appliedMessageIds: Set<string>;
}

interface SubagentTextPayload extends Record<string, unknown> {
  parent_tool_use_id: string;
  text: string;
}

interface EnsureOptions {
  description?: string;
  model?: string | null;
  anchorTurnId?: string | null;
  anchorAfterMessageCount?: number;
  order?: number;
  passLabel?: string;
}

function writeSubagent(state: ChatState, next: SubagentStream): void {
  const index = state.subagents.findIndex(
    (subagent) => subagent.parentToolUseId === next.parentToolUseId,
  );
  if (index === -1) {
    state.subagents = [...state.subagents, next];
    return;
  }
  state.subagents = [
    ...state.subagents.slice(0, index),
    next,
    ...state.subagents.slice(index + 1),
  ];
}

function createSubagent(
  dependencies: SubagentEventDependencies,
  parentToolUseId: string,
  options: EnsureOptions,
): SubagentStream {
  return {
    parentToolUseId,
    anchorTurnId: options.anchorTurnId ?? null,
    anchorAfterMessageCount: options.anchorAfterMessageCount ?? -1,
    description: options.description || 'subagent',
    passLabel: options.passLabel,
    model: options.model || null,
    text: '',
    toolCalls: [],
    status: 'running',
    order: options.order ?? dependencies.nextActivityOrder(),
    startedAt: Date.now(),
  };
}

function patchSubagent(
  existing: SubagentStream,
  options: EnsureOptions,
): SubagentStream {
  const patched = { ...existing };
  let changed = false;
  const patch = <Key extends keyof SubagentStream>(
    key: Key,
    value: SubagentStream[Key],
    shouldPatch: boolean,
  ): void => {
    if (!shouldPatch) return;
    patched[key] = value;
    changed = true;
  };
  patch('model', options.model ?? null, Boolean(options.model && !patched.model));
  patch('description', options.description ?? '', Boolean(
    options.description && patched.description === 'subagent',
  ));
  patch('passLabel', options.passLabel, Boolean(options.passLabel && !patched.passLabel));
  patch('anchorTurnId', options.anchorTurnId ?? null, Boolean(
    options.anchorTurnId && !patched.anchorTurnId,
  ));
  patch('anchorAfterMessageCount', options.anchorAfterMessageCount ?? -1, Boolean(
    options.anchorAfterMessageCount != null && patched.anchorAfterMessageCount === -1,
  ));
  return changed ? patched : existing;
}

function ensureSubagent(
  dependencies: SubagentEventDependencies,
  parentToolUseId: string,
  options: EnsureOptions,
): SubagentStream {
  const existing = dependencies.state.subagents.find(
    (subagent) => subagent.parentToolUseId === parentToolUseId,
  );
  if (!existing) {
    const created = createSubagent(dependencies, parentToolUseId, options);
    writeSubagent(dependencies.state, created);
    return created;
  }
  const patched = patchSubagent(existing, options);
  if (patched !== existing) writeSubagent(dependencies.state, patched);
  return patched;
}

function parseTextPayload(event: Event): SubagentTextPayload | null {
  const data = parseSseEventData<{
    parent_tool_use_id?: unknown;
    text?: unknown;
  }>(event);
  if (
    !data
    || typeof data.parent_tool_use_id !== 'string'
    || typeof data.text !== 'string'
  ) return null;
  return { parent_tool_use_id: data.parent_tool_use_id, text: data.text };
}

function ensureAnchoredSubagent(
  dependencies: SubagentEventDependencies,
  parentToolUseId: string,
): SubagentStream {
  const { turnId, assistantMessageCount } = dependencies.currentTurnContext();
  return ensureSubagent(dependencies, parentToolUseId, {
    model: null,
    anchorTurnId: turnId,
    anchorAfterMessageCount: assistantMessageCount,
  });
}

function persistMessages(
  dependencies: SubagentEventDependencies,
  subagent: SubagentStream,
  messages: SubagentMessage[],
): void {
  writeSubagent(dependencies.state, {
    ...subagent,
    text: messages.map((message) => message.text).join('\n\n'),
    messages,
  });
}

function handleStreamDelta(
  dependencies: SubagentEventDependencies,
  event: Event,
): void {
  const data = parseSseEventData<SubagentTextPayload & { delta_kind?: unknown }>(event);
  if (
    !data
    || typeof data.parent_tool_use_id !== 'string'
    || typeof data.text !== 'string'
    || (data.delta_kind !== undefined && data.delta_kind !== 'text')
    || !dependencies.rememberEvent((event as MessageEvent).lastEventId)
  ) return;
  const subagent = ensureAnchoredSubagent(dependencies, data.parent_tool_use_id);
  const messages = [...(subagent.messages ?? [])];
  const last = messages[messages.length - 1];
  if (last?.streaming) {
    messages[messages.length - 1] = { ...last, text: last.text + data.text };
  } else {
    messages.push({
      text: data.text,
      order: dependencies.nextActivityOrder(),
      streaming: true,
    });
  }
  writeSubagent(dependencies.state, {
    ...subagent,
    text: subagent.text + data.text,
    messages,
  });
}

function applyDurableMessage(
  dependencies: SubagentEventDependencies,
  subagent: SubagentStream,
  data: SubagentTextPayload,
  messageId: string | null,
): void {
  const messages = [...(subagent.messages ?? [])];
  const last = messages[messages.length - 1];
  if (messageId && dependencies.appliedMessageIds.has(messageId)) {
    if (last?.streaming) messages.pop();
    persistMessages(dependencies, subagent, messages);
    return;
  }
  if (messageId) dependencies.appliedMessageIds.add(messageId);
  if (last?.streaming) {
    messages[messages.length - 1] = {
      text: data.text,
      order: last.order,
      ...(messageId ? { messageId } : {}),
    };
  } else if (messageId || last?.text !== data.text) {
    messages.push({
      text: data.text,
      order: dependencies.nextActivityOrder(),
      ...(messageId ? { messageId } : {}),
    });
  }
  persistMessages(dependencies, subagent, messages);
}

function handleMessage(
  dependencies: SubagentEventDependencies,
  event: Event,
): void {
  const data = parseTextPayload(event);
  if (!data || !dependencies.rememberEvent((event as MessageEvent).lastEventId)) return;
  const raw = parseSseEventData<{ message_id?: unknown }>(event);
  const messageId = typeof raw?.message_id === 'string' ? raw.message_id : null;
  const subagent = ensureAnchoredSubagent(dependencies, data.parent_tool_use_id);
  applyDurableMessage(dependencies, subagent, data, messageId);
}

function handleText(
  dependencies: SubagentEventDependencies,
  event: Event,
): void {
  const data = parseTextPayload(event);
  if (!data) return;
  const subagent = ensureAnchoredSubagent(dependencies, data.parent_tool_use_id);
  const next = { ...subagent };
  const lastMessage = next.messages?.[next.messages.length - 1];
  const appendOrder = next.messages?.length && !lastMessage?.streaming
    ? dependencies.nextActivityOrder()
    : undefined;
  applySubagentText(next, data.text, appendOrder);
  writeSubagent(dependencies.state, next);
}

export function createSubagentEventState(dependencies: SubagentEventDependencies) {
  const ensure = (
    parentToolUseId: string,
    description?: string,
    model?: string | null,
    anchorTurnId?: string | null,
    anchorAfterMessageCount?: number,
    order?: number,
    passLabel?: string,
  ): SubagentStream => ensureSubagent(dependencies, parentToolUseId, {
    description,
    model,
    anchorTurnId,
    anchorAfterMessageCount,
    order,
    passLabel,
  });
  return {
    ensure,
    write: (next: SubagentStream) => writeSubagent(dependencies.state, next),
    handleStreamDelta: (event: Event) => handleStreamDelta(dependencies, event),
    handleMessage: (event: Event) => handleMessage(dependencies, event),
    handleText: (event: Event) => handleText(dependencies, event),
  };
}
