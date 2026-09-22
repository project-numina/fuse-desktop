import { formatToolActivity } from '@/features/chat/state/activity';
import {
  collectToolResults,
  indexesBeforeLaterUser,
  parseToolHistoryEvent,
  TranscriptPosition,
  type ToolResult,
} from '@/features/chat/state/history/transcript';
import {
  applySubagentStatusCascadeTo,
  applySubagentText,
  isSubagentSpawnTool,
  SUBAGENT_STATUS_BY_EVENT,
  SYNTHETIC_ANCHOR_TOOLS,
  syntheticSpawnFor,
} from '@/features/chat/state/subagents';
import type {
  PersistedChatMessage,
  SubagentStream,
  SubagentWithSpawnIndex,
  ToolHistoryEvent,
} from '@/features/chat/state/types';

interface Anchor {
  anchorTurnId: string | null;
  anchorAfterMessageCount: number;
}

interface ReconstructionState {
  subagents: SubagentWithSpawnIndex[];
  byId: Map<string, SubagentWithSpawnIndex>;
  pendingStatuses: Map<string, SubagentStream['status'][]>;
  cancelledTargetIds: Set<string>;
  latestAnchorByTool: Map<string, Anchor>;
  anchorToolNames: Set<string>;
  position: TranscriptPosition;
  toolResults: Map<string, ToolResult>;
  unterminatedStatus: SubagentStream['status'];
  lastSubagentId: string | null;
}

function createState(
  messages: PersistedChatMessage[],
  isLive: boolean,
): ReconstructionState {
  return {
    subagents: [],
    byId: new Map(),
    pendingStatuses: new Map(),
    cancelledTargetIds: new Set(),
    latestAnchorByTool: new Map(),
    anchorToolNames: new Set(Object.values(SYNTHETIC_ANCHOR_TOOLS)),
    position: new TranscriptPosition(),
    toolResults: collectToolResults(messages),
    unterminatedStatus: isLive ? 'running' : 'done',
    lastSubagentId: null,
  };
}

function applyHistoryStatus(
  state: ReconstructionState,
  target: SubagentWithSpawnIndex,
  status: SubagentStream['status'],
): void {
  applySubagentStatusCascadeTo(state.subagents, target, status);
  if (status === 'cancelled') state.cancelledTargetIds.add(target.parentToolUseId);
}

function applyPendingStatuses(
  state: ReconstructionState,
  target: SubagentWithSpawnIndex,
): void {
  const statuses = state.pendingStatuses.get(target.parentToolUseId);
  if (!statuses) return;
  state.pendingStatuses.delete(target.parentToolUseId);
  for (const status of statuses) applyHistoryStatus(state, target, status);
}

function ensureSubagent(
  state: ReconstructionState,
  parentToolUseId: string,
  messageIndex: number,
  model?: string | null,
): SubagentWithSpawnIndex {
  const existing = state.byId.get(parentToolUseId);
  if (existing) {
    if (model && !existing.model) existing.model = model;
    return existing;
  }
  const created: SubagentWithSpawnIndex = {
    parentToolUseId,
    anchorTurnId: state.position.currentTurnId,
    anchorAfterMessageCount: state.position.assistantMessageCount,
    description: 'subagent',
    model: model || null,
    text: '',
    toolCalls: [],
    status: state.unterminatedStatus,
    order: messageIndex,
    spawnMessageIndex: messageIndex,
  };
  state.subagents.push(created);
  state.byId.set(parentToolUseId, created);
  applyPendingStatuses(state, created);
  return created;
}

function recordStatus(state: ReconstructionState, event: ToolHistoryEvent): boolean {
  if (event.kind !== 'agent_status' || typeof event.tool_use_id !== 'string') return false;
  const mapped = event.status ? SUBAGENT_STATUS_BY_EVENT[event.status] : undefined;
  if (!mapped) return true;
  const target = state.byId.get(event.tool_use_id);
  if (target) {
    applyHistoryStatus(state, target, mapped);
  } else {
    state.pendingStatuses.set(event.tool_use_id, [
      ...(state.pendingStatuses.get(event.tool_use_id) ?? []),
      mapped,
    ]);
  }
  return true;
}

function recordMessage(
  state: ReconstructionState,
  event: ToolHistoryEvent,
  messageIndex: number,
): boolean {
  if (
    event.kind !== 'subagent_message'
    || typeof event.parent_tool_use_id !== 'string'
    || typeof event.text !== 'string'
  ) return false;
  const target = ensureSubagent(state, event.parent_tool_use_id, messageIndex);
  target.messages = [...(target.messages ?? []), {
    text: event.text,
    order: messageIndex,
    ...(typeof event.message_id === 'string' ? { messageId: event.message_id } : {}),
  }];
  return true;
}

function recordText(
  state: ReconstructionState,
  event: ToolHistoryEvent,
  messageIndex: number,
): boolean {
  if (
    event.kind !== 'subagent_text'
    || typeof event.parent_tool_use_id !== 'string'
    || typeof event.text !== 'string'
  ) return false;
  applySubagentText(
    ensureSubagent(state, event.parent_tool_use_id, messageIndex),
    event.text,
    messageIndex,
  );
  return true;
}

function recordAnchor(state: ReconstructionState, event: ToolHistoryEvent): void {
  const normalizedTool = formatToolActivity(event.tool!, {}).tool;
  if (!state.anchorToolNames.has(normalizedTool)) return;
  state.latestAnchorByTool.set(normalizedTool, {
    anchorTurnId: state.position.currentTurnId,
    anchorAfterMessageCount: state.position.assistantMessageCount,
  });
}

