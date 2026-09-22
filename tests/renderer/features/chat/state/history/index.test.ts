import { beforeEach, describe, expect, it } from 'vitest';
import { attachActivitiesToMessages, hydratePersistedSubagents, mergePersistedSubagentTimeline, reconstructHistoryActivities, reconstructHistoryBuilds, reconstructHistorySubagents } from '@/features/chat/state/history';
import type { ActivityItem, ChatMessage, PersistedChatMessage, SessionHistoryDetail } from '@/features/chat/state/types';

let counter = 0;
const message = (role: PersistedChatMessage['role'], content: string): PersistedChatMessage => ({
  id: `m${++counter}`, role, content, created_at: '2026-04-08T12:00:00Z',
});
const tool = (payload: Record<string, unknown>) => message('tool', JSON.stringify(payload));

beforeEach(() => { counter = 0; });

describe('history reconstruction', () => {
  it('rebuilds completed and failed build cards per turn', () => {
    const values = reconstructHistoryBuilds([
      message('user', 'one'), tool({ kind: 'build_status', phase: 'preparing' }),
      tool({ kind: 'build_status', phase: 'building' }), message('agent', 'done'),
      message('user', 'two'), tool({ kind: 'build_status', phase: 'building' }),
      tool({ kind: 'build_status', phase: 'failed' }),
    ]);
    expect(values).toHaveLength(2);
    expect(values[0]).toMatchObject({ status: 'done', turnId: 'turn-0', steps: [{ status: 'done' }, { status: 'done' }] });
    expect(values[1]).toMatchObject({ status: 'failed', turnId: 'turn-2' });
  });

  it('ignores invalid and unrelated build transcript entries', () => {
    expect(reconstructHistoryBuilds([
      message('tool', '{bad'), tool({ kind: 'build_status', phase: 'complete' }),
    ])).toEqual([]);
  });

  it('reconstructs prover text, nested calls, model, and terminal status', () => {
    const values = reconstructHistorySubagents([
      message('user', 'prove'),
      tool({ kind: 'tool_call', tool_use_id: 'p1', tool: 'Agent', input: { description: 'Prove Foo', synthetic_for: 'prover', status: 'queued', batch_id: 'prover-batch-1' }, model: 'Prover' }),
      tool({ kind: 'tool_call', tool_use_id: 'r1', parent_tool_use_id: 'p1', tool: 'Read', input: { file_path: '/tmp/Foo.lean' }, is_subagent: true }),
      tool({ kind: 'subagent_text', parent_tool_use_id: 'p1', text: 'PROVED: Foo' }),
      tool({ kind: 'agent_status', tool_use_id: 'p1', status: 'failed' }),
    ], false);
    expect(values).toHaveLength(1);
    // The published verdict survives replay: a reload must not turn a failed
    // run green just because the child's prose claimed a proof.
    expect(values[0]).toMatchObject({ parentToolUseId: 'p1', status: 'failed', text: 'PROVED: Foo', model: 'Prover', batchId: 'prover-batch-1' });
    expect(values[0].toolCalls[0]).toMatchObject({ tool: 'Read', summary: 'Foo.lean', parentToolUseId: 'p1', toolUseId: 'r1' });
  });

  it('restores the structured launcher pairing keys on reload', () => {
    const values = reconstructHistorySubagents([
      message('user', 'prove'),
      tool({ kind: 'tool_call', tool_use_id: 'p1', tool: 'Agent', input: { description: 'Prove Foo', synthetic_for: 'prover', batch_id: 'batch-1', launcher_tool: 'prover-tools' } }),
      tool({ kind: 'tool_call', tool_use_id: 'w1', tool: 'Agent', input: { description: 'Prove Bar', synthetic_for: 'authoring', batch_id: 'batch-2', launcher_tool: 'authoring-tools', specialist_target: 'lean/Project/Basic.lean' } }),
    ], false);

    // Dropping launcherTool here made a reloaded run fall back to the legacy
    // `/^Prove /i` description heuristic, which pairs both of these children
    // with the prover launcher and gives the second one the wrong batch header.
    expect(values.map((value) => value.launcherTool)).toEqual([
      'prover-tools',
      'authoring-tools',
    ]);
    expect(values.map((value) => value.batchId)).toEqual(['batch-1', 'batch-2']);
    // Losing the artifact on reload would merge two specialists the live view
    // kept apart (ADR 051).
    expect(values.map((value) => value.specialistTarget)).toEqual([
      undefined,
      'lean/Project/Basic.lean',
    ]);
  });

  it('ignores an unrecognized persisted launcher tool', () => {
    const values = reconstructHistorySubagents([
      message('user', 'go'),
      tool({ kind: 'tool_call', tool_use_id: 'p1', tool: 'Agent', input: { synthetic_for: 'prover', launcher_tool: 'made-up-tools' } }),
    ], false);
    expect(values[0].launcherTool).toBeUndefined();
  });

  it('preserves delegated message positions around tool calls', () => {
    const values = reconstructHistorySubagents([
      message('user', 'work'),
      tool({ kind: 'tool_call', tool_use_id: 'a1', tool: 'Agent', input: { synthetic_for: 'delegated-multistep' } }),
      tool({ kind: 'subagent_message', parent_tool_use_id: 'a1', text: 'First', message_id: 'message-1' }),
      tool({ kind: 'tool_call', tool_use_id: 'r1', parent_tool_use_id: 'a1', tool: 'Read', input: { file_path: 'Foo.lean' }, is_subagent: true }),
      tool({ kind: 'subagent_message', parent_tool_use_id: 'a1', text: 'Second' }),
      tool({ kind: 'subagent_text', parent_tool_use_id: 'a1', text: 'Done' }),
    ], false);

    expect(values[0].messages).toEqual([
      expect.objectContaining({ text: 'First', messageId: 'message-1' }),
      expect.objectContaining({ text: 'Second' }),
    ]);
    expect(values[0].messages?.[0].order).toBeLessThan(values[0].toolCalls[0].order ?? 0);
    expect(values[0].messages?.[1].order).toBeGreaterThan(values[0].toolCalls[0].order ?? 0);
  });

  it('merges child events persisted before their spawn into one card', () => {
    const values = reconstructHistorySubagents([
      message('user', 'work'),
      tool({
        kind: 'subagent_message',
        parent_tool_use_id: 'a1',
        text: 'Starting from the statement.',
        message_id: 'message-1',
      }),
      tool({
        kind: 'tool_call',
        tool_use_id: 'r1',
        parent_tool_use_id: 'a1',
        tool: 'Read',
        input: { file_path: 'Foo.lean' },
        is_subagent: true,
      }),
      tool({ kind: 'agent_status', tool_use_id: 'a1', status: 'completed' }),
      tool({
        kind: 'tool_call',
        tool_use_id: 'a1',
        tool: 'Agent',
        input: {
          description: 'Formalize Foo',
          synthetic_for: 'delegated-multistep',
          status: 'queued',
        },
      }),
    ], true);

    expect(values).toHaveLength(1);
    expect(values[0]).toMatchObject({
      parentToolUseId: 'a1',
      description: 'Formalize Foo',
      synthetic: 'delegated-multistep',
      status: 'done',
    });
    expect(values[0].messages).toEqual([
      expect.objectContaining({
        text: 'Starting from the statement.',
        messageId: 'message-1',
      }),
    ]);
    expect(values[0].toolCalls).toEqual([
      expect.objectContaining({ tool: 'Read', toolUseId: 'r1' }),
    ]);
  });

  it('anchors late synthetic spawns to the batch tool call', () => {
    const values = reconstructHistorySubagents([
      message('user', 'formalize'), message('agent', 'calling'),
      tool({ kind: 'tool_call', tool: 'mcp__authoring-tools__formalize', input: {} }),
      message('user', 'next'),
      tool({ kind: 'tool_call', tool_use_id: 'writer', tool: 'Agent', input: { synthetic_for: 'authoring' } }),
    ], false);
    expect(values[0]).toMatchObject({ anchorTurnId: 'turn-0', anchorAfterMessageCount: 1 });
  });

  it('nests synthetic child explores under their caller', () => {
    const values = reconstructHistorySubagents([
      message('user', 'go'),
      tool({ kind: 'tool_call', tool_use_id: 'explore', parent_tool_use_id: 'writer', tool: 'Agent', input: { synthetic_for: 'explore' } }),
    ], true);
    expect(values[0]).toMatchObject({ parentSubagentId: 'writer', status: 'running' });
  });

  it('treats a Task spawn as a plain subagent, never a synthetic one', () => {
    // Only backend code sets `synthetic_for`, and it always publishes the spawn
    // as `Agent`; reading synthetic metadata off a `Task` spawn would give the
    // reloaded card batch pairing and nesting the live handler never applied.
    const values = reconstructHistorySubagents([
      message('user', 'go'),
      tool({ kind: 'tool_call', tool_use_id: 'explore', parent_tool_use_id: 'writer', tool: 'Task', input: { synthetic_for: 'explore', batch_id: 'batch-1', launcher_tool: 'authoring-tools' } }),
    ], true);
    expect(values[0]).toMatchObject({ parentToolUseId: 'explore', status: 'running' });
    expect(values[0].synthetic).toBeUndefined();
    expect(values[0].parentSubagentId).toBeUndefined();
    expect(values[0].batchId).toBeUndefined();
    expect(values[0].launcherTool).toBeUndefined();
  });

  it('repairs unterminated nested agents when their parent was cancelled', () => {
    const values = reconstructHistorySubagents([
      message('user', 'go'),
      tool({ kind: 'tool_call', tool_use_id: 'parent', tool: 'Agent', input: { synthetic_for: 'delegated-multistep' } }),
      tool({ kind: 'tool_call', tool_use_id: 'child', parent_tool_use_id: 'parent', tool: 'Agent', input: { synthetic_for: 'authoring' } }),
      tool({ kind: 'agent_status', tool_use_id: 'parent', status: 'stopped' }),
    ], true);

    expect(values.map((value) => value.status)).toEqual(['cancelled', 'cancelled']);
  });

  it('marks stale queued streams failed after a later user turn', () => {
    const values = reconstructHistorySubagents([
      message('user', 'go'), tool({ kind: 'tool_call', tool_use_id: 'a', tool: 'Agent', input: { status: 'queued' } }),
      message('user', 'next'),
    ], false);
    expect(values[0].status).toBe('failed');
  });

  it('uses running for live and done for ended unterminated streams', () => {
    const transcript = [message('user', 'go'), tool({ kind: 'tool_call', tool_use_id: 'a', tool: 'Agent', input: {} })];
    expect(reconstructHistorySubagents(transcript, true)[0].status).toBe('running');
    expect(reconstructHistorySubagents(transcript, false)[0].status).toBe('done');
  });

  it('hydrates bounded previews for a lazy child timeline', () => {
    const messages = [
      message('user', 'go'),
      tool({
        kind: 'tool_call',
        tool_use_id: 'child-1',
        tool: 'Agent',
        input: { description: 'Inspect the proof' },
      }),
    ];
    const detail: SessionHistoryDetail = {
      id: 'conversation-1',
      status: 'completed',
      blueprint_name: 'example',
      created_at: '2026-04-08T12:00:00Z',
      completed_at: '2026-04-08T12:01:00Z',
      input_tokens: null,
      output_tokens: null,
      total_cost_usd: null,
      message_count: messages.length,
      first_message: 'go',
      last_message: null,
      messages,
      subagent_history_lazy: true,
      subagents: [{
        parent_tool_use_id: 'child-1',
        tool_call_count: 7,
        recent_tool_calls: [{
          tool_use_id: 'read-1',
          tool: 'Read',
          input: { file_path: 'Main.lean' },
          created_at: '2026-04-08T12:00:01Z',
        }],
      }],
    };

    expect(hydratePersistedSubagents(detail, false)[0]).toMatchObject({
      parentToolUseId: 'child-1',
      historyLoaded: false,
      historyLoading: false,
      toolCallCount: 7,
      toolCalls: [expect.objectContaining({
        toolUseId: 'read-1',
        summary: 'Main.lean',
      })],
    });
  });

  it('dates a reloaded run from the span the backend derived', () => {
    const messages = [
      message('user', 'go'),
      tool({
        kind: 'tool_call',
        tool_use_id: 'child-1',
        tool: 'Agent',
        input: { description: 'Inspect the proof' },
      }),
      tool({
        kind: 'tool_call',
        tool_use_id: 'child-2',
        tool: 'Agent',
        input: { description: 'Keep going' },
      }),
    ];
    const detail: SessionHistoryDetail = {
      id: 'conversation-1',
      status: 'completed',
      blueprint_name: 'example',
      created_at: '2026-04-08T12:00:00Z',
      completed_at: '2026-04-08T12:01:00Z',
      input_tokens: null,
      output_tokens: null,
      total_cost_usd: null,
      message_count: messages.length,
      first_message: 'go',
      last_message: null,
      messages,
      subagent_history_lazy: true,
      subagents: [
        {
          parent_tool_use_id: 'child-1',
          tool_call_count: 0,
          started_at: '2026-04-08T12:00:00Z',
          ended_at: '2026-04-08T12:02:14Z',
        },
        {
          parent_tool_use_id: 'child-2',
          tool_call_count: 0,
          started_at: '2026-04-08T12:00:00Z',
          ended_at: null,
        },
      ],
    };

    const [finished, unterminated] = hydratePersistedSubagents(detail, false);
    expect(finished.endedAt! - finished.startedAt!).toBe(134_000);
    expect(unterminated.startedAt).toBe(Date.parse('2026-04-08T12:00:00Z'));
    expect(unterminated.endedAt).toBeUndefined();
  });

  it('merges a fetched child timeline without duplicating its preview', () => {
    const messages = [
      message('user', 'go'),
      tool({
        kind: 'tool_call',
        tool_use_id: 'child-1',
        tool: 'Agent',
        input: { description: 'Inspect the proof' },
      }),
    ];
    const detail: SessionHistoryDetail = {
      id: 'conversation-1',
      status: 'completed',
      blueprint_name: 'example',
      created_at: '2026-04-08T12:00:00Z',
      completed_at: '2026-04-08T12:01:00Z',
      input_tokens: null,
      output_tokens: null,
      total_cost_usd: null,
      message_count: messages.length,
      first_message: 'go',
      last_message: null,
      messages,
      subagent_history_lazy: true,
      subagents: [{
        parent_tool_use_id: 'child-1',
        tool_call_count: 1,
        recent_tool_calls: [{
          tool_use_id: 'read-1',
          tool: 'Read',
          input: { file_path: 'Main.lean' },
          created_at: '2026-04-08T12:00:01Z',
        }],
      }],
    };
    const current = hydratePersistedSubagents(detail, false);
    const merged = mergePersistedSubagentTimeline(
      current,
      'child-1',
      {
        parent_tool_use_id: 'child-1',
        messages: [
          tool({
            kind: 'tool_call',
            tool_use_id: 'read-1',
            parent_tool_use_id: 'child-1',
            tool: 'Read',
            input: { file_path: 'Main.lean' },
            is_subagent: true,
          }),
          tool({
            kind: 'tool_result',
            tool_use_id: 'read-1',
            result: 'done',
          }),
        ],
      },
      detail,
      false,
    );

    expect(merged[0]).toMatchObject({
      historyLoaded: true,
      historyLoading: false,
      toolCallCount: 1,
    });
    expect(merged[0].toolCalls).toEqual([
      expect.objectContaining({ toolUseId: 'read-1', result: 'done' }),
    ]);
  });

  it('reconstructs visible parent activities with stable anchors', () => {
    const values = reconstructHistoryActivities([
      message('user', 'edit'), message('agent', 'reading'),
      tool({ kind: 'tool_call', tool_use_id: 'read', tool: 'Read', input: { file_path: '/tmp/Foo.lean' } }),
      tool({ kind: 'tool_call', tool: 'Write', input: { file_path: 'x/background-log.md' } }),
      tool({ kind: 'tool_call', tool: 'Agent', input: {} }),
      tool({ kind: 'tool_call', tool: 'Grep', input: { pattern: 'x' }, is_subagent: true }),
    ]);
    expect(values).toEqual([expect.objectContaining({ tool: 'Read', summary: 'Foo.lean', anchorTurnId: 'turn-0', anchorAfterMessageCount: 1, order: 2, toolUseId: 'read' })]);
  });

  it('skips queued users in activity and subagent anchors but counts steered users', () => {
    const queued = { ...message('user', 'wait'), delivery_state: 'queued' as const };
    const steered = { ...message('user', 'change direction'), delivery_state: 'steered' as const };
    const transcript = [
      message('user', 'start'),
      message('agent', 'working'),
      queued,
      tool({ kind: 'tool_call', tool_use_id: 'read', tool: 'Read', input: { file_path: 'Main.lean' } }),
      tool({ kind: 'tool_call', tool_use_id: 'queued-child', tool: 'Agent', input: {} }),
      steered,
      tool({ kind: 'tool_call', tool_use_id: 'grep', tool: 'Grep', input: { pattern: 'theorem' } }),
      tool({ kind: 'tool_call', tool_use_id: 'steered-child', tool: 'Agent', input: {} }),
    ];

    expect(reconstructHistoryActivities(transcript)).toEqual([
      expect.objectContaining({ toolUseId: 'read', anchorTurnId: 'turn-0', anchorAfterMessageCount: 1 }),
      expect.objectContaining({ toolUseId: 'grep', anchorTurnId: 'turn-2', anchorAfterMessageCount: 0 }),
    ]);
    expect(reconstructHistorySubagents(transcript, true)).toEqual([
      expect.objectContaining({ parentToolUseId: 'queued-child', anchorTurnId: 'turn-0', anchorAfterMessageCount: 1 }),
      expect.objectContaining({ parentToolUseId: 'steered-child', anchorTurnId: 'turn-2', anchorAfterMessageCount: 0 }),
    ]);
  });

  it('counts a locally optimistic queued user across persisted reconstruction', () => {
    const queued = { ...message('user', 'next'), delivery_state: 'queued' as const };
    const transcript = [
      message('user', 'start'),
      message('agent', 'first answer'),
      queued,
      tool({ kind: 'build_status', phase: 'building' }),
      tool({
        kind: 'tool_call',
        tool_use_id: 'read',
        tool: 'Read',
        input: { file_path: 'Main.lean' },
      }),
      tool({
        kind: 'tool_call',
        tool_use_id: 'child',
        tool: 'Agent',
        input: {},
      }),
    ];
    const optimisticTurnMessageIds = new Set([queued.id]);

    expect(reconstructHistoryBuilds(
      transcript,
      optimisticTurnMessageIds,
    )[0]).toMatchObject({ turnId: 'turn-2' });
    expect(reconstructHistoryActivities(
      transcript,
      optimisticTurnMessageIds,
    )[0]).toMatchObject({ toolUseId: 'read', anchorTurnId: 'turn-2' });
    expect(reconstructHistorySubagents(
      transcript,
      true,
      optimisticTurnMessageIds,
    )[0]).toMatchObject({
      parentToolUseId: 'child',
      anchorTurnId: 'turn-2',
    });
  });

  it('attaches denied tool results to parent and child calls', () => {
    const transcript = [
      message('user', 'inspect'),
      tool({ kind: 'tool_call', tool_use_id: 'parent-read', tool: 'Read', input: { file_path: '/outside' } }),
      tool({ kind: 'tool_result', tool_use_id: 'parent-read', is_error: true, result: 'outside workspace' }),
      tool({ kind: 'tool_call', tool_use_id: 'agent', tool: 'Agent', input: {} }),
      tool({ kind: 'tool_call', tool_use_id: 'child-read', parent_tool_use_id: 'agent', tool: 'Read', input: { file_path: '/outside' }, is_subagent: true }),
      tool({ kind: 'tool_result', tool_use_id: 'child-read', is_error: true, result: 'outside workspace' }),
    ];

    expect(reconstructHistoryActivities(transcript)[0]).toMatchObject({
      toolUseId: 'parent-read', isError: true, result: 'outside workspace',
    });
    expect(reconstructHistorySubagents(transcript, false)[0].toolCalls[0]).toMatchObject({
      toolUseId: 'child-read', isError: true, result: 'outside workspace',
    });
  });
});

