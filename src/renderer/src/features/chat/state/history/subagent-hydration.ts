import { formatToolActivity } from '@/features/chat/state/activity';
import { reconstructHistorySubagents } from '@/features/chat/state/history/subagents';
import { parseRunTimestamp } from '@/features/chat/state/run-duration';
import type {
  ActivityItem,
  PersistedChatMessage,
  PersistedSubagentSummary,
  PersistedSubagentToolCall,
  SessionHistoryDetail,
  SubagentHistoryDetail,
  SubagentStream,
} from '@/features/chat/state/types';

function restoredPreviewOrders(
  calls: PersistedSubagentToolCall[],
  messages: PersistedChatMessage[],
): number[] {
  const insertionPositions = calls.map((call) => {
    const firstLaterMessage = messages.findIndex(
      (message) => message.created_at > call.created_at,
    );
    return firstLaterMessage === -1 ? messages.length : firstLaterMessage;
  });
  const totalsByPosition = new Map<number, number>();
  for (const position of insertionPositions) {
    totalsByPosition.set(position, (totalsByPosition.get(position) ?? 0) + 1);
  }
  const seenByPosition = new Map<number, number>();
  return insertionPositions.map((position) => {
    const seen = (seenByPosition.get(position) ?? 0) + 1;
    seenByPosition.set(position, seen);
    return position - 1 + seen / ((totalsByPosition.get(position) ?? 1) + 1);
  });
}

/** Backend-derived bounds avoid guessing run time from child-only rows. */
function persistedRunSpan(
  summary: PersistedSubagentSummary | undefined,
): Pick<SubagentStream, 'startedAt' | 'endedAt'> {
  const startedAt = parseRunTimestamp(summary?.started_at);
  const endedAt = parseRunTimestamp(summary?.ended_at);
  return {
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(endedAt !== undefined ? { endedAt } : {}),
  };
}

function previewActivities(
  subagent: SubagentStream,
  summary: PersistedSubagentSummary | undefined,
  messages: PersistedChatMessage[],
): ActivityItem[] {
  const existingIds = new Set(
    subagent.toolCalls.map((call) => call.toolUseId).filter(Boolean),
  );
  const calls = summary?.recent_tool_calls ?? [];
  const orders = restoredPreviewOrders(calls, messages);
  return calls.map((call, index): ActivityItem => {
    const activity = formatToolActivity(call.tool, call.input ?? {}, {
      insideSubagent: true,
    });
    activity.toolUseId = call.tool_use_id;
    activity.parentToolUseId = subagent.parentToolUseId;
    activity.order = orders[index];
    return activity;
  }).filter((call) => !existingIds.has(call.toolUseId));
}

export function applyPersistedSubagentSummaries(
  detail: SessionHistoryDetail,
  subagents: SubagentStream[],
): SubagentStream[] {
  const summaries = new Map(
    (detail.subagents ?? []).map((summary) => [summary.parent_tool_use_id, summary]),
  );
  if (!detail.subagent_history_lazy) {
    return subagents.map((subagent) => ({
      ...subagent,
      ...persistedRunSpan(summaries.get(subagent.parentToolUseId)),
      historyLoaded: true,
    }));
  }
  return subagents.map((subagent) => {
    const summary = summaries.get(subagent.parentToolUseId);
    return {
      ...subagent,
      ...persistedRunSpan(summary),
      toolCalls: [
        ...subagent.toolCalls,
        ...previewActivities(subagent, summary, detail.messages),
      ],
      toolCallCount: summary?.tool_call_count ?? 0,
      historyLoaded: false,
      historyLoading: false,
      historyError: null,
    };
  });
}

export function hydratePersistedSubagents(
  detail: SessionHistoryDetail,
  isLive: boolean,
  optimisticTurnMessageIds?: ReadonlySet<string>,
): SubagentStream[] {
  return applyPersistedSubagentSummaries(
    detail,
    reconstructHistorySubagents(detail.messages, isLive, optimisticTurnMessageIds),
  );
}

