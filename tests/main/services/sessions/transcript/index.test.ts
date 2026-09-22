import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appPaths } from '@main/paths';
import { Registry } from '@main/store/registry';
import type { ConversationRow, TranscriptRow } from '@main/store/rows';
import {
  ConversationStore,
  historyDetail,
  historySummary,
  historyTier,
  initialOnlyRows,
  orderRows,
  resumeTranscript,
  subagentSummaries,
  subagentTimeline,
  type StoredConversationFile,
} from '@main/services/sessions/transcript';

let dir: string;
let registry: Registry;
let store: ConversationStore;

function row(overrides: Partial<TranscriptRow> & { id: string; created_at: string }): TranscriptRow {
  return {
    role: 'agent',
    content: '',
    delivered_at: null,
    delivery_state: null,
    context_attachments: [],
    event_kind: null,
    tool_name: null,
    tool_use_id: null,
    parent_tool_use_id: null,
    is_subagent: false,
    ...overrides,
  };
}

function toolRow(id: string, createdAt: string, content: Record<string, unknown>): TranscriptRow {
  return row({
    id,
    created_at: createdAt,
    role: 'tool',
    content: JSON.stringify(content),
    event_kind: content.kind as string,
    tool_name: (content.tool as string | undefined) ?? null,
    tool_use_id: (content.tool_use_id as string | undefined) ?? null,
    parent_tool_use_id: (content.parent_tool_use_id as string | undefined) ?? null,
    is_subagent: content.is_subagent === true,
  });
}

function conversation(id = 'c1'): ConversationRow {
  return {
    id,
    repository_id: 1,
    blueprint_id: 'sample',
    title: 'Prove it',
    status: 'running',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    completed_at: null,
    input_tokens: null,
    output_tokens: null,
    total_cost_usd: null,
    provider_thread_id: null,
    provider: 'claude',
    tier: 'active',
    background_updates: [],
    roadblocks: [],
  };
}

