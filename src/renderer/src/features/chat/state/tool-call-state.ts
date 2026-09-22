import { formatToolActivity, isBackgroundLogWrite } from './activity';
import { objectPayload, parseSseEventData } from './sse';
import {
  applySubagentStatusCascade,
  isSubagentSpawnTool,
  SUBAGENT_STATUS_BY_EVENT,
  SYNTHETIC_ANCHOR_TOOLS,
  syntheticSpawnFor,
} from './subagents';
import { SESSION_STATUS } from './types';
import type { ActivityItem, ChatState, SubagentStream } from './types';

interface ToolCallStateDependencies {
  state: ChatState;
  appliedToolUseIds: Set<string>;
  ensureSubagent: (
    parentToolUseId: string,
    description?: string,
    model?: string | null,
    anchorTurnId?: string | null,
    anchorAfterMessageCount?: number,
    order?: number,
    passLabel?: string,
  ) => SubagentStream;
  writeSubagent: (subagent: SubagentStream) => void;
  currentTurnContext: () => {
    turnId: string | null;
    assistantMessageCount: number;
  };
  nextActivityOrder: () => number;
  scrollToLatest: () => void;
}

interface ToolCallEventData extends Record<string, unknown> {
  tool?: unknown;
  input?: unknown;
  tool_use_id?: unknown;
  parent_tool_use_id?: unknown;
  model?: unknown;
}

interface PreparedToolCall {
  input: Record<string, unknown>;
  item: ActivityItem;
  model: string | undefined;
  turnId: string | null;
  assistantMessageCount: number;
  order: number;
  syntheticFor: string | null;
  isAgentSpawn: boolean;
  passLabel: string | undefined;
}

function latestAnchor(
  state: ChatState,
  toolName: string,
): Pick<ActivityItem, 'anchorTurnId' | 'anchorAfterMessageCount'> | null {
  for (let index = state.activities.length - 1; index >= 0; index -= 1) {
    const activity = state.activities[index];
    if (activity.tool === toolName && activity.toolUseId) {
      return {
        anchorTurnId: activity.anchorTurnId,
        anchorAfterMessageCount: activity.anchorAfterMessageCount,
      };
    }
  }
  return null;
}

function isDuplicateToolCall(
  appliedToolUseIds: Set<string>,
  rawToolUseId: unknown,
): boolean {
  if (typeof rawToolUseId !== 'string') return false;
  if (appliedToolUseIds.has(rawToolUseId)) return true;
  appliedToolUseIds.add(rawToolUseId);
  return false;
}

function anchorToolActivity(
  dependencies: ToolCallStateDependencies,
  data: ToolCallEventData,
  input: Record<string, unknown>,
): Omit<PreparedToolCall, 'input' | 'model' | 'isAgentSpawn' | 'passLabel'> {
  const item = formatToolActivity(data.tool as string, input, {
    insideSubagent: typeof data.parent_tool_use_id === 'string',
  });
  const { turnId, assistantMessageCount } = dependencies.currentTurnContext();
  const order = dependencies.nextActivityOrder();
  const syntheticFor = syntheticSpawnFor(data.tool as string, input);
  const anchorToolName = syntheticFor ? SYNTHETIC_ANCHOR_TOOLS[syntheticFor] : undefined;
  const anchor = anchorToolName ? latestAnchor(dependencies.state, anchorToolName) : null;
  item.anchorTurnId = anchor?.anchorTurnId ?? turnId;
  item.anchorAfterMessageCount = anchor?.anchorAfterMessageCount ?? assistantMessageCount;
  item.order = order;
  if (typeof data.tool_use_id === 'string') item.toolUseId = data.tool_use_id;
  if (typeof data.parent_tool_use_id === 'string') {
    item.parentToolUseId = data.parent_tool_use_id;
  }
  return { item, turnId, assistantMessageCount, order, syntheticFor };
}