describe('attachActivitiesToMessages', () => {
  const activity = (anchorTurnId: string): ActivityItem => ({ tool: 'Read', summary: 'Foo.lean', anchorTurnId });

  it('attaches to the first assistant message without replacing existing activity', () => {
    const existing: ActivityItem = { tool: 'Grep', summary: 'x' };
    const messages: ChatMessage[] = [
      { role: 'user', text: 'edit' }, { role: 'agent', text: 'Reading', activities: [existing] }, { role: 'agent', text: 'Done' },
    ];
    expect(attachActivitiesToMessages(messages, [activity('turn-0')])[1].activities).toEqual([existing, activity('turn-0')]);
  });

  it('inserts a placeholder for tool-only turns', () => {
    const messages: ChatMessage[] = [{ role: 'user', text: 'edit' }];
    attachActivitiesToMessages(messages, [activity('turn-0')]);
    expect(messages).toEqual([
      { role: 'user', text: 'edit' },
      { role: 'agent', text: '', placeholder: true, activities: [activity('turn-0')] },
    ]);
  });

  it('ignores unanchored and unknown-turn activities', () => {
    const messages: ChatMessage[] = [{ role: 'user', text: 'edit' }];
    attachActivitiesToMessages(messages, [{ tool: 'Read', summary: '' }, activity('turn-99')]);
    expect(messages).toHaveLength(1);
  });

  it('does not let a queued row shift later activity attachments', () => {
    const messages: ChatMessage[] = [
      { role: 'user', text: 'start' },
      { role: 'agent', text: 'working' },
      { role: 'user', text: 'wait', deliveryState: 'queued' },
      { role: 'user', text: 'change direction', deliveryState: 'steered' },
      { role: 'agent', text: 'updated' },
    ];
    const first = activity('turn-0');
    const steered = activity('turn-2');

    attachActivitiesToMessages(messages, [first, steered]);

    expect(messages[1].activities).toEqual([first]);
    expect(messages[4].activities).toEqual([steered]);
  });
});