function syntheticMetadata(
  state: ReconstructionState,
  event: ToolHistoryEvent,
  input: Record<string, unknown>,
) {
  const synthetic = syntheticSpawnFor(event.tool!, input);
  const anchor = synthetic !== null
    ? state.latestAnchorByTool.get(SYNTHETIC_ANCHOR_TOOLS[synthetic])
    : undefined;
  const launcher = input.launcher_tool;
  const launcherTool: 'authoring-tools' | 'prover-tools' | undefined =
    synthetic !== null
      && (launcher === 'authoring-tools' || launcher === 'prover-tools')
      ? launcher
      : undefined;
  return {
    synthetic,
    anchor,
    batchId: synthetic !== null && typeof input.batch_id === 'string'
      ? input.batch_id
      : undefined,
    launcherTool,
    specialistTarget: synthetic !== null && typeof input.specialist_target === 'string'
      ? input.specialist_target
      : undefined,
  };
}

function replaceSubagent(
  state: ReconstructionState,
  existing: SubagentWithSpawnIndex | undefined,
  next: SubagentWithSpawnIndex,
): void {
  if (existing) {
    const index = state.subagents.indexOf(existing);
    if (index >= 0) state.subagents[index] = next;
  } else {
    state.subagents.push(next);
  }
  state.byId.set(next.parentToolUseId, next);
}

/** A delayed spawn enriches, rather than replaces, child output replayed first. */
function recordSpawn(
  state: ReconstructionState,
  event: ToolHistoryEvent,
  messageIndex: number,
): void {
  const toolUseId = event.tool_use_id!;
  const input = event.input ?? {};
  const metadata = syntheticMetadata(state, event, input);
  const existing = state.byId.get(toolUseId);
  const next: SubagentWithSpawnIndex = {
    ...(existing ?? { parentToolUseId: toolUseId, text: '', messages: undefined, toolCalls: [] }),
    anchorTurnId: metadata.anchor?.anchorTurnId ?? state.position.currentTurnId,
    anchorAfterMessageCount:
      metadata.anchor?.anchorAfterMessageCount ?? state.position.assistantMessageCount,
    description: String(input.description || 'subagent'),
    passLabel: typeof input.pass_label === 'string' ? input.pass_label : undefined,
    synthetic: metadata.synthetic ?? undefined,
    batchId: metadata.batchId,
    launcherTool: metadata.launcherTool,
    specialistTarget: metadata.specialistTarget,
    parentSubagentId: metadata.synthetic !== null && event.parent_tool_use_id
      ? event.parent_tool_use_id
      : undefined,
    model: event.model || existing?.model || null,
    status: existing?.status
      ?? (input.status === 'queued' ? 'queued' : state.unterminatedStatus),
    order: messageIndex,
    spawnMessageIndex: messageIndex,
  };
  replaceSubagent(state, existing, next);
  applyPendingStatuses(state, next);
  state.lastSubagentId = toolUseId;
}

function recordChildCall(
  state: ReconstructionState,
  event: ToolHistoryEvent,
  messageIndex: number,
): void {
  const parentId = event.parent_tool_use_id || state.lastSubagentId;
  if (!parentId) return;
  const subagent = ensureSubagent(state, parentId, messageIndex, event.model);
  const item = formatToolActivity(event.tool!, event.input || {}, { insideSubagent: true });
  if (event.tool_use_id) item.toolUseId = event.tool_use_id;
  const result = event.tool_use_id ? state.toolResults.get(event.tool_use_id) : undefined;
  if (result) {
    item.isError = result.isError;
    item.result = result.result;
  }
  item.parentToolUseId = parentId;
  item.order = messageIndex;
  subagent.toolCalls.push(item);
  if (event.model && !subagent.model) subagent.model = event.model;
  state.lastSubagentId = parentId;
}

function recordToolCall(
  state: ReconstructionState,
  event: ToolHistoryEvent,
  messageIndex: number,
): void {
  if (event.kind !== 'tool_call' || !event.tool) return;
  recordAnchor(state, event);
  if (isSubagentSpawnTool(event.tool) && event.tool_use_id) {
    recordSpawn(state, event, messageIndex);
  } else if (event.is_subagent) {
    recordChildCall(state, event, messageIndex);
  }
}

function replayEvent(
  state: ReconstructionState,
  event: ToolHistoryEvent | null,
  messageIndex: number,
): void {
  if (!event) return;
  if (recordStatus(state, event)) return;
  if (recordMessage(state, event, messageIndex)) return;
  if (recordText(state, event, messageIndex)) return;
  recordToolCall(state, event, messageIndex);
}

function finalizeSubagents(
  state: ReconstructionState,
  indexesWithLaterUser: Set<number>,
): SubagentStream[] {
  for (const targetId of state.cancelledTargetIds) {
    const target = state.byId.get(targetId);
    if (target) applySubagentStatusCascadeTo(state.subagents, target, 'cancelled');
  }
  for (const subagent of state.subagents) {
    if (
      (subagent.status === 'queued' || subagent.status === 'running')
      && indexesWithLaterUser.has(subagent.spawnMessageIndex)
    ) {
      subagent.status = 'failed';
    }
    delete (subagent as Partial<SubagentWithSpawnIndex>).spawnMessageIndex;
  }
  return state.subagents;
}

export function reconstructHistorySubagents(
  messages: PersistedChatMessage[],
  isLive: boolean,
  optimisticTurnMessageIds?: ReadonlySet<string>,
): SubagentStream[] {
  const state = createState(messages, isLive);
  const indexesWithLaterUser = indexesBeforeLaterUser(messages, optimisticTurnMessageIds);
  for (const [messageIndex, message] of messages.entries()) {
    if (state.position.observe(message, optimisticTurnMessageIds)) continue;
    replayEvent(state, parseToolHistoryEvent(message), messageIndex);
  }
  return finalizeSubagents(state, indexesWithLaterUser);
}