const T = (seconds: number): string => `2026-01-01T00:00:${String(seconds).padStart(2, '0')}.000Z`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fuse-sessions-'));
  registry = new Registry(appPaths(dir));
  store = new ConversationStore(appPaths(dir), registry);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('ConversationStore', () => {
  it('stores native references instead of verified duplicate rows, retaining queued and unmatched work', async () => {
    store.create(conversation());
    const delivered = row({ id: 'u1', role: 'user', content: 'Hello', delivery_state: 'delivered', created_at: T(0) });
    const reply = row({ id: 'a1', content: 'Hi', created_at: T(1) });
    const pending = row({ id: 'u2', role: 'user', content: 'Next', delivery_state: 'queued', created_at: T(2) });
    const unmatched = row({ id: 'a2', content: 'Not flushed by provider yet', created_at: T(3) });
    for (const entry of [delivered, reply, pending, unmatched]) store.appendRow('c1', entry);
    const ref = { provider: 'claude' as const, threadId: 'native-thread', directory: '/repo' };
    store.checkpointNative('c1', ref, [{ ...delivered, id: 'native-u' }, { ...reply, id: 'native-a' }]);
    await store.settled('c1');
    const persisted = JSON.parse(readFileSync(appPaths(dir).conversationFile('c1'), 'utf8'));
    expect(persisted.nativeRef).toEqual(ref);
    expect(persisted.messages.map((entry: TranscriptRow) => entry.id)).toEqual(['u2', 'a2']);
    expect(persisted.nativeCoveredIds).toBeUndefined();
    expect(store.get('c1')?.messages).toHaveLength(4);
    const reopened = new ConversationStore(appPaths(dir), registry);
    const hydrated = reopened.hydrateNative('c1', [{ ...delivered, id: 'native-u' }, { ...reply, id: 'native-a' }]);
    expect(hydrated.messages.map((entry) => entry.content)).toEqual(['Hello', 'Hi', 'Next', 'Not flushed by provider yet']);
    reopened.updateRow('c1', { title: 'Renamed' });
    await reopened.settled('c1');
    expect(JSON.parse(readFileSync(appPaths(dir).conversationFile('c1'), 'utf8')).messages).toHaveLength(2);
    const laterNative = [{ ...delivered, id: 'native-u' }, { ...reply, id: 'native-a' }, { ...unmatched, id: 'native-late' }];
    reopened.checkpointNative('c1', ref, laterNative);
    expect(reopened.hydrateNative('c1', laterNative).messages.filter((entry) => entry.content === unmatched.content)).toHaveLength(1);
  });

  it('does not drop a repeated message before its native copy exists', async () => {
    store.create(conversation());
    const first = row({ id: 'u1', role: 'user', content: 'Again', delivery_state: 'delivered', created_at: T(0) });
    store.appendRow('c1', first);
    store.appendRow('c1', { ...first, id: 'u2', created_at: T(1) });
    store.checkpointNative('c1', { provider: 'codex', threadId: 'x', directory: '/repo' }, [first]);
    await store.settled('c1');
    expect(JSON.parse(readFileSync(appPaths(dir).conversationFile('c1'), 'utf8')).messages.map((entry: TranscriptRow) => entry.id)).toEqual(['u2']);
  });

  it('keeps clean Fuse prompts when native history includes injected context and refreshes summaries', async () => {
    store.create(conversation());
    const prompt = row({ id: 'u1', role: 'user', content: 'Prove it', created_at: T(0) });
    const reply = row({ id: 'a1', content: 'Done', created_at: T(1) });
    store.appendRow('c1', prompt);
    store.appendRow('c1', reply);
    const native = [{ ...prompt, id: 'native-u', content: 'Workspace context\n\nUser message: Prove it' }, { ...reply, id: 'native-a' }];
    store.checkpointNative('c1', { provider: 'claude', threadId: 'x', directory: '/repo' }, native);
    await store.settled('c1');
    expect(JSON.parse(readFileSync(appPaths(dir).conversationFile('c1'), 'utf8')).messages.map((entry: TranscriptRow) => entry.id)).toEqual(['u1']);
    const reopened = new ConversationStore(appPaths(dir), registry);
    const hydrated = reopened.hydrateNative('c1', [...native, row({ id: 'native-later', content: 'Added in CLI', created_at: T(2) })]);
    expect(hydrated.messages.map((entry) => entry.content)).toEqual(['Prove it', 'Done', 'Added in CLI']);
    expect(historySummary(hydrated, null)).toMatchObject({ message_count: 3, first_message: 'Prove it', last_message: 'Added in CLI' });
    reopened.appendRow('c1', row({ id: 'u2', role: 'user', content: 'Continue', created_at: T(3) }));
    expect(historySummary(reopened.get('c1')!, null).last_message).toBe('Continue');
  });

  it('round-trips rows, delivery states and the replay boundary through the file', async () => {
    store.create(conversation(), { background_started_at: T(0) });
    store.appendRow('c1', row({ id: 'u1', role: 'user', content: 'hi', created_at: T(0) }), null);
    store.appendRow('c1', row({ id: 'a1', content: 'hello', created_at: T(1) }), 3);
    store.appendRow('c1', row({ id: 'u2', role: 'user', content: 'more', created_at: T(2), delivery_state: 'queued' }), null);
    store.setDeliveryState('c1', 'u2', 'delivered');
    store.setLastPersistedEventId('c1', 2);
    await store.settled('c1');

    const reopened = new ConversationStore(appPaths(dir), new Registry(appPaths(dir)));
    const doc = reopened.get('c1');
    expect(doc?.messages.map((entry) => entry.id)).toEqual(['u1', 'a1', 'u2']);
    expect(doc?.messages[2]).toMatchObject({ delivery_state: 'delivered' });
    expect(typeof doc?.messages[2].delivered_at).toBe('string');
    expect(doc?.last_persisted_event_id).toBe(3);
    expect(doc?.background_started_at).toBe(T(0));
    expect(registry.getConversation('c1')?.title).toBe('Prove it');
    registry.flushSync();
    expect(new Registry(appPaths(dir)).getConversation('c1')?.id).toBe('c1');
  });

  it('deletes the file and the index row', async () => {
    store.create(conversation());
    await store.settled('c1');
    store.delete('c1');
    expect(store.get('c1')).toBeNull();
    expect(registry.getConversation('c1')).toBeNull();
    expect(new ConversationStore(appPaths(dir), registry).get('c1')).toBeNull();
  });
});