function mergeActivityCalls(
  persisted: ActivityItem[],
  current: ActivityItem[],
): ActivityItem[] {
  const merged = [...persisted];
  const seen = new Set(persisted.map((call) => call.toolUseId).filter(Boolean));
  for (const call of current) {
    if (call.toolUseId && seen.has(call.toolUseId)) continue;
    merged.push(call);
    if (call.toolUseId) seen.add(call.toolUseId);
  }
  return merged.sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
}

function mergeSubagentMessages(
  persisted: NonNullable<SubagentStream['messages']>,
  current: NonNullable<SubagentStream['messages']>,
): NonNullable<SubagentStream['messages']> {
  const merged = [...persisted];
  const keyFor = (message: NonNullable<SubagentStream['messages']>[number]) =>
    message.messageId ?? `${message.order}:${message.text}`;
  const seen = new Set(persisted.map(keyFor));
  for (const message of current) {
    const key = keyFor(message);
    if (seen.has(key)) continue;
    merged.push(message);
    seen.add(key);
  }
  return merged.sort((left, right) => left.order - right.order);
}

/** Timeline bounds fill missing card timestamps but never replace live ones. */
function timelineRunSpan(
  timeline: SubagentHistoryDetail,
  current: SubagentStream,
): Pick<SubagentStream, 'startedAt' | 'endedAt'> {
  const startedAt = parseRunTimestamp(timeline.started_at);
  const endedAt = parseRunTimestamp(timeline.ended_at);
  return {
    ...(current.startedAt === undefined && startedAt !== undefined ? { startedAt } : {}),
    ...(current.endedAt === undefined && endedAt !== undefined ? { endedAt } : {}),
  };
}

function markSelectedLoaded(
  current: SubagentStream,
  timeline: SubagentHistoryDetail,
): SubagentStream {
  return {
    ...current,
    ...timelineRunSpan(timeline, current),
    historyLoaded: true,
    historyLoading: false,
    historyError: null,
  };
}

function mergeLoadedSubagent(
  loaded: SubagentStream,
  current: SubagentStream,
  selected: boolean,
  timeline: SubagentHistoryDetail,
): SubagentStream {
  return {
    ...loaded,
    ...current,
    ...(selected ? timelineRunSpan(timeline, current) : {}),
    text: current.text || loaded.text,
    messages: mergeSubagentMessages(loaded.messages ?? [], current.messages ?? []),
    toolCalls: mergeActivityCalls(loaded.toolCalls, current.toolCalls),
    toolCallCount: Math.max(
      current.toolCallCount ?? 0,
      loaded.toolCalls.length,
      current.toolCalls.length,
    ),
    historyLoaded: selected ? true : current.historyLoaded,
    historyLoading: selected ? false : current.historyLoading,
    historyError: selected ? null : current.historyError,
  };
}

export function mergePersistedSubagentTimeline(
  currentSubagents: SubagentStream[],
  parentToolUseId: string,
  timeline: SubagentHistoryDetail,
  rootDetail: SessionHistoryDetail,
  isLive: boolean,
  optimisticTurnMessageIds?: ReadonlySet<string>,
): SubagentStream[] {
  const loadedById = new Map(
    applyPersistedSubagentSummaries(
      rootDetail,
      reconstructHistorySubagents(timeline.messages, isLive, optimisticTurnMessageIds),
    ).map((subagent) => [subagent.parentToolUseId, subagent]),
  );
  const next = currentSubagents.map((current) => {
    const loaded = loadedById.get(current.parentToolUseId);
    const selected = current.parentToolUseId === parentToolUseId;
    if (!loaded) return selected ? markSelectedLoaded(current, timeline) : current;
    loadedById.delete(current.parentToolUseId);
    return mergeLoadedSubagent(loaded, current, selected, timeline);
  });
  for (const loaded of loadedById.values()) {
    if (loaded.parentToolUseId !== parentToolUseId) next.push(loaded);
  }
  return next;
}
