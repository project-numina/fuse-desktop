import type {
  HistoryTier, MessageDeliveryState, PersistedSubagentSummary,
  PersistedSubagentToolCall, PersistedToolRowContent, SessionHistoryDetail,
  SessionHistorySummary, SubagentHistoryDetail,
} from '@shared/api-types';
import type { TranscriptRow } from '../../../store/rows';
import {
  SUBAGENT_SPAWN_TOOLS, TERMINAL_AGENT_STATUSES, backgroundLogEntries,
  backgroundRoadblocks, backgroundUpdates, displayAt, orderRows, parseToolRow,
  toChatMessageResponse,
} from './normalization';
import type { StoredConversationFile } from './store';

const HISTORY_SNIPPET_MAX_CHARACTERS = 500;
const SUBAGENT_PREVIEW_TOOL_CALL_LIMIT = 3;
const SUBAGENT_PREVIEW_INPUT_MAX_CHARACTERS = 500;
const SUBAGENT_PREVIEW_INPUT_KEYS = ['file_path', 'path', 'command', 'pattern'] as const;
const INITIAL_ONLY_HIDDEN_KINDS = new Set(['tool_call', 'tool_result', 'subagent_message', 'subagent_text']);

export interface LiveSessionInfo {
  status: 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';
  turnActive: boolean;
  hasPendingWork: boolean;
  lastPersistedEventId: number;
}

export function historyTier(doc: StoredConversationFile, live: LiveSessionInfo | null): HistoryTier {
  if (live) {
    if (live.status === 'starting' || live.turnActive || live.hasPendingWork) return 'active';
    return isUnread(doc) ? 'waiting_for_review' : 'completed';
  }
  if (doc.row.status === 'queued' || doc.row.status === 'running') return 'active';
  return isUnread(doc) ? 'waiting_for_review' : 'completed';
}

export function attentionRevision(doc: StoredConversationFile): string {
  return doc.attentionRevision ?? `legacy:${doc.row.completed_at ?? doc.row.created_at}`;
}

export function isUnread(doc: StoredConversationFile): boolean {
  return doc.attentionRevision !== undefined
    ? doc.attentionRevision !== doc.seenRevision
    : doc.background_reviewed_at === null;
}

function snippet(content: string | undefined): string | null {
  if (content === undefined) return null;
  return content.length <= HISTORY_SNIPPET_MAX_CHARACTERS
    ? content
    : content.slice(0, HISTORY_SNIPPET_MAX_CHARACTERS);
}

function latestDisplayAt(rows: readonly TranscriptRow[]): string | null {
  return rows.reduce<string | null>((max, row) => {
    const at = displayAt(row);
    return max === null || at > max ? at : max;
  }, null);
}

export function historySummary(
  doc: StoredConversationFile,
  live: LiveSessionInfo | null,
  options: { includeLegacyBackgroundProgress?: boolean } = {},
): SessionHistorySummary {
  const rows = orderRows(doc.messages);
  const transcript = rows.filter((row) => row.role !== 'tool');
  const entries = options.includeLegacyBackgroundProgress === false ? [] : backgroundLogEntries(rows);
  const { row } = doc;
  return {
    id: row.id, title: row.title, status: row.status,
    workspace_id: row.blueprint_id, workspace_display_name: row.blueprint_id,
    blueprint_name: row.blueprint_id, created_at: row.created_at, completed_at: row.completed_at,
    background_started_at: doc.background_started_at,
    background_reviewed_at: doc.background_reviewed_at,
    input_tokens: row.input_tokens, output_tokens: row.output_tokens,
    total_cost_usd: row.total_cost_usd,
    message_count: doc.nativeSummary?.count ?? rows.length,
    first_message: doc.nativeSummary?.first ?? snippet(transcript[0]?.content),
    last_message: doc.nativeSummary?.last ?? snippet(transcript[transcript.length - 1]?.content),
    last_message_at: doc.nativeRef ? row.updated_at : doc.nativeSummary?.lastAt ?? latestDisplayAt(rows),
    tier: historyTier(doc, live), attention_revision: attentionRevision(doc),
    background_updates: backgroundUpdates(entries), roadblocks: backgroundRoadblocks(entries),
  };
}

