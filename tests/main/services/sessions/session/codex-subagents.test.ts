import { describe, expect, it } from 'vitest';
import { CodexEventTranslator } from '@main/agents/codex/events';
import { LocalSession } from '@main/services/sessions/session';
import { SseRoom, type SseFrame } from '@main/server/sse';
import { MemoryTranscript, fakeProject } from '@test/main/services/sessions/test-helpers';
import { DEFAULT_AGENT_CONFIG } from '@main/store/rows';

describe('Codex subagents through the session transcript', () => {
  it('publishes Codex compatibility errors to the conversation', () => {
    const frames: SseFrame[] = [], room = new SseRoom('session');
    room.subscribe(frame => { if (frame) frames.push(frame); });
    const session = new LocalSession({
      sessionId: 'session', conversationId: 'conversation', agentJobId: 'job',
      project: fakeProject('/repo', { agent: { ...DEFAULT_AGENT_CONFIG, provider: 'codex' } }),
      room, transcript: new MemoryTranscript(), hooks: { onTurnEnded: () => undefined }, attachmentContext: null,
      initialMessages: [], model: 'codex-model', providerThreadId: 'root',
    });
    session.consume({ kind: 'runtime_log', turnId: null, level: 'error', message: 'Incompatible protocol. Update Codex CLI and Fuse.', at: 1 });
    expect(frames).toContainEqual(expect.objectContaining({ event: 'error', data: { message: 'Incompatible protocol. Update Codex CLI and Fuse.' } }));
  });

  it('keeps spawn running until the child finishes and persists nested tools and text', () => {
    const frames: SseFrame[] = [], transcript = new MemoryTranscript(), room = new SseRoom('session');
    room.subscribe(frame => { if (frame) frames.push(frame); });
    const session = new LocalSession({
      sessionId: 'session', conversationId: 'conversation', agentJobId: 'job', project: fakeProject(),
      room, transcript, hooks: { onTurnEnded: () => undefined }, attachmentContext: null,
      initialMessages: [{ role: 'user', content: 'prove' }], model: 'codex-model', providerThreadId: 'root',
    });
    session.markRunning();
    session.beginTurn({ turnId: 'local', kind: 'initial', userMessage: 'prove', startedAt: 1, wroteLeanFiles: false, hadError: false, lastActivityAt: 1 });
    const translator = new CodexEventTranslator(event => session.consume(event), {
      currentTurnId: () => 'local', rootThreadId: () => 'root', subscribeChild: () => undefined,
      onTurnStarted: () => undefined, onTurnCompleted: () => undefined,
    });
    translator.handle('thread/started', { thread: { id: 'child', source: { subAgent: { thread_spawn: { parent_thread_id: 'root', agent_role: 'fuse:prover' } } } } });
    translator.handle('item/completed', { threadId: 'root', turnId: 'native', item: {
      id: 'spawn', type: 'collabAgentToolCall', tool: 'spawnAgent', status: 'completed', prompt: 'Prove one theorem', receiverThreadIds: ['child'], agentsStates: {},
    } });
    const agent = frames.find(frame => frame.event === 'tool_call' && (frame.data as Record<string, unknown>).tool === 'Agent')!;
    const spawnId = (agent.data as Record<string, unknown>).tool_use_id;
    expect(frames.filter(frame => frame.event === 'tool_result')).toHaveLength(0);
    translator.handle('turn/started', { threadId: 'child', turn: { id: 'child-turn' } });
    translator.handle('item/started', { threadId: 'child', turnId: 'child-turn', item: { type: 'commandExecution', id: 'check', command: 'lake build', status: 'inProgress' } });
    translator.handle('item/completed', { threadId: 'child', turnId: 'child-turn', item: { type: 'commandExecution', id: 'check', command: 'lake build', status: 'completed', exitCode: 0, aggregatedOutput: 'ok' } });
    translator.handle('item/agentMessage/delta', { threadId: 'child', turnId: 'child-turn', itemId: 'answer', delta: 'PROVED' });
    translator.handle('item/completed', { threadId: 'child', turnId: 'child-turn', item: { type: 'agentMessage', id: 'answer', text: 'PROVED: theorem' } });
    translator.handle('turn/completed', { threadId: 'child', turn: { id: 'child-turn', status: 'completed' } });
    expect(frames.some(frame => frame.event === 'subagent_text' && (frame.data as Record<string, unknown>).parent_tool_use_id === spawnId)).toBe(true);
    const rows = transcript.rows.filter(row => row.role === 'tool').map(row => JSON.parse(row.content));
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'tool_call', tool: 'Bash', parent_tool_use_id: spawnId, is_subagent: true }),
      expect.objectContaining({ kind: 'subagent_text', parent_tool_use_id: spawnId, text: 'PROVED: theorem' }),
      expect.objectContaining({ kind: 'agent_status', tool_use_id: spawnId, status: 'completed' }),
    ]));
  });
});
