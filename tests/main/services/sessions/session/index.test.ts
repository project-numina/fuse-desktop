import { describe, expect, it, vi } from 'vitest';
import { SseRoom, type SseFrame } from '@main/server/sse';
import { LocalSession, type SessionHooks, type TurnEndEvent, type TurnRecord } from '@main/services/sessions/session';
import { MemoryTranscript, fakeProject } from '@test/main/services/sessions/test-helpers';

interface Harness {
  session: LocalSession;
  transcript: MemoryTranscript;
  frames: SseFrame[];
  turnEnds: Array<{ event: TurnEndEvent; turn: TurnRecord }>;
  steers: string[];
}

function harness(options: { initialMessages?: LocalSession['messages']; steerable?: boolean; failSteer?: boolean } = {}): Harness {
  const room = new SseRoom('s1');
  const frames: SseFrame[] = [];
  room.subscribe((frame) => {
    if (frame) frames.push(frame);
  });
  const transcript = new MemoryTranscript();
  const turnEnds: Harness['turnEnds'] = [];
  const steers: string[] = [];
  const hooks: SessionHooks = {
    onTurnEnded: (_session, event, turn) => turnEnds.push({ event, turn }),
  };
  const session = new LocalSession({
    sessionId: 's1',
    conversationId: 'c1',
    agentJobId: 'j1',
    project: fakeProject(),
    room,
    transcript,
    hooks,
    attachmentContext: null,
    initialMessages: options.initialMessages ?? [{ role: 'user', content: 'question' }],
    model: 'claude-opus-5',
    providerThreadId: null,
  });
  session.markRunning();
  if (options.steerable !== false) {
    session.steerTarget = {
      steer: async (text) => {
        if (options.failSteer) throw new Error('stdin closed');
        steers.push(text);
      },
    };
  }
  return { session, transcript, frames, turnEnds, steers };
}

function begin(session: LocalSession, turnId = 't1'): void {
  session.beginTurn({ turnId, kind: 'initial', userMessage: 'question', startedAt: Date.now(), wroteLeanFiles: false, hadError: false, lastActivityAt: Date.now() });
  session.consume({ kind: 'turn_started', turnId, at: Date.now() });
}

function names(frames: SseFrame[]): string[] {
  return frames.map((frame) => frame.event);
}