function prepareToolCall(
  dependencies: ToolCallStateDependencies,
  event: Event,
): PreparedToolCall | null {
  const data = parseSseEventData<ToolCallEventData>(event);
  if (!data || typeof data.tool !== 'string') return null;
  const input = objectPayload(data.input);
  if (isBackgroundLogWrite({ kind: 'tool_call', tool: data.tool, input })) return null;
  if (isDuplicateToolCall(dependencies.appliedToolUseIds, data.tool_use_id)) return null;
  const anchored = anchorToolActivity(dependencies, data, input);
  return {
    ...anchored,
    input,
    model: typeof data.model === 'string' ? data.model : undefined,
    isAgentSpawn: isSubagentSpawnTool(data.tool) && !!anchored.item.toolUseId,
    passLabel: typeof input.pass_label === 'string' ? input.pass_label : undefined,
  };
}

function spawnMetadata(call: PreparedToolCall): Partial<SubagentStream> {
  const { input, item, syntheticFor } = call;
  const batchId = typeof input.batch_id === 'string' ? input.batch_id : undefined;
  const launcherTool = input.launcher_tool === 'authoring-tools'
    || input.launcher_tool === 'prover-tools'
    ? input.launcher_tool
    : undefined;
  const specialistTarget = typeof input.specialist_target === 'string'
    ? input.specialist_target
    : undefined;
  return {
    ...(syntheticFor ? { synthetic: syntheticFor } : {}),
    ...(batchId ? { batchId } : {}),
    ...(launcherTool ? { launcherTool } : {}),
    ...(specialistTarget ? { specialistTarget } : {}),
    ...(item.parentToolUseId ? { parentSubagentId: item.parentToolUseId } : {}),
  };
}

function spawnSubagent(
  dependencies: ToolCallStateDependencies,
  call: PreparedToolCall,
): void {
  const { input, item, model, order, passLabel } = call;
  const toolUseId = item.toolUseId as string;
  const existedBeforeSpawn = dependencies.state.subagents.some(
    (subagent) => subagent.parentToolUseId === toolUseId,
  );
  const spawned = dependencies.ensureSubagent(
    toolUseId,
    item.summary,
    model,
    item.anchorTurnId,
    item.anchorAfterMessageCount,
    order,
    passLabel,
  );
  dependencies.writeSubagent({
    ...spawned,
    anchorTurnId: item.anchorTurnId ?? null,
    anchorAfterMessageCount: item.anchorAfterMessageCount ?? -1,
    order,
    ...(call.syntheticFor ? spawnMetadata(call) : {}),
    ...(input.status === 'queued' && !existedBeforeSpawn
      ? { status: 'queued' as const }
      : {}),
  });
}

function appendNestedToolCall(
  dependencies: ToolCallStateDependencies,
  call: PreparedToolCall,
): void {
  const { item, model, turnId, assistantMessageCount, order } = call;
  const subagent = dependencies.ensureSubagent(
    item.parentToolUseId as string,
    undefined,
    model,
    turnId,
    assistantMessageCount,
    order,
  );
  const dangling = subagent.messages?.[subagent.messages.length - 1]?.streaming;
  const confirmedMessages = dangling
    ? (subagent.messages ?? []).slice(0, -1)
    : subagent.messages;
  dependencies.writeSubagent({
    ...subagent,
    toolCalls: [...subagent.toolCalls, item],
    ...(dangling
      ? {
          messages: confirmedMessages,
          text: (confirmedMessages ?? []).map((message) => message.text).join('\n\n'),
        }
      : {}),
  });
}

function applyToolCall(
  dependencies: ToolCallStateDependencies,
  call: PreparedToolCall,
): void {
  if (call.isAgentSpawn && call.syntheticFor) {
    spawnSubagent(dependencies, call);
  } else if (call.item.parentToolUseId) {
    appendNestedToolCall(dependencies, call);
  } else if (call.isAgentSpawn) {
    spawnSubagent(dependencies, call);
  }
  dependencies.state.activities = [...dependencies.state.activities, call.item];
}

function handleCall(dependencies: ToolCallStateDependencies, event: Event): void {
  const call = prepareToolCall(dependencies, event);
  if (!call) return;
  applyToolCall(dependencies, call);
  dependencies.scrollToLatest();
}

