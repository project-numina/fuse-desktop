import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { getSessionInfo, getSessionMessages, listSessions } from '@anthropic-ai/claude-agent-sdk';
import type { ProviderId } from '@shared/agent-events';
import type { TranscriptRow } from '../../store/rows';
import { codexHistoryRequest } from './codex-history-rpc';

export interface NativeSessionRef { provider: ProviderId; threadId: string; directory: string }
export interface NativeSession extends NativeSessionRef {
  title: string;
  createdAt: string;
  updatedAt: string;
}
export interface NativeHistory {
  list(directories: string[]): Promise<{ sessions: NativeSession[]; errors: string[] }>;
  read(ref: NativeSessionRef): Promise<TranscriptRow[]>;
}

export function canonicalDirectory(path: string): string {
  try { return realpathSync(path); } catch { return resolve(path); }
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function timestamp(value: unknown, scale = 1): string {
  const date = new Date(typeof value === 'number' ? value * scale : text(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}
function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  return array(value).map((part) => {
    const block = record(part);
    if (typeof block.text === 'string') return block.text;
    if (block.type === 'image' || block.type === 'localImage') return '[Image attachment]';
    return '';
  }).filter(Boolean).join('\n');
}
function row(id: string, role: TranscriptRow['role'], content: string, index: number): TranscriptRow {
  return { id: `native-${id}`, role, content, created_at: new Date(index).toISOString(), delivered_at: null,
    delivery_state: role === 'user' ? 'delivered' : null, context_attachments: [], event_kind: null,
    tool_name: null, tool_use_id: null, parent_tool_use_id: null, is_subagent: false };
}
function tool(id: string, name: string, input: unknown, output: unknown, index: number): TranscriptRow[] {
  const call = row(`${id}-call`, 'tool', JSON.stringify({ kind: 'tool_call', tool_use_id: id, tool: name, input: record(input) }), index);
  call.event_kind = 'tool_call'; call.tool_name = name; call.tool_use_id = id;
  if (output === undefined) return [call];
  const result = row(`${id}-result`, 'tool', JSON.stringify({ kind: 'tool_result', tool_use_id: id, result: typeof output === 'string' ? output : JSON.stringify(output), is_error: false }), index + 1);
  result.event_kind = 'tool_result'; result.tool_use_id = id;
  return [call, result];
}

/** Normalize provider data only at the UI boundary; provider files remain the source of truth. */
export function claudeMessages(messages: Array<{ uuid: string; type: string; message: unknown; parent_tool_use_id?: string | null }>): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  for (const message of messages) {
    const content = record(message.message).content;
    const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : array(content);
    blocks.forEach((raw, blockIndex) => {
      const block = record(raw);
      const id = `${message.uuid}-${blockIndex}`;
      let added: TranscriptRow[] = [];
      if (block.type === 'tool_use') added = tool(text(block.id) || id, text(block.name), block.input, undefined, rows.length * 2);
      else if (block.type === 'tool_result') {
        const result = row(id, 'tool', JSON.stringify({ kind: 'tool_result', tool_use_id: block.tool_use_id, result: contentText(block.content) || JSON.stringify(block.content), is_error: block.is_error === true }), rows.length * 2);
        result.event_kind = 'tool_result'; result.tool_use_id = text(block.tool_use_id); added = [result];
      } else {
        const body = contentText([block]) || (block.type === 'thinking' ? text(block.thinking) : '');
        if (body) added = [row(id, message.type === 'user' ? 'user' : 'agent', body, rows.length * 2)];
      }
      for (const entry of added) {
        entry.parent_tool_use_id = message.parent_tool_use_id ?? null;
        entry.is_subagent = Boolean(entry.parent_tool_use_id);
        rows.push(entry);
      }
    });
  }
  return rows;
}

export function codexMessages(thread: Record<string, unknown>): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  for (const turn of array(thread.turns)) {
    for (const raw of array(record(turn).items)) {
      const item = record(raw);
      const id = text(item.id) || `${rows.length}`;
      const index = rows.length * 2;
      if (item.type === 'userMessage') rows.push(row(id, 'user', contentText(item.content), index));
      else if (item.type === 'agentMessage' || item.type === 'plan') rows.push(row(id, 'agent', text(item.text), index));
      else if (item.type === 'reasoning') {
        const summary = array(item.summary).map(text).filter(Boolean).join('\n');
        if (summary) rows.push(row(id, 'agent', summary, index));
      } else if (item.type === 'commandExecution') rows.push(...tool(id, 'Bash', { command: item.command, cwd: item.cwd }, item.aggregatedOutput ?? '', index));
      else if (item.type === 'mcpToolCall') rows.push(...tool(id, `mcp__${text(item.server)}__${text(item.tool)}`, item.arguments, item.result ?? item.error, index));
      else rows.push(...tool(id, text(item.type) || 'Provider event', item, undefined, index));
    }
  }
  return rows;
}