export function initialOnlyRows(rows: readonly TranscriptRow[]): TranscriptRow[] {
  const includedCallIds = new Set(rows
    .filter((row) => row.event_kind === 'tool_call' && row.tool_use_id
      && (!row.is_subagent || SUBAGENT_SPAWN_TOOLS.has(row.tool_name ?? '')))
    .map((row) => row.tool_use_id as string));
  return rows.filter((row) => {
    if (row.role !== 'tool') return true;
    if (row.event_kind === null || !INITIAL_ONLY_HIDDEN_KINDS.has(row.event_kind)) return true;
    if (row.event_kind === 'tool_call') {
      return !row.is_subagent || SUBAGENT_SPAWN_TOOLS.has(row.tool_name ?? '');
    }
    if (row.event_kind === 'tool_result') {
      return row.tool_use_id !== null && includedCallIds.has(row.tool_use_id);
    }
    return false;
  });
}

function previewInput(payload: PersistedToolRowContent | null): Record<string, unknown> {
  if (!payload || payload.kind !== 'tool_call' || !payload.input || typeof payload.input !== 'object') return {};
  const preview: Record<string, unknown> = {};
  for (const key of SUBAGENT_PREVIEW_INPUT_KEYS) {
    const value = payload.input[key];
    if (value === undefined || value === null) continue;
    let text = String(value);
    if (text.length > SUBAGENT_PREVIEW_INPUT_MAX_CHARACTERS) {
      text = key === 'file_path' || key === 'path'
        ? `…${text.slice(-(SUBAGENT_PREVIEW_INPUT_MAX_CHARACTERS - 1))}`
        : `${text.slice(0, SUBAGENT_PREVIEW_INPUT_MAX_CHARACTERS - 1)}…`;
    }
    preview[key] = text;
  }
  return preview;
}

interface RunSpan {
  startedAt: string | null;
  endedAt: string | null;
}

export function subagentRunSpans(
  rows: readonly TranscriptRow[],
  runIds: ReadonlySet<string> | null = null,
): Map<string, RunSpan> {
  const byCreated = orderRows(rows).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const spawns = new Map<string, string>();
  const ended = new Map<string, string>();
  for (const row of byCreated) {
    if (row.event_kind === 'tool_call' && row.tool_use_id && SUBAGENT_SPAWN_TOOLS.has(row.tool_name ?? '')
      && (!runIds || runIds.has(row.tool_use_id))) {
      const existing = spawns.get(row.tool_use_id);
      if (existing === undefined || row.created_at < existing) spawns.set(row.tool_use_id, row.created_at);
    }
    if (row.event_kind !== 'agent_status' || !row.tool_use_id || ended.has(row.tool_use_id)) continue;
    if (runIds && !runIds.has(row.tool_use_id)) continue;
    const payload = parseToolRow(row);
    if (payload?.kind === 'agent_status' && TERMINAL_AGENT_STATUSES.has(payload.status)) {
      ended.set(row.tool_use_id, row.created_at);
    }
  }
  const spans = new Map<string, RunSpan>();
  const spawnOrder = [...spawns].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  for (const [runId, startedAt] of spawnOrder) spans.set(runId, { startedAt, endedAt: ended.get(runId) ?? null });
  for (const [runId, endedAt] of ended) if (!spans.has(runId)) spans.set(runId, { startedAt: null, endedAt });
  return spans;
}