describe('LocalSession consumer', () => {
  it('maps streamed text to stream_start/delta/end and chat with the turn-id formula', () => {
    const { session, frames, transcript } = harness();
    begin(session);
    const turnId = 't1';
    session.consume({ kind: 'assistant_message_started', turnId, at: 1 });
    session.consume({ kind: 'assistant_text_delta', turnId, blockId: 'm1:0', text: 'Hel', at: 1 });
    session.consume({ kind: 'assistant_text_delta', turnId, blockId: 'm1:0', text: 'lo', at: 1 });
    session.consume({ kind: 'assistant_text_completed', turnId, blockId: 'm1:0', text: '  Hello  ', at: 1 });
    expect(names(frames)).toEqual(['session_status', 'turn_status', 'stream_start', 'stream_delta', 'stream_delta', 'stream_end', 'chat']);
    expect(frames[2].data).toEqual({ assistant_turn_id: 'turn-0:assistant-0' });
    expect(frames[3].data).toEqual({ text: 'Hel', assistant_turn_id: 'turn-0:assistant-0' });
    expect(frames[5].data).toEqual({ assistant_turn_id: 'turn-0:assistant-0' });
    expect(frames[6].data).toEqual({ role: 'agent', content: 'Hello', assistant_turn_id: 'turn-0:assistant-0' });
    expect(frames[6].id).toBe(7);
    expect(session.messages[session.messages.length - 1]).toEqual({ role: 'agent', content: 'Hello' });
    expect(transcript.rows).toHaveLength(1);
    expect(transcript.rows[0]).toMatchObject({ role: 'agent', content: 'Hello' });
    expect(transcript.lastPersistedEventId).toBe(7);

    // A second block in the same turn is the next assistant row.
    session.consume({ kind: 'assistant_text_delta', turnId, blockId: 'm1:2', text: 'More', at: 1 });
    expect(frames[frames.length - 2].data).toEqual({ assistant_turn_id: 'turn-0:assistant-1' });
  });

  it('drops blank text blocks without a chat frame or a row', () => {
    const { session, frames, transcript } = harness();
    begin(session);
    session.consume({ kind: 'assistant_text_completed', turnId: 't1', blockId: 'm1:0', text: '   ', at: 1 });
    expect(names(frames)).toEqual(['session_status', 'turn_status']);
    expect(transcript.rows).toHaveLength(0);
    // The complete-message fallback (no deltas) still yields a chat frame.
    session.consume({ kind: 'assistant_text_completed', turnId: 't1', blockId: 'm1:full', text: 'Done', at: 1 });
    expect(names(frames)).toEqual(['session_status', 'turn_status', 'chat']);
  });

  it('publishes tool_call/tool_result with summarised payloads and persists both', () => {
    const { session, frames, transcript } = harness();
    begin(session);
    session.consume({
      kind: 'tool_call_started',
      turnId: 't1',
      toolCallId: 'toolu_1',
      tool: 'Write',
      input: { file_path: 'Sample/Basic.lean', content: 'x'.repeat(6000) },
      parentToolCallId: null,
      at: 1,
    });
    session.consume({ kind: 'tool_call_completed', turnId: 't1', toolCallId: 'toolu_1', result: 'y'.repeat(700), isError: false, at: 1 });
    const call = frames.find((frame) => frame.event === 'tool_call');
    expect(call?.data).toMatchObject({
      tool: 'Write',
      model: 'claude-opus-5',
      tool_use_id: 'toolu_1',
      input: { file_path: 'Sample/Basic.lean', content: `${'x'.repeat(5000)}...`, _fuse_display: { line_counts: { content: 1 } } },
    });
    expect('parent_tool_use_id' in (call?.data as object)).toBe(false);
    const result = frames.find((frame) => frame.event === 'tool_result');
    // Results only travel over the wire on error; the row keeps the summary.
    expect(result?.data).toEqual({ tool_use_id: 'toolu_1', result: null, is_error: false });
    expect(transcript.rows.map((row) => row.event_kind)).toEqual(['tool_call', 'tool_result']);
    expect(JSON.parse(transcript.rows[0].content)).toMatchObject({ kind: 'tool_call', is_subagent: false, parent_tool_use_id: null, model: 'claude-opus-5' });
    expect(JSON.parse(transcript.rows[1].content)).toEqual({
      kind: 'tool_result',
      tool_use_id: 'toolu_1',
      result: `${'y'.repeat(500)}...`,
      is_error: false,
      is_subagent: false,
      parent_tool_use_id: null,
    });
    expect(transcript.rows[0]).toMatchObject({ tool_name: 'Write', tool_use_id: 'toolu_1', is_subagent: false });
    expect(session.currentTurn?.wroteLeanFiles).toBe(true);

    session.consume({ kind: 'tool_call_started', turnId: 't1', toolCallId: 'toolu_2', tool: 'Bash', input: { command: 'false' }, parentToolCallId: null, at: 1 });
    session.consume({ kind: 'tool_call_completed', turnId: 't1', toolCallId: 'toolu_2', result: 'boom', isError: true, at: 1 });
    expect(frames[frames.length - 1].data).toEqual({ tool_use_id: 'toolu_2', result: 'boom', is_error: true });
  });

  it('keys subagent prose, calls and lifecycle by the spawning tool call', () => {
    const { session, frames, transcript } = harness();
    begin(session);
    session.consume({ kind: 'tool_call_started', turnId: 't1', toolCallId: 'task_1', tool: 'Task', input: { description: 'prove', subagent_type: 'prover' }, parentToolCallId: null, at: 1 });
    expect(session.liveChildAgents.get('task_1')).toBe('prover');
    session.consume({ kind: 'agent_status', turnId: 't1', toolCallId: 'task_1', agent: 'prover', status: 'running', at: 1 });
    session.consume({ kind: 'subagent_text_delta', turnId: 't1', parentToolCallId: 'task_1', text: 'thinking', deltaKind: 'thinking', at: 1 });
    session.consume({ kind: 'subagent_text_delta', turnId: 't1', parentToolCallId: 'task_1', text: 'Work', deltaKind: 'text', at: 1 });
    session.consume({ kind: 'subagent_text_completed', turnId: 't1', parentToolCallId: 'task_1', text: ' Work ', messageId: 'msg_sub', at: 1 });
    session.consume({ kind: 'tool_call_started', turnId: 't1', toolCallId: 'sub_1', tool: 'Read', input: { file_path: 'A.lean' }, parentToolCallId: 'task_1', at: 1 });
    session.consume({ kind: 'tool_call_completed', turnId: 't1', toolCallId: 'sub_1', result: 'theorem', isError: false, at: 1 });
    session.consume({ kind: 'agent_status', turnId: 't1', toolCallId: 'task_1', agent: 'prover', status: 'completed', at: 1 });
    session.consume({ kind: 'tool_call_completed', turnId: 't1', toolCallId: 'task_1', result: 'PROVED', isError: false, at: 1 });

    const subagentFrames = frames.slice(2);
    expect(names(subagentFrames)).toEqual([
      'tool_call',
      'agent_status',
      'subagent_stream_delta',
      'subagent_stream_delta',
      'subagent_text',
      'tool_call',
      'tool_result',
      'agent_status',
      'tool_result',
    ]);
    expect(subagentFrames[1].data).toEqual({ agent: 'prover', status: 'running', tool_use_id: 'task_1' });
    expect(subagentFrames[2].data).toEqual({ parent_tool_use_id: 'task_1', text: 'thinking', delta_kind: 'thinking' });
    expect(subagentFrames[4].data).toMatchObject({ parent_tool_use_id: 'task_1', text: 'Work' });
    expect(typeof (subagentFrames[4].data as { message_id: string }).message_id).toBe('string');
    expect(subagentFrames[5].data).toMatchObject({ tool: 'Read', tool_use_id: 'sub_1', parent_tool_use_id: 'task_1' });
    expect(subagentFrames[6].data).toEqual({ tool_use_id: 'sub_1', result: null, is_error: false, parent_tool_use_id: 'task_1' });
    expect(subagentFrames[7].data).toEqual({ agent: 'prover', status: 'completed', tool_use_id: 'task_1' });
    expect(session.liveChildAgents.size).toBe(0);

    const kinds = transcript.rows.map((row) => row.event_kind);
    expect(kinds).toEqual(['tool_call', 'agent_status', 'subagent_text', 'tool_call', 'tool_result', 'agent_status', 'tool_result']);
    expect(transcript.rows[2]).toMatchObject({ parent_tool_use_id: 'task_1', is_subagent: false });
    expect(JSON.parse(transcript.rows[2].content)).toMatchObject({ kind: 'subagent_text', parent_tool_use_id: 'task_1', text: 'Work' });
    expect(transcript.rows[3]).toMatchObject({ is_subagent: true, parent_tool_use_id: 'task_1', tool_name: 'Read' });
    // The persisted-then-published subagent_text advanced the boundary to its own id.
    expect(transcript.lastPersistedEventId).toBe(frames[frames.length - 1].id);
  });

  it('keeps live child cards live at turn end (they stop only when the session ends) and keeps session_result before turn_status', () => {
    const { session, frames, turnEnds, transcript } = harness();
    begin(session);
    session.consume({ kind: 'tool_call_started', turnId: 't1', toolCallId: 'task_1', tool: 'Task', input: { description: 'prove' }, parentToolCallId: null, at: 1 });
    session.consume({ kind: 'usage', turnId: 't1', usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 100, cacheCreationInputTokens: 0, reasoningOutputTokens: 0, costUsd: 0.02, contextWindow: null }, at: 1 });
    session.consume({ kind: 'turn_completed', turnId: 't1', stopReason: 'end_turn', durationMs: 900, costUsd: 0.02, at: 1 });
    expect(names(frames).slice(2)).toEqual(['tool_call', 'token_usage', 'session_result', 'turn_status']);
    expect(frames[3].data).toEqual({ input_tokens: 110, output_tokens: 5 });
    expect(frames[4].data).toEqual({ total_cost_usd: 0.02, num_turns: 1, duration_ms: 900, stop_reason: 'end_turn' });
    expect(frames[5].data).toEqual({ turn_active: false });
    expect(session.turnActive).toBe(false);
    expect(session.currentTurn).toBeNull();
    expect(session.liveChildAgents.has('task_1')).toBe(true);
    expect(turnEnds).toHaveLength(1);
    expect(turnEnds[0].turn.kind).toBe('initial');
    // Session end closes what is still live, as the web's end_session does.
    session.flushLiveChildAgents();
    expect(frames[frames.length - 1]).toMatchObject({ event: 'agent_status', data: { agent: 'agent', status: 'stopped', tool_use_id: 'task_1' } });
    expect(JSON.parse(transcript.rows[transcript.rows.length - 1].content)).toMatchObject({ kind: 'agent_status', status: 'stopped', tool_use_id: 'task_1' });
    expect(session.liveChildAgents.size).toBe(0);

    // The cost counter is cumulative per process: a respawn restarts it.
    begin(session, 't2');
    session.consume({ kind: 'turn_completed', turnId: 't2', stopReason: 'end_turn', durationMs: 1, costUsd: 0.05, at: 1 });
    expect(session.totalCostUsd).toBeCloseTo(0.05);
    begin(session, 't3');
    session.consume({ kind: 'turn_completed', turnId: 't3', stopReason: 'end_turn', durationMs: 1, costUsd: 0.01, at: 1 });
    expect(session.totalCostUsd).toBeCloseTo(0.06);
    expect(session.numTurns).toBe(3);
  });

  it('settles a child card from the spawn result when no lifecycle notice named it', () => {
    const { session, frames, transcript } = harness();
    begin(session);
    session.consume({ kind: 'tool_call_started', turnId: 't1', toolCallId: 'task_1', tool: 'Task', input: { subagent_type: 'prover' }, parentToolCallId: null, at: 1 });
    session.consume({ kind: 'tool_call_started', turnId: 't1', toolCallId: 'task_2', tool: 'Agent', input: { subagent_type: 'explorer' }, parentToolCallId: null, at: 1 });
    session.consume({ kind: 'tool_call_completed', turnId: 't1', toolCallId: 'task_1', result: 'PROVED', isError: false, at: 1 });
    session.consume({ kind: 'tool_call_completed', turnId: 't1', toolCallId: 'task_2', result: 'boom', isError: true, at: 1 });
    expect(names(frames).slice(2)).toEqual(['tool_call', 'tool_call', 'tool_result', 'agent_status', 'tool_result', 'agent_status']);
    expect(frames[5].data).toEqual({ agent: 'prover', status: 'completed', tool_use_id: 'task_1' });
    expect(frames[7].data).toEqual({ agent: 'explorer', status: 'failed', tool_use_id: 'task_2' });
    expect(session.liveChildAgents.size).toBe(0);
    expect(transcript.rows.map((row) => row.event_kind)).toEqual(['tool_call', 'tool_call', 'tool_result', 'agent_status', 'tool_result', 'agent_status']);
    // A child already settled by its notice is not settled twice by the result.
    session.consume({ kind: 'tool_call_started', turnId: 't1', toolCallId: 'task_3', tool: 'Task', input: {}, parentToolCallId: null, at: 1 });
    session.consume({ kind: 'agent_status', turnId: 't1', toolCallId: 'task_3', agent: 'agent', status: 'completed', at: 1 });
    session.consume({ kind: 'tool_call_completed', turnId: 't1', toolCallId: 'task_3', result: 'ok', isError: false, at: 1 });
    expect(names(frames).slice(8)).toEqual(['tool_call', 'agent_status', 'tool_result']);
  });

  it('publishes error then turn_status on a failed turn and only turn_status on an interrupt', () => {
    const { session, frames, turnEnds } = harness();
    begin(session);
    session.consume({ kind: 'turn_failed', turnId: 't1', message: 'exited', at: 1 });
    expect(names(frames).slice(2)).toEqual(['error', 'turn_status']);
    expect(frames[2].data).toEqual({ message: 'exited' });
    expect(turnEnds[0].turn.hadError).toBe(true);
    begin(session, 't2');
    session.consume({ kind: 'turn_interrupted', turnId: 't2', at: 1 });
    expect(names(frames).slice(4)).toEqual(['turn_status', 'turn_status']);
  });

  it('maps a known Claude API error log to the stable error text', () => {
    const { session, frames } = harness();
    begin(session);
    session.consume({ kind: 'runtime_log', turnId: 't1', level: 'error', message: 'rate_limit', at: 1 });
    session.consume({ kind: 'runtime_log', turnId: 't1', level: 'info', message: 'noise', at: 1 });
    expect(names(frames).slice(2)).toEqual(['error']);
    expect(frames[2].data).toEqual({ message: 'Claude API rate limit exceeded. Please try again later.' });
    expect(session.currentTurn?.hadError).toBe(true);
  });

  it('forwards permission prompts with the current anchor and drops events after the end', () => {
    const { session, frames } = harness();
    begin(session);
    session.consume({
      kind: 'permission_request',
      turnId: 't1',
      requestId: 'req-1',
      toolCallId: 'toolu_9',
      tool: 'Bash',
      input: { command: 'rm -rf build' },
      description: 'rm -rf build',
      reason: null,
      suggestions: [{ label: 'Allow Bash(rm:*) for this session', payload: { type: 'addRules' } }],
      at: 1,
    });
    expect(session.pendingPermissionIds.has('req-1')).toBe(true);
    expect(frames[2].event).toBe('permission_request');
    expect(frames[2].data).toEqual({
      request_id: 'req-1',
      turn_id: 't1',
      tool_call_id: 'toolu_9',
      tool: 'Bash',
      input: { command: 'rm -rf build' },
      description: 'rm -rf build',
      reason: null,
      suggestions: [{ label: 'Allow Bash(rm:*) for this session', payload: { type: 'addRules' } }],
      tool_use_id: 'toolu_9',
      assistant_turn_id: 'turn-0:assistant-0',
    });
    session.consume({ kind: 'permission_resolved', turnId: 't1', requestId: 'req-1', behavior: 'allow', at: 1 });
    expect(frames[3]).toMatchObject({ event: 'permission_resolved', data: { request_id: 'req-1', behavior: 'allow' } });
    expect(session.pendingPermissionIds.size).toBe(0);
    // A large Write body is summarised like the tool_call frame, not shipped whole.
    session.consume({
      kind: 'permission_request',
      turnId: 't1',
      requestId: 'req-2',
      toolCallId: 'toolu_10',
      tool: 'Write',
      input: { file_path: 'A.lean', content: 'x'.repeat(6000) },
      description: null,
      reason: null,
      suggestions: [],
      at: 1,
    });
    expect((frames[4].data as { input: { content: string } }).input.content).toBe(`${'x'.repeat(5000)}...`);
    session.markEnded('cancelled');
    session.consume({ kind: 'assistant_text_completed', turnId: 't1', blockId: 'late', text: 'late', at: 1 });
    expect(frames).toHaveLength(5);
  });

  it('records the provider thread id from thread_started', () => {
    const onThreadStarted = vi.fn();
    const { session } = harness();
    (session as unknown as { hooks: SessionHooks }).hooks.onThreadStarted = onThreadStarted;
    session.consume({ kind: 'thread_started', providerThreadId: 'sess-42', model: 'claude-opus-5', at: 1 });
    expect(session.providerThreadId).toBe('sess-42');
    expect(onThreadStarted).toHaveBeenCalledWith(session, 'sess-42', 'claude-opus-5');
  });

  it('mirrors build_status frames into the room and the transcript', () => {
    const { session, frames, transcript } = harness();
    session.forwardBuildStatus('building', 'Building Lean project...');
    expect(frames[frames.length - 1]).toMatchObject({ event: 'build_status', data: { phase: 'building', message: 'Building Lean project...' } });
    expect(JSON.parse(transcript.rows[0].content)).toEqual({ kind: 'build_status', phase: 'building', message: 'Building Lean project...' });
  });
});