export class ProviderNativeHistory implements NativeHistory {
  constructor(private readonly codexExecutable: () => string) {}

  async list(directories: string[]): Promise<{ sessions: NativeSession[]; errors: string[] }> {
    const sessions: NativeSession[] = [];
    const errors: string[] = [];
    for (const directory of new Set(directories.map(canonicalDirectory))) {
      await Promise.all([
        (async () => {
          try {
            for (const session of await listSessions({ dir: directory, includeWorktrees: false })) {
              if (session.cwd && canonicalDirectory(session.cwd) !== directory) continue;
              sessions.push({ provider: 'claude', threadId: session.sessionId, directory, title: session.summary,
                createdAt: timestamp(session.createdAt ?? session.lastModified), updatedAt: timestamp(session.lastModified) });
            }
          } catch { errors.push('Claude Code history could not be read. Existing Fuse chats are still available.'); }
        })(),
        (async () => {
          try {
            let cursor: string | null = null;
            const cursors = new Set<string>();
            do {
              const result = record(await codexHistoryRequest(this.codexExecutable(), 'thread/list', { cwd: directory, limit: 100, sortKey: 'updated_at', cursor, sourceKinds: [], modelProviders: [] }));
              for (const raw of array(result.data)) {
                const session = record(raw);
                if (!text(session.id) || canonicalDirectory(text(session.cwd)) !== directory) continue;
                sessions.push({ provider: 'codex', threadId: text(session.id), directory, title: text(session.name) || text(session.preview),
                  createdAt: timestamp(session.createdAt, 1000), updatedAt: timestamp(session.updatedAt, 1000) });
              }
              cursor = text(result.nextCursor) || null;
              if (cursor && cursors.has(cursor)) throw new Error('Repeated history cursor');
              if (cursor) cursors.add(cursor);
            } while (cursor);
          } catch { errors.push('Codex history could not be read. Check the CLI in Settings → Agents. Existing Fuse chats are still available.'); }
        })(),
      ]);
    }
    return { sessions, errors: [...new Set(errors)] };
  }

  async read(ref: NativeSessionRef): Promise<TranscriptRow[]> {
    if (ref.provider === 'claude') {
      const info = await getSessionInfo(ref.threadId, { dir: ref.directory });
      if (!info || (info.cwd && canonicalDirectory(info.cwd) !== canonicalDirectory(ref.directory))) throw new Error('Session is missing or belongs to a different folder.');
      return claudeMessages(await getSessionMessages(ref.threadId, { dir: ref.directory }));
    }
    const result = record(await codexHistoryRequest(this.codexExecutable(), 'thread/read', { threadId: ref.threadId, includeTurns: true }));
    const thread = record(result.thread);
    if (canonicalDirectory(text(thread.cwd)) !== canonicalDirectory(ref.directory)) throw new Error('Session belongs to a different folder.');
    return codexMessages(thread);
  }
}
