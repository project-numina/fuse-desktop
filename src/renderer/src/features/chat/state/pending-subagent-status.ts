import { applySubagentStatusCascade, isLiveSubagentStatus, SUBAGENT_STATUS_BY_EVENT } from './subagents';
import type { ChatState, SubagentStream } from './types';

type PendingStatus = { status: SubagentStream['status']; at: number };
type Buffer = { conversation: string | null; statuses: Map<string, PendingStatus[]> };
const buffers = new WeakMap<ChatState, Buffer>();

function buffer(state: ChatState): Buffer {
  const conversation = state.viewingConversationId ?? state.conversationId;
  let value = buffers.get(state);
  // State objects are reused when changing conversations. Never apply another
  // conversation's pending events, even if a provider reuses a tool id.
  if (!value || value.conversation !== conversation) {
    value = { conversation, statuses: new Map() };
    buffers.set(state, value);
  }
  return value;
}

export function recordSubagentStatus(state: ChatState, id: string, raw: string): void {
  const status = SUBAGENT_STATUS_BY_EVENT[raw];
  if (!status) return;
  const pending = buffer(state).statuses;
  pending.set(id, [...(pending.get(id) ?? []), { status, at: Date.now() }]);
  applyPendingSubagentStatuses(state, id);
}

export function applyPendingSubagentStatuses(state: ChatState, id: string): void {
  const pending = buffer(state).statuses;
  const statuses = pending.get(id);
  const target = state.subagents.find(agent => agent.parentToolUseId === id);
  if (!statuses || !target) return;
  pending.delete(id);
  state.subagents = state.subagents.map(agent => ({ ...agent }));
  for (const { status, at } of statuses) {
    const current = state.subagents.find(agent => agent.parentToolUseId === id)!;
    // Replay can restate 'running' after completion; a new run has a new id.
    if (!isLiveSubagentStatus(current.status) && isLiveSubagentStatus(status)) continue;
    applySubagentStatusCascade(state.subagents, id, status, at);
  }
}

export function clearPendingSubagentStatuses(state: ChatState): void {
  buffers.delete(state);
}