describe('delivery states', () => {
  const message = (id: string, content = `msg ${id}`) => ({ messageId: id, content, contextAttachments: [] });

  it('announces an accepted follow-up as queued and flips turn_active', () => {
    const { session, frames } = harness();
    session.enqueue(message('m1'));
    session.announceAccepted(message('m1'));
    expect(frames.slice(1)).toEqual([
      { event: 'chat', data: { role: 'user', content: 'msg m1', message_id: 'm1', delivery_state: 'queued' }, id: 2 },
      { event: 'turn_status', data: { turn_active: true }, id: 3 },
    ]);
    expect(session.turnActive).toBe(true);
    expect(session.acceptedStates.get('m1')).toBe('queued');
    expect(session.messages.some((entry) => entry.message_id === 'm1')).toBe(false);
  });

  it('marks queued messages delivered at the start of the turn that consumes them and moves them to the end', () => {
    const { session, frames, transcript } = harness({ initialMessages: [{ role: 'user', content: 'q' }, { role: 'agent', content: 'a' }] });
    session.enqueue(message('m1'));
    session.announceAccepted(message('m1'));
    const [queued] = session.drainQueue();
    session.recordDeliveryState(queued, 'delivered');
    expect(frames[frames.length - 1]).toMatchObject({ event: 'message_delivery', data: { message_id: 'm1', state: 'delivered' } });
    expect(session.messages.map((entry) => entry.role)).toEqual(['user', 'agent', 'user']);
    expect(session.messages[2]).toMatchObject({ message_id: 'm1', delivery_state: 'delivered' });
    expect(transcript.deliveryUpdates).toEqual([{ messageId: 'm1', state: 'delivered', preserveDeliveredAt: false }]);
    // The next assistant row is anchored to the delivered turn.
    expect(session.currentAssistantTurnId()).toBe('turn-2:assistant-0');
  });

  it('steers a held message once a top-level tool call proves the turn live, then confirms it on the next model call', () => {
    const { session, frames, steers } = harness();
    begin(session);
    expect(session.acceptsSteering).toBe(true);
    session.pendingSteers.push(message('m1', 'also do X'));
    session.announceAccepted(message('m1', 'also do X'));
    // No tool call outstanding: nothing is written yet.
    expect(steers).toHaveLength(0);
    session.consume({ kind: 'tool_call_started', turnId: 't1', toolCallId: 'sub', tool: 'Read', input: {}, parentToolCallId: 'task_x', at: 1 });
    expect(steers).toHaveLength(0);
    session.consume({ kind: 'tool_call_started', turnId: 't1', toolCallId: 'top', tool: 'Read', input: {}, parentToolCallId: null, at: 1 });
    expect(steers).toHaveLength(1);
    expect(steers[0]).toContain('USER MESSAGE (arrived while you were working)');
    expect(steers[0]).toContain('User message: also do X');
    expect(session.unconfirmedSteers).toHaveLength(1);
    expect(session.acceptedStates.get('m1')).toBe('queued');
    session.consume({ kind: 'tool_call_completed', turnId: 't1', toolCallId: 'top', result: null, isError: false, at: 1 });
    session.consume({ kind: 'assistant_message_started', turnId: 't1', at: 1 });
    expect(session.acceptedStates.get('m1')).toBe('steered');
    expect(frames[frames.length - 1]).toMatchObject({ event: 'message_delivery', data: { message_id: 'm1', state: 'steered' } });
    expect(session.messages[session.messages.length - 1]).toMatchObject({ message_id: 'm1', delivery_state: 'steered' });
  });

  it('returns unconfirmed steers to the queue when the turn ends first', () => {
    const { session, frames, steers } = harness();
    begin(session);
    session.pendingSteers.push(message('m1'));
    session.announceAccepted(message('m1'));
    session.pendingSteers.push(message('m2'));
    session.announceAccepted(message('m2'));
    session.consume({ kind: 'tool_call_started', turnId: 't1', toolCallId: 'top', tool: 'Read', input: {}, parentToolCallId: null, at: 1 });
    expect(steers).toHaveLength(2);
    session.consume({ kind: 'turn_completed', turnId: 't1', stopReason: 'end_turn', durationMs: 1, costUsd: null, at: 1 });
    expect(session.queue.map((entry) => entry.messageId)).toEqual(['m1', 'm2']);
    expect(session.unconfirmedSteers).toHaveLength(0);
    const requeued = frames.filter((frame) => frame.event === 'message_delivery');
    expect(requeued.map((frame) => frame.data)).toEqual([
      { message_id: 'm1', state: 'queued' },
      { message_id: 'm2', state: 'queued' },
    ]);
  });

  it('queues instead of steering when the provider cannot take mid-turn input', () => {
    const { session } = harness({ steerable: false });
    begin(session);
    expect(session.acceptsSteering).toBe(false);
  });

  it('sends a failed steer back to the queue', async () => {
    const { session } = harness({ failSteer: true });
    begin(session);
    session.pendingSteers.push(message('m1'));
    session.announceAccepted(message('m1'));
    session.consume({ kind: 'tool_call_started', turnId: 't1', toolCallId: 'top', tool: 'Read', input: {}, parentToolCallId: null, at: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    expect(session.unconfirmedSteers).toHaveLength(0);
    expect(session.queue.map((entry) => entry.messageId)).toEqual(['m1']);
  });

  it('retains undelivered messages on a user stop and supersedes them otherwise', () => {
    const stopped = harness();
    stopped.session.enqueue(message('m1'));
    stopped.session.announceAccepted(message('m1'));
    stopped.session.userStopRequested = true;
    expect(stopped.session.stopDeliveryStates()).toEqual({ m1: 'retained' });
    stopped.session.finalizeUndeliveredMessages();
    expect(stopped.session.acceptedStates.get('m1')).toBe('retained');
    expect(stopped.frames[stopped.frames.length - 1]).toMatchObject({ event: 'message_delivery', data: { message_id: 'm1', state: 'retained' } });
    expect(stopped.transcript.deliveryUpdates).toEqual([{ messageId: 'm1', state: 'retained', preserveDeliveredAt: false }]);

    const failed = harness();
    failed.session.enqueue(message('m2'));
    failed.session.announceAccepted(message('m2'));
    failed.session.finalizeUndeliveredMessages();
    expect(failed.session.acceptedStates.get('m2')).toBe('superseded');
  });

  it('consumes retained resume rows once, keeping their transcript position', () => {
    const { session, frames, transcript } = harness({
      initialMessages: [{ role: 'user', content: 'q' }, { role: 'user', content: 'retained', message_id: 'r1', delivery_state: 'retained' }, { role: 'user', content: 'new' }],
    });
    session.retainedMessageIds.push('r1');
    begin(session);
    expect(frames.filter((frame) => frame.event === 'message_delivery').map((frame) => frame.data)).toEqual([{ message_id: 'r1', state: 'delivered' }]);
    expect(transcript.deliveryUpdates).toEqual([{ messageId: 'r1', state: 'delivered', preserveDeliveredAt: true }]);
    expect(session.messages[1]).toMatchObject({ message_id: 'r1', delivery_state: 'delivered' });
    session.consume({ kind: 'turn_started', turnId: 't1', at: 1 });
    expect(frames.filter((frame) => frame.event === 'message_delivery')).toHaveLength(1);
  });

  it('caps the pending queue at eight', () => {
    const { session } = harness();
    for (let index = 0; index < 8; index += 1) session.enqueue(message(`m${index}`));
    expect(session.hasUserMessageCapacity).toBe(false);
    expect(session.liveState().can_send).toBe(false);
  });
});