function recentCalls(rows: readonly TranscriptRow[]): Map<string, PersistedSubagentToolCall[]> {
  const calls = new Map<string, TranscriptRow[]>();
  for (const row of rows) {
    if (row.event_kind !== 'tool_call' || !row.parent_tool_use_id
      || !row.tool_use_id || !row.tool_name || SUBAGENT_SPAWN_TOOLS.has(row.tool_name)) continue;
    const list = calls.get(row.parent_tool_use_id) ?? [];
    list.push(row);
    calls.set(row.parent_tool_use_id, list);
  }
  return new Map([...calls].map(([parent, list]) => {
    const newestFirst = list.map((row, index) => ({ row, index }))
      .sort((a, b) => b.row.created_at.localeCompare(a.row.created_at) || b.index - a.index)
      .slice(0, SUBAGENT_PREVIEW_TOOL_CALL_LIMIT).reverse();
    return [parent, newestFirst.map(({ row }) => ({
      tool_use_id: row.tool_use_id as string, tool: row.tool_name as string,
      input: previewInput(parseToolRow(row)), created_at: row.created_at,
    }))];
  }));
}

export function subagentSummaries(rows: readonly TranscriptRow[]): PersistedSubagentSummary[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.event_kind === 'tool_call' && row.parent_tool_use_id) {
      counts.set(row.parent_tool_use_id, (counts.get(row.parent_tool_use_id) ?? 0) + 1);
    }
  }
  const recent = recentCalls(rows);
  const spans = subagentRunSpans(rows);
  const runIds = [...spans.keys(), ...[...counts.keys()].filter((id) => !spans.has(id)).sort()];
  return runIds.map((runId) => ({
    parent_tool_use_id: runId,
    tool_call_count: counts.get(runId) ?? 0,
    recent_tool_calls: recent.get(runId) ?? [],
    started_at: spans.get(runId)?.startedAt ?? null,
    ended_at: spans.get(runId)?.endedAt ?? null,
  }));
}

export function historyDetail(
  doc: StoredConversationFile,
  live: LiveSessionInfo | null,
  options: { initialOnly: boolean },
): SessionHistoryDetail {
  const summary = historySummary(doc, live);
  const rows = orderRows(doc.messages);
  const selected = options.initialOnly ? initialOnlyRows(rows) : rows;
  return {
    ...summary,
    messages: selected.map(toChatMessageResponse),
    subagents: subagentSummaries(doc.messages),
    subagent_history_lazy: options.initialOnly,
    can_resume: true,
    last_persisted_event_id: live ? live.lastPersistedEventId : null,
  };
}

export function subagentTimeline(doc: StoredConversationFile, parentToolUseId: string): SubagentHistoryDetail {
  const directCallIds = new Set(doc.messages
    .filter((row) => row.event_kind === 'tool_call'
      && row.parent_tool_use_id === parentToolUseId && row.tool_use_id)
    .map((row) => row.tool_use_id as string));
  const rows = doc.messages.map((row, index) => ({ row, index }))
    .filter(({ row }) => row.parent_tool_use_id === parentToolUseId
      || (row.event_kind === 'tool_result' && row.tool_use_id !== null && directCallIds.has(row.tool_use_id)))
    .sort((a, b) => a.row.created_at.localeCompare(b.row.created_at) || a.index - b.index)
    .map(({ row }) => row);
  const span = subagentRunSpans(doc.messages, new Set([parentToolUseId])).get(parentToolUseId);
  return {
    parent_tool_use_id: parentToolUseId,
    messages: rows.map(toChatMessageResponse),
    started_at: span?.startedAt ?? null,
    ended_at: span?.endedAt ?? null,
  };
}

export function resumeTranscript(doc: StoredConversationFile): Array<{
  role: 'user' | 'agent';
  content: string;
  delivery_state?: MessageDeliveryState;
  message_id?: string;
  context_attachments?: TranscriptRow['context_attachments'];
}> {
  const out: ReturnType<typeof resumeTranscript> = [];
  for (const row of orderRows(doc.messages)) {
    if (row.role === 'tool') continue;
    if (row.delivery_state === 'queued' || row.delivery_state === 'superseded') continue;
    const entry: ReturnType<typeof resumeTranscript>[number] = { role: row.role, content: row.content };
    if (row.delivery_state) entry.delivery_state = row.delivery_state;
    if (row.delivery_state === 'retained') entry.message_id = row.id;
    if (row.context_attachments.length > 0) entry.context_attachments = row.context_attachments;
    out.push(entry);
  }
  return out;
}
