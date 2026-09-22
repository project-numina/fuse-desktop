import type {
  ChatContextAttachmentResponse, ChatMessageResponse, PersistedToolRowContent,
} from '@shared/api-types';
import type { TranscriptRow } from '../../../store/rows';

const BACKGROUND_LOG_ENTRY_RE = /^-\s*\[(\d{4}-\d{2}-\d{2})\]\s+(.+)$/;
const ROADBLOCK_MARKERS = [
  'review needed', 'needs review', 'need review', 'blocked', 'blocker',
  'human input', 'cannot continue',
];
const MAX_PROGRESS_ENTRIES = 20;
const MAX_PROGRESS_ENTRY_CHARACTERS = 500;

export const MAX_DISPLAYED_PROGRESS_ENTRIES = 3;
export const SUBAGENT_SPAWN_TOOLS = new Set(['Agent', 'Task']);
export const TERMINAL_AGENT_STATUSES = new Set(['completed', 'proved', 'failed', 'stopped']);

export function parseToolRow(row: TranscriptRow): PersistedToolRowContent | null {
  if (row.role !== 'tool') return null;
  try {
    const parsed = JSON.parse(row.content) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as PersistedToolRowContent : null;
  } catch {
    return null;
  }
}

export function displayAt(row: TranscriptRow): string {
  return row.delivered_at ?? row.created_at;
}

/** Sort by display time while preserving ingestion order for exact ties. */
export function orderRows(rows: readonly TranscriptRow[]): TranscriptRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const byDisplay = displayAt(a.row).localeCompare(displayAt(b.row));
      if (byDisplay !== 0) return byDisplay;
      const byCreated = a.row.created_at.localeCompare(b.row.created_at);
      return byCreated !== 0 ? byCreated : a.index - b.index;
    })
    .map((entry) => entry.row);
}

export function toChatMessageResponse(row: TranscriptRow): ChatMessageResponse {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    created_at: row.created_at,
    delivery_state: row.delivery_state,
    context_attachments: row.context_attachments as unknown as ChatContextAttachmentResponse[],
  };
}

function backgroundLogTexts(toolName: string, input: Record<string, unknown>): string[] {
  if (toolName === 'Write') return [String(input.content ?? '')];
  if (toolName === 'MultiEdit' && Array.isArray(input.edits)) {
    return input.edits
      .filter((edit): edit is Record<string, unknown> => !!edit && typeof edit === 'object')
      .map((edit) => String(edit.new_string ?? ''));
  }
  return [String(input.new_string ?? '')];
}

function appendBackgroundEntries(text: string, entries: string[], seen: Set<string>): void {
  for (const line of text.split(/\r?\n/)) {
    const match = BACKGROUND_LOG_ENTRY_RE.exec(line.trim());
    if (!match) continue;
    const entry = match[2].trim();
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    entries.push(entry);
  }
}

export function backgroundLogEntries(rows: readonly TranscriptRow[]): string[] {
  const entries: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const payload = parseToolRow(row);
    if (!payload || payload.kind !== 'tool_call') continue;
    if (!['Write', 'Edit', 'MultiEdit'].includes(payload.tool)) continue;
    const input = payload.input && typeof payload.input === 'object' ? payload.input : {};
    const filePath = String(input.file_path ?? input.path ?? '');
    if (!filePath.endsWith('background-log.md')) continue;
    for (const text of backgroundLogTexts(payload.tool, input)) {
      appendBackgroundEntries(text, entries, seen);
    }
  }
  return boundedProgressEntries(entries);
}

export function boundedProgressEntries(entries: Iterable<string>): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of entries) {
    const entry = raw.split(/\s+/).filter(Boolean).join(' ');
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    normalized.push(entry);
  }
  return normalized.slice(-MAX_PROGRESS_ENTRIES).map((entry) =>
    entry.length <= MAX_PROGRESS_ENTRY_CHARACTERS
      ? entry
      : `${entry.slice(0, MAX_PROGRESS_ENTRY_CHARACTERS - 1).trimEnd()}…`);
}

export function backgroundRoadblocks(entries: readonly string[]): string[] {
  return entries.filter((entry) => {
    const lowered = entry.toLowerCase();
    return ROADBLOCK_MARKERS.some((marker) => lowered.includes(marker));
  });
}

export function backgroundUpdates(entries: readonly string[]): string[] {
  const roadblocks = new Set(backgroundRoadblocks(entries));
  return entries.filter((entry) => !roadblocks.has(entry));
}