function handleResult(dependencies: ToolCallStateDependencies, event: Event): void {
  const data = parseSseEventData<{
    tool_use_id?: unknown;
    is_error?: unknown;
    result?: unknown;
  }>(event);
  if (!data || typeof data.tool_use_id !== 'string') return;
  const isError = data.is_error === true;
  const result = typeof data.result === 'string' ? data.result : null;
  const update = (activity: ActivityItem): ActivityItem => (
    activity.toolUseId === data.tool_use_id ? { ...activity, isError, result } : activity
  );
  dependencies.state.activities = dependencies.state.activities.map(update);
  dependencies.state.subagents = dependencies.state.subagents.map((subagent) => ({
    ...subagent,
    toolCalls: subagent.toolCalls.map(update),
  }));
}

function appendAgentStatus(
  dependencies: ToolCallStateDependencies,
  agent: string,
  status: string,
): void {
  const { turnId, assistantMessageCount } = dependencies.currentTurnContext();
  dependencies.state.activities = [...dependencies.state.activities, {
    tool: agent,
    summary: status === SESSION_STATUS.COMPLETED ? 'finished' : status,
    anchorTurnId: turnId,
    anchorAfterMessageCount: assistantMessageCount,
    hidden: true,
  }];
}

function updateSubagentStatus(
  dependencies: ToolCallStateDependencies,
  rawTargetId: unknown,
  status: string,
): void {
  const mappedStatus = SUBAGENT_STATUS_BY_EVENT[status];
  if (!mappedStatus || typeof rawTargetId !== 'string') return;
  const hasTarget = dependencies.state.subagents.some(
    (subagent) => subagent.parentToolUseId === rawTargetId,
  );
  if (!hasTarget) return;
  const nextSubagents = dependencies.state.subagents.map((subagent) => ({ ...subagent }));
  applySubagentStatusCascade(nextSubagents, rawTargetId, mappedStatus, Date.now());
  dependencies.state.subagents = nextSubagents;
}

function handleAgentStatus(
  dependencies: ToolCallStateDependencies,
  event: Event,
): void {
  const data = parseSseEventData<{
    agent?: unknown;
    status?: unknown;
    tool_use_id?: unknown;
  }>(event);
  if (!data) return;
  const agent = typeof data.agent === 'string' ? data.agent : 'agent';
  const status = typeof data.status === 'string' ? data.status : '';
  appendAgentStatus(dependencies, agent, status);
  updateSubagentStatus(dependencies, data.tool_use_id, status);
  dependencies.scrollToLatest();
}

function handleProverBatchStatus(
  dependencies: ToolCallStateDependencies,
  event: Event,
): void {
  const data = parseSseEventData<{
    batch_id?: unknown;
    active?: unknown;
    completed?: unknown;
    total?: unknown;
    can_send?: unknown;
  }>(event);
  if (!data) return;
  const active = data.active === true;
  const completed = typeof data.completed === 'number' ? data.completed : 0;
  const total = typeof data.total === 'number' ? data.total : 0;
  const liveSession = dependencies.state.liveSession;
  dependencies.state.liveSession = {
    ...liveSession,
    activeProverBatchId: active && typeof data.batch_id === 'string' ? data.batch_id : null,
    activeProverBatchCompleted: active ? completed : 0,
    activeProverBatchTotal: active ? total : 0,
    canSend: liveSession.activeWorkGroupCount === 0
      && (typeof data.can_send === 'boolean' ? data.can_send : liveSession.canSend),
    displayStatus: active ? `Provers running (${completed}/${total}).` : liveSession.displayStatus,
  };
}

export function createToolCallState(dependencies: ToolCallStateDependencies) {
  return {
    handleCall: (event: Event) => handleCall(dependencies, event),
    handleResult: (event: Event) => handleResult(dependencies, event),
    handleAgentStatus: (event: Event) => handleAgentStatus(dependencies, event),
    handleProverBatchStatus: (event: Event) => handleProverBatchStatus(dependencies, event),
  };
}