describe('history assembly', () => {
  function doc(messages: TranscriptRow[], overrides: Partial<StoredConversationFile> = {}): StoredConversationFile {
    return { row: conversation(), messages, last_persisted_event_id: 0, background_started_at: null, background_reviewed_at: null, ...overrides };
  }

  it('orders rows by delivery time so a delivered steer follows the prose it arrived during', () => {
    const rows = [
      row({ id: 'u1', role: 'user', content: 'q', created_at: T(0) }),
      row({ id: 'u2', role: 'user', content: 'steer', created_at: T(1), delivery_state: 'steered', delivered_at: T(4) }),
      row({ id: 'a1', content: 'first', created_at: T(2) }),
      row({ id: 'a2', content: 'second', created_at: T(4) }),
    ];
    expect(orderRows(rows).map((entry) => entry.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('keeps the orchestrator transcript and drops child internals for the detail view', () => {
    const rows = [
      row({ id: 'u1', role: 'user', content: 'q', created_at: T(0) }),
      toolRow('t1', T(1), { kind: 'tool_call', tool_use_id: 'task_1', tool: 'Task', input: { description: 'prove' }, is_subagent: false, parent_tool_use_id: null, model: null }),
      toolRow('t2', T(2), { kind: 'tool_call', tool_use_id: 'sub_1', tool: 'Read', input: { file_path: 'A.lean' }, is_subagent: true, parent_tool_use_id: 'task_1', model: null }),
      toolRow('t3', T(3), { kind: 'tool_result', tool_use_id: 'sub_1', result: 'x', is_error: false, is_subagent: true, parent_tool_use_id: 'task_1' }),
      toolRow('t4', T(4), { kind: 'subagent_text', parent_tool_use_id: 'task_1', text: 'Working', message_id: 'm' }),
      toolRow('t5', T(5), { kind: 'agent_status', agent: 'prover', status: 'completed', tool_use_id: 'task_1' }),
      toolRow('t6', T(6), { kind: 'tool_result', tool_use_id: 'task_1', result: 'PROVED', is_error: false, is_subagent: false, parent_tool_use_id: null }),
      toolRow('t7', T(7), { kind: 'build_status', phase: 'building', message: 'Building' }),
      row({ id: 'a1', content: 'done', created_at: T(8) }),
    ];
    expect(initialOnlyRows(orderRows(rows)).map((entry) => entry.id)).toEqual(['u1', 't1', 't5', 't6', 't7', 'a1']);
    const detail = historyDetail(doc(rows), null, { initialOnly: true });
    expect(detail.subagent_history_lazy).toBe(true);
    expect(detail.can_resume).toBe(true);
    expect(detail.last_persisted_event_id).toBeNull();
    expect(detail.message_count).toBe(9);
    expect(detail.first_message).toBe('q');
    expect(detail.last_message).toBe('done');
    expect(detail.messages[0]).toEqual({ id: 'u1', role: 'user', content: 'q', created_at: T(0), delivery_state: null, context_attachments: [] });
    expect(detail.subagents).toEqual([
      {
        parent_tool_use_id: 'task_1',
        tool_call_count: 1,
        recent_tool_calls: [{ tool_use_id: 'sub_1', tool: 'Read', input: { file_path: 'A.lean' }, created_at: T(2) }],
        started_at: T(1),
        ended_at: T(5),
      },
    ]);
    // Lifecycle rows bound the run from the caller's transcript; the timeline
    // holds only what the child itself did.
    const timeline = subagentTimeline(doc(rows), 'task_1');
    expect(timeline.messages.map((entry) => entry.id)).toEqual(['t2', 't3', 't4']);
    expect(timeline).toMatchObject({ parent_tool_use_id: 'task_1', started_at: T(1), ended_at: T(5) });
  });

  it('previews the last three child calls oldest to newest with reduced inputs', () => {
    const rows = [toolRow('spawn', T(0), { kind: 'tool_call', tool_use_id: 'task_1', tool: 'Task', input: {}, is_subagent: false, parent_tool_use_id: null, model: null })];
    for (let index = 1; index <= 5; index += 1) {
      rows.push(toolRow(`c${index}`, T(index), { kind: 'tool_call', tool_use_id: `sub_${index}`, tool: 'Bash', input: { command: `cmd ${index}`, extra: 'dropped' }, is_subagent: true, parent_tool_use_id: 'task_1', model: null }));
    }
    const [summary] = subagentSummaries(rows);
    expect(summary.tool_call_count).toBe(5);
    expect(summary.recent_tool_calls.map((call) => call.input)).toEqual([{ command: 'cmd 3' }, { command: 'cmd 4' }, { command: 'cmd 5' }]);
    expect(summary.ended_at).toBeNull();
  });

  it('lists runs known only from their calls after spawned ones', () => {
    const rows = [
      toolRow('c1', T(1), { kind: 'tool_call', tool_use_id: 'x', tool: 'Read', input: {}, is_subagent: true, parent_tool_use_id: 'orphan', model: null }),
      toolRow('spawn', T(2), { kind: 'tool_call', tool_use_id: 'task_1', tool: 'Task', input: {}, is_subagent: false, parent_tool_use_id: null, model: null }),
    ];
    expect(subagentSummaries(rows).map((entry) => entry.parent_tool_use_id)).toEqual(['task_1', 'orphan']);
  });

  it('classifies tiers by job and live state', () => {
    const base = doc([]);
    expect(historyTier(base, { status: 'running', turnActive: true, hasPendingWork: false, lastPersistedEventId: 0 })).toBe('active');
    expect(historyTier(base, { status: 'running', turnActive: false, hasPendingWork: false, lastPersistedEventId: 0 })).toBe('waiting_for_review');
    expect(historyTier(doc([], { background_reviewed_at: T(1) }), { status: 'running', turnActive: false, hasPendingWork: false, lastPersistedEventId: 0 })).toBe('completed');
    expect(historyTier(base, null)).toBe('active');
    const ended = doc([], { row: { ...conversation(), status: 'completed' } });
    expect(historyTier(ended, null)).toBe('waiting_for_review');
    expect(historyTier({ ...ended, background_reviewed_at: T(1) }, null)).toBe('completed');
  });

  it('extracts legacy background-log entries and roadblocks', () => {
    const rows = [
      toolRow('w', T(1), {
        kind: 'tool_call',
        tool_use_id: 'w1',
        tool: 'Write',
        input: { file_path: 'numina/.metadata/blueprints/x/runs/1/background-log.md', content: '- [2026-01-01] Proved lemma A\n- [2026-01-01] Blocked: need human input on B\n- [2026-01-01] Proved lemma A\n' },
        is_subagent: false,
        parent_tool_use_id: null,
        model: null,
      }),
    ];
    const summary = historySummary(doc(rows), null);
    expect(summary.background_updates).toEqual(['Proved lemma A']);
    expect(summary.roadblocks).toEqual(['Blocked: need human input on B']);
    expect(historySummary(doc(rows), null, { includeLegacyBackgroundProgress: false }).background_updates).toEqual([]);
  });

  it('builds the resume transcript without queued or superseded rows', () => {
    const rows = [
      row({ id: 'u1', role: 'user', content: 'q', created_at: T(0) }),
      row({ id: 'a1', content: 'a', created_at: T(1) }),
      toolRow('t', T(2), { kind: 'build_status', phase: 'building', message: '' }),
      row({ id: 'u2', role: 'user', content: 'lost', created_at: T(3), delivery_state: 'superseded' }),
      row({ id: 'u3', role: 'user', content: 'kept', created_at: T(4), delivery_state: 'retained', delivered_at: T(9) }),
      row({ id: 'u4', role: 'user', content: 'waiting', created_at: T(5), delivery_state: 'queued' }),
    ];
    expect(resumeTranscript(doc(rows))).toEqual([
      { role: 'user', content: 'q' },
      { role: 'agent', content: 'a' },
      { role: 'user', content: 'kept', delivery_state: 'retained', message_id: 'u3' },
    ]);
  });
});
