import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@shared/agent-events';
import { CodexEventTranslator } from '@main/agents/codex/events';

function setup() {
  const events: AgentEvent[] = [];
  let local = 'local-1';
  const hooks = { currentTurnId: () => local, rootThreadId: () => 'root', subscribeChild: vi.fn(), onTurnStarted: vi.fn(), onTurnCompleted: vi.fn() };
  const translator = new CodexEventTranslator(e => events.push(e), hooks);
  const item = (item: Record<string, unknown>, threadId = 'root', turnId = 'native', phase = 'completed') => translator.handle(`item/${phase}`, { threadId, turnId, item });
  const spawn = (id = 'spawn', children = ['child'], status = 'completed') => item({ id, type: 'collabAgentToolCall', tool: 'spawnAgent', status, receiverThreadIds: children, agentsStates: {}, prompt: 'Research this' });
  const end = (threadId = 'child', status = 'completed', turnId = 'child-turn') => translator.handle('turn/completed', { threadId, turn: { id: turnId, status, error: status === 'failed' ? { message: 'boom' } : null } });
  return { translator, events, hooks, item, spawn, end, next: () => { translator.resetTurn(); local = 'local-2'; } };
}

describe('CodexEventTranslator', () => {
  it('commits completed text once, scopes native ids, and confirms assistant messages', () => {
    const s = setup();
    s.translator.handle('item/agentMessage/delta', { threadId: 'root', turnId: 'native', itemId: 'm', delta: 'Hello' });
    s.item({ id: 'm', type: 'agentMessage', text: 'Hello' }, 'root', 'native', 'started');
    s.item({ id: 'm', type: 'agentMessage', text: 'Hello' });
    s.item({ id: 'm', type: 'agentMessage', text: 'Hello' });
    expect(s.events.map(e => e.kind)).toEqual(['assistant_text_delta', 'assistant_message_started', 'assistant_text_completed']);
    expect(s.events[2]).toMatchObject({ turnId: 'local-1', blockId: 'root:native:m' });
    s.next();
    s.item({ id: 'm', type: 'agentMessage', text: 'stale' });
    s.item({ id: 'm', type: 'agentMessage', text: 'Next' }, 'root', 'native-2');
    expect(s.events.filter(e => e.kind === 'assistant_text_completed')).toHaveLength(2);
    expect(s.events.at(-1)).toMatchObject({ turnId: 'local-2', text: 'Next', blockId: 'root:native-2:m' });
  });

  it('buffers child events before association and never completes an Agent on spawn success', () => {
    const s = setup();
    s.translator.handle('thread/started', { thread: { id: 'child', source: { subAgent: { spawn: { parent_thread_id: 'root', agent_role: 'researcher' } } } } });
    s.item({ id: 'm', type: 'agentMessage', text: 'Child answer' }, 'child', 'child-turn');
    s.item({ id: 'cmd', type: 'commandExecution', command: 'pwd', exitCode: 0, aggregatedOutput: '/repo' }, 'child', 'child-turn');
    expect(s.events).toEqual([]);
    s.spawn();
    expect(s.hooks.subscribeChild).toHaveBeenCalledTimes(1);
    expect(s.events.find(e => e.kind === 'tool_call_started')).toMatchObject({ tool: 'Agent', toolCallId: 'root:native:spawn', input: { subagent_type: 'fuse:researcher', prompt: 'Research this' } });
    expect(s.events.find(e => e.kind === 'subagent_text_completed')).toMatchObject({ parentToolCallId: 'root:native:spawn', messageId: 'child:child-turn:m', turnId: 'local-1' });
    expect(s.events.find(e => e.kind === 'tool_call_started' && e.tool === 'Bash')).toMatchObject({ parentToolCallId: 'root:native:spawn' });
    expect(s.events.filter(e => e.kind === 'tool_call_completed' && e.toolCallId === 'root:native:spawn')).toHaveLength(0);
    s.end(); s.end();
    expect(s.events.slice(-2)).toMatchObject([{ kind: 'agent_status', status: 'completed' }, { kind: 'tool_call_completed', toolCallId: 'root:native:spawn' }]);
  });

  it('isolates parallel children even when their item ids collide', () => {
    const s = setup(); s.spawn('a', ['a']); s.spawn('b', ['b']);
    s.item({ id: 'same', type: 'agentMessage', text: 'A' }, 'a', 'turn');
    s.item({ id: 'same', type: 'agentMessage', text: 'B' }, 'b', 'turn');
    expect(s.events.filter(e => e.kind === 'subagent_text_completed')).toMatchObject([
      { parentToolCallId: 'root:native:a', messageId: 'a:turn:same' },
      { parentToolCallId: 'root:native:b', messageId: 'b:turn:same' },
    ]);
    s.end('a', 'failed', 'turn'); s.end('b', 'interrupted', 'turn');
    expect(s.events.filter(e => e.kind === 'agent_status').map(e => e.status)).toEqual(['running', 'running', 'failed', 'stopped']);
  });

  it('fails failed spawn and ignores unknown items and deeper subagents', () => {
    const s = setup(); s.spawn('bad', [], 'failed');
    expect(s.events.slice(-2)).toMatchObject([{ kind: 'agent_status', status: 'failed' }, { kind: 'tool_call_completed', isError: true }]);
    const count = s.events.length;
    s.item({ id: 'x', type: 'futureUnknown' });
    s.translator.handle('item/future/delta', { threadId: 'root', turnId: 'native', delta: 'unknown' });
    s.translator.handle('thread/started', { thread: { id: 'grandchild', parentThreadId: 'child' } });
    expect(s.events).toHaveLength(count);
    expect(s.hooks.subscribeChild).not.toHaveBeenCalled();
  });

  it('stops unfinished children before root completion hook and rejects late notifications', () => {
    const s = setup(); s.spawn();
    s.hooks.onTurnCompleted.mockImplementation(() => expect(s.events.at(-2)).toMatchObject({ kind: 'agent_status', status: 'stopped' }));
    s.end('root', 'completed', 'native');
    expect(s.hooks.onTurnCompleted).toHaveBeenCalledWith('root', expect.objectContaining({ id: 'native', status: 'completed' }));
    const count = s.events.length; s.end();
    expect(s.events).toHaveLength(count);
  });

  it('rehydrates attached children and deduplicates snapshot/live completion', () => {
    const s = setup(); s.spawn();
    const message = { id: 'm', type: 'agentMessage', text: 'Recovered' };
    s.translator.hydrateChild('child', { parentThreadId: 'root', turns: [{ id: 'child-turn', status: 'inProgress', items: [message] }] });
    expect(s.hooks.onTurnStarted).toHaveBeenCalledWith('child', 'child-turn');
    s.item(message, 'child', 'child-turn');
    expect(s.events.filter(e => e.kind === 'subagent_text_completed')).toHaveLength(1);
    s.end();
  });

  it('translates native command, file, MCP, search, reasoning, plan and last-turn usage fields', () => {
    const s = setup();
    s.item({ id: 'cmd', type: 'commandExecution', command: 'false', exitCode: 1, aggregatedOutput: 'bad' });
    s.item({ id: 'files', type: 'fileChange', changes: [{ path: 'A.lean', kind: { type: 'add' }, diff: '+hi' }, { path: 'B.lean', kind: { type: 'update', move_path: null }, diff: '-old' }], status: 'completed' });
    s.item({ id: 'mcp', type: 'mcpToolCall', server: 'fuse', tool: 'read', arguments: {}, error: null, result: { content: [{ type: 'text', text: 'ok' }] } });
    s.item({ id: 'search', type: 'webSearch', query: 'test', action: { type: 'search', query: 'test' } });
    s.item({ id: 'reason', type: 'reasoning', summary: ['Reason'], content: [] });
    s.translator.handle('turn/plan/updated', { threadId: 'root', turnId: 'native', plan: [{ step: 'Do it', status: 'inProgress' }] });
    s.translator.handle('thread/tokenUsage/updated', { threadId: 'root', turnId: 'native', tokenUsage: { total: { inputTokens: 900 }, last: { inputTokens: 100, cachedInputTokens: 60, outputTokens: 10, reasoningOutputTokens: 4 }, modelContextWindow: 200000 } });
    expect(s.events.filter(e => e.kind === 'tool_call_started').map(e => e.tool)).toEqual(['Bash', 'Write', 'Edit', 'mcp__fuse__read', 'WebSearch', 'TodoWrite']);
    expect(s.events.find(e => e.kind === 'tool_call_completed')).toMatchObject({ isError: true, result: 'bad' });
    expect(s.events.find(e => e.kind === 'usage')).toMatchObject({ usage: { inputTokens: 40, cachedInputTokens: 60, outputTokens: 10, contextWindow: 200000 } });
  });

  it('settles via wait agentsStates and closeAgent without completing sendInput as an Agent', () => {
    const s = setup(); s.spawn('a', ['a']); s.spawn('b', ['b']);
    s.item({ id: 'send', type: 'collabAgentToolCall', tool: 'sendInput', status: 'completed', receiverThreadIds: ['a'], prompt: 'more', agentsStates: { a: { status: 'running' } } });
    s.item({ id: 'wait', type: 'collabAgentToolCall', tool: 'wait', status: 'completed', receiverThreadIds: ['a'], agentsStates: { a: { status: 'completed', message: 'done' } } });
    s.item({ id: 'close', type: 'collabAgentToolCall', tool: 'closeAgent', status: 'completed', receiverThreadIds: ['b'], agentsStates: {} });
    expect(s.events.filter(e => e.kind === 'agent_status').map(e => e.status)).toEqual(['running', 'running', 'completed', 'stopped']);
  });

  it('streams child text and starts another Agent run when sending to a completed child', () => {
    const s = setup(); s.spawn();
    s.translator.handle('item/agentMessage/delta', { threadId: 'child', turnId: 'child-turn', itemId: 'm', delta: 'Hello' });
    s.item({ id: 'm', type: 'agentMessage', text: 'Hello world' }, 'child', 'child-turn');
    s.end();
    expect(s.events.find(e => e.kind === 'subagent_text_delta')).toMatchObject({ text: 'Hello', deltaKind: 'text', parentToolCallId: 'root:native:spawn' });
    s.item({ id: 'send', type: 'collabAgentToolCall', tool: 'sendInput', status: 'completed', receiverThreadIds: ['child'], prompt: 'Review again', agentsStates: {} });
    s.item({ id: 'm', type: 'agentMessage', text: 'Reviewed' }, 'child', 'child-turn-2');
    s.end('child', 'completed', 'child-turn-2');
    expect(s.events.filter(e => e.kind === 'agent_status').map(e => e.status)).toEqual(['running', 'completed', 'running', 'completed']);
    expect(s.events.filter(e => e.kind === 'subagent_text_completed').at(-1)).toMatchObject({ parentToolCallId: 'root:native:send:agent:child', text: 'Reviewed' });
    expect(s.hooks.onTurnCompleted).toHaveBeenCalledWith('child', expect.objectContaining({ id: 'child-turn-2' }));
  });

  it.each(['started', 'completed'])('buffers a reused child turn arriving before sendInput %s', (phase) => {
    const s = setup(); s.spawn();
    s.end('child', 'completed', 'old');
    s.translator.handle('turn/started', { threadId: 'child', turn: { id: 'new' } });
    s.translator.handle('item/agentMessage/delta', { threadId: 'child', turnId: 'new', itemId: 'answer', delta: 'New' });
    s.item({ id: 'answer', type: 'agentMessage', text: 'New answer' }, 'child', 'new');
    s.end('child', 'completed', 'new');
    expect(s.events.filter(e => e.kind === 'subagent_text_completed')).toHaveLength(0);
    const send = { id: 'send', type: 'collabAgentToolCall', tool: 'sendInput', status: phase === 'started' ? 'inProgress' : 'completed', receiverThreadIds: ['child'], agentsStates: {}, prompt: 'Review again' };
    s.item(send, 'root', 'native', phase);
    s.item({ ...send, status: 'completed' });
    expect(s.events.filter(e => e.kind === 'agent_status').map(e => e.status)).toEqual(['running', 'completed', 'running', 'completed']);
    expect(s.events.filter(e => e.kind === 'subagent_text_delta')).toMatchObject([{ parentToolCallId: 'root:native:send:agent:child', text: 'New' }]);
    expect(s.events.filter(e => e.kind === 'subagent_text_completed')).toMatchObject([{ parentToolCallId: 'root:native:send:agent:child', text: 'New answer' }]);
    expect(s.hooks.onTurnCompleted).toHaveBeenCalledWith('child', expect.objectContaining({ id: 'new' }));
    s.item({ id: 'stale', type: 'agentMessage', text: 'Old answer' }, 'child', 'old');
    expect(s.events.filter(e => e.kind === 'subagent_text_completed')).toHaveLength(1);
  });

  it('retains child roles across root turns and excludes historical turns when reattaching', () => {
    const s = setup();
    s.translator.handle('thread/started', { thread: { id: 'child', parentThreadId: 'root', agentRole: 'fuse:reviewer', agentNickname: 'Reviewer' } });
    s.spawn();
    s.item({ id: 'm', type: 'agentMessage', text: 'Old' }, 'child', 'child-turn');
    s.end(); s.end('root', 'completed', 'native'); s.next();
    const send = { id: 'send', type: 'collabAgentToolCall', tool: 'sendInput', status: 'completed', receiverThreadIds: ['child'], agentsStates: {}, prompt: 'Again' };
    s.item(send, 'root', 'native-2'); s.item(send, 'root', 'native-2');
    const cards = s.events.filter(e => e.kind === 'tool_call_started' && e.tool === 'Agent');
    expect(cards).toHaveLength(2);
    expect(cards[1]).toMatchObject({ turnId: 'local-2', input: { subagent_type: 'fuse:reviewer', description: 'Reviewer' } });
    expect(s.hooks.subscribeChild).toHaveBeenCalledTimes(2);
    s.translator.hydrateChild('child', { parentThreadId: 'root', turns: [{ id: 'child-turn', status: 'completed', items: [{ id: 'm', type: 'agentMessage', text: 'Old' }] }] });
    expect(s.events.filter(e => e.kind === 'agent_status').at(-1)).toMatchObject({ status: 'running' });
    s.translator.hydrateChild('child', { parentThreadId: 'root', turns: [
      { id: 'unseen-history', status: 'completed', items: [] },
      { id: 'child-turn-2', status: 'completed', items: [{ id: 'm', type: 'agentMessage', text: 'New' }] },
    ] });
    expect(s.events.filter(e => e.kind === 'subagent_text_completed').map(e => e.text)).toEqual(['Old', 'New']);
    expect(s.events.filter(e => e.kind === 'agent_status').at(-1)).toMatchObject({ status: 'completed', turnId: 'local-2' });
  });

  it('waits for all receivers before settling a shared spawn', () => {
    const s = setup(); s.end('a'); s.spawn('pair', ['a', 'b']);
    expect(s.events.filter(e => e.kind === 'agent_status').map(e => e.status)).toEqual(['running']);
    s.end('b');
    expect(s.events.filter(e => e.kind === 'agent_status').map(e => e.status)).toEqual(['running', 'completed']);
  });
});
