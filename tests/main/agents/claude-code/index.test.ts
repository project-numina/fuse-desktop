import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@shared/agent-events';
import { DEFAULT_AGENT_CONFIG as DEFAULT_THREAD_CONFIG } from '@main/store/rows';
import { FakeProcess, flush } from '@test/main/agents/fake-process';

const spawnMock = vi.fn();
vi.mock('@main/agents/spawn', () => ({
  spawnCli: (...args: unknown[]) => spawnMock(...args),
  killCli: (child: { kill(signal: string): void }, signal: string) => child.kill(signal),
}));

const { ClaudeCodeThread, buildClaudeArgs } = await import('@main/agents/claude-code');

function launch(overrides: Partial<Parameters<typeof buildClaudeArgs>[0]> = {}) {
  return {
    threadId: 'thread-1',
    repoPath: '/repo',
    config: { ...DEFAULT_THREAD_CONFIG, provider: 'claude' as const },
    providerThreadId: null,
    executable: '',
    ...overrides,
  };
}

describe('buildClaudeArgs', () => {
  it('streams JSON both ways and routes permission prompts through stdio', () => {
    const args = buildClaudeArgs(launch({ config: { ...DEFAULT_THREAD_CONFIG, model: 'fable', effort: 'high' } }), null);
    expect(args).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--forward-subagent-text',
      '--permission-prompt-tool',
      'stdio',
      '--permission-mode',
      'acceptEdits',
      '--model',
      'fable',
      '--effort',
      'high',
    ]);
  });

  it('passes the MCP config as a file path, keeping the token off the command line', () => {
    const args = buildClaudeArgs(launch({ claude: { mcpConfigFile: '/data/prompts/c1/mcp.json', mcpConfigJson: '{"mcpServers":{}}' } }), null);
    expect(args.slice(args.indexOf('--mcp-config'), args.indexOf('--mcp-config') + 3)).toEqual(['--mcp-config', '/data/prompts/c1/mcp.json', '--strict-mcp-config']);
    expect(args).not.toContain('{"mcpServers":{}}');
  });

  it('resumes by session id and unlocks bypass mode explicitly', () => {
    const args = buildClaudeArgs(
      launch({ config: { ...DEFAULT_THREAD_CONFIG, claude_permission_mode: 'bypassPermissions' } }),
      'sess-9',
    );
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args.slice(-2)).toEqual(['--resume', 'sess-9']);
  });
});

describe('ClaudeCodeThread', () => {
  let child: FakeProcess;
  let events: AgentEvent[];

  beforeEach(() => {
    child = new FakeProcess();
    events = [];
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => child);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('translates a streamed turn with a tool call into normalized events', async () => {
    const thread = new ClaudeCodeThread(launch(), (event) => events.push(event));
    await thread.send('turn-1', 'Read hello.py');
    await flush();

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0][0]).toBe('claude');
    expect(spawnMock.mock.calls[0][2]).toMatchObject({ cwd: '/repo' });
    expect(child.writtenJson()[0]).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'Read hello.py' }] },
    });

    child.emitLine({ type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-haiku-4-5' });
    child.emitLine({ type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1' } }, parent_tool_use_id: null });
    child.emitLine({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, parent_tool_use_id: null });
    child.emitLine({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Look' } }, parent_tool_use_id: null });
    child.emitLine({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ing' } }, parent_tool_use_id: null });
    child.emitLine({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 }, parent_tool_use_id: null });
    child.emitLine({ type: 'assistant', message: { id: 'msg_1', content: [{ type: 'text', text: 'Looking' }] }, parent_tool_use_id: null });
    child.emitLine({ type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} } }, parent_tool_use_id: null });
    child.emitLine({ type: 'assistant', message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/repo/hello.py' } }] }, parent_tool_use_id: null });
    child.emitLine({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: "print('hi')", is_error: false }] } });
    child.emitLine({
      type: 'result',
      subtype: 'success',
      is_error: false,
      stop_reason: 'end_turn',
      duration_ms: 967,
      total_cost_usd: 0.014,
      usage: { input_tokens: 10, output_tokens: 36, cache_read_input_tokens: 17625, cache_creation_input_tokens: 5621, output_tokens_details: { thinking_tokens: 29 } },
      modelUsage: { 'claude-haiku-4-5': { contextWindow: 200000 } },
    });
    await flush();

    expect(events.map((event) => event.kind)).toEqual([
      'user_message',
      'turn_started',
      'thread_started',
      'assistant_message_started',
      'assistant_text_delta',
      'assistant_text_delta',
      'assistant_text_completed',
      'tool_call_started',
      'tool_call_completed',
      'usage',
      'turn_completed',
    ]);
    const completed = events.find((event) => event.kind === 'assistant_text_completed');
    expect(completed && completed.kind === 'assistant_text_completed' && completed.text).toBe('Looking');
    const tool = events.find((event) => event.kind === 'tool_call_started');
    expect(tool && tool.kind === 'tool_call_started' && tool.input).toEqual({ file_path: '/repo/hello.py' });
    const usage = events.find((event) => event.kind === 'usage');
    expect(usage && usage.kind === 'usage' && usage.usage).toMatchObject({
      cachedInputTokens: 17625,
      reasoningOutputTokens: 29,
      costUsd: 0.014,
      contextWindow: 200000,
    });
    expect(thread.providerThreadId).toBe('sess-1');
    expect(thread.busy).toBe(false);
  });

  it('announces a streamed text block once when the assistant line precedes its stop event', async () => {
    const thread = new ClaudeCodeThread(launch(), (event) => events.push(event));
    await thread.send('turn-1', 'hi');
    await flush();
    child.emitLine({ type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1' } }, parent_tool_use_id: null });
    child.emitLine({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, parent_tool_use_id: null });
    child.emitLine({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } }, parent_tool_use_id: null });
    // Claude Code writes the complete message before the block stops.
    child.emitLine({ type: 'assistant', message: { id: 'msg_1', content: [{ type: 'text', text: 'Hello' }] }, parent_tool_use_id: null });
    child.emitLine({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 }, parent_tool_use_id: null });
    child.emitLine({ type: 'stream_event', event: { type: 'message_stop' }, parent_tool_use_id: null });
    child.emitLine({ type: 'result', subtype: 'success', is_error: false, usage: {} });
    await flush();
    const completed = events.filter((event) => event.kind === 'assistant_text_completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ blockId: 'msg_1:0', text: 'Hello' });
    const delta = events.find((event) => event.kind === 'assistant_text_delta');
    expect(delta && delta.kind === 'assistant_text_delta' && delta.blockId).toBe('msg_1:0');
  });

  it('surfaces permission prompts and answers them on stdin', async () => {
    const thread = new ClaudeCodeThread(launch(), (event) => events.push(event));
    await thread.send('turn-1', 'Read /etc/hostname');
    await flush();
    child.emitLine({
      type: 'control_request',
      request_id: 'req-1',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Read',
        input: { file_path: '/etc/hostname' },
        description: '/etc/hostname',
        decision_reason: 'Path is outside allowed working directories',
        tool_use_id: 'toolu_2',
        permission_suggestions: [
          { type: 'addRules', rules: [{ toolName: 'Read', ruleContent: '//etc/**' }], behavior: 'allow', destination: 'session' },
        ],
      },
    });
    await flush();

    const request = events.find((event) => event.kind === 'permission_request');
    expect(request && request.kind === 'permission_request' && request.suggestions[0].label).toBe(
      'Allow Read(//etc/**) for this session',
    );

    await expect(thread.respondPermission('req-1', { behavior: 'allow' })).resolves.toBe(true);
    const written = child.writtenJson();
    expect(written[written.length - 1]).toEqual({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'req-1',
        response: { behavior: 'allow', updatedInput: { file_path: '/etc/hostname' } },
      },
    });
    expect(events[events.length - 1]).toMatchObject({ kind: 'permission_resolved', requestId: 'req-1', behavior: 'allow' });
    // A duplicate or unknown answer is reported, not swallowed.
    await expect(thread.respondPermission('req-1', { behavior: 'deny' })).resolves.toBe(false);
    await expect(thread.respondPermission('nope', { behavior: 'deny' })).resolves.toBe(false);
    expect(child.writtenJson()).toHaveLength(written.length);
  });

  it('queues a follow-up until the current turn ends and reuses the process', async () => {
    const thread = new ClaudeCodeThread(launch(), (event) => events.push(event));
    await thread.send('turn-1', 'first');
    await thread.send('turn-2', 'second');
    await flush();
    expect(child.writtenJson()).toHaveLength(1);
    expect(thread.busy).toBe(true);

    child.emitLine({ type: 'result', subtype: 'success', is_error: false, usage: {} });
    await flush();
    expect(child.writtenJson()).toHaveLength(2);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.kind === 'turn_started')).toHaveLength(2);
  });

  it('surfaces subagent prose, tool calls and lifecycle keyed by the spawning tool call', async () => {
    const thread = new ClaudeCodeThread(launch(), (event) => events.push(event));
    await thread.send('turn-1', 'Prove it');
    await flush();
    child.emitLine({ type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-opus-5' });
    child.emitLine({ type: 'assistant', message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_task', name: 'Task', input: { description: 'prove lemma', subagent_type: 'prover' } }] }, parent_tool_use_id: null });
    child.emitLine({ type: 'system', subtype: 'task_started', task_id: 'w1', tool_use_id: 'toolu_task', description: 'prove lemma', subagent_type: 'prover' });
    child.emitLine({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } }, parent_tool_use_id: 'toolu_task' });
    child.emitLine({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Working' } }, parent_tool_use_id: 'toolu_task' });
    child.emitLine({ type: 'assistant', message: { id: 'msg_sub', content: [{ type: 'text', text: 'Working' }, { type: 'tool_use', id: 'toolu_sub', name: 'Read', input: { file_path: '/repo/a.lean' } }] }, parent_tool_use_id: 'toolu_task' });
    child.emitLine({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_sub', content: 'theorem', is_error: false }] }, parent_tool_use_id: 'toolu_task' });
    child.emitLine({ type: 'system', subtype: 'task_notification', task_id: 'w1', tool_use_id: 'toolu_task', status: 'completed', summary: 'done' });
    child.emitLine({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_task', content: 'PROVED', is_error: false }] } });
    child.emitLine({ type: 'result', subtype: 'success', is_error: false, usage: {} });
    await flush();

    expect(events.map((event) => event.kind)).toEqual([
      'user_message',
      'turn_started',
      'thread_started',
      'tool_call_started',
      'agent_status',
      'subagent_text_delta',
      'subagent_text_delta',
      'subagent_text_completed',
      'tool_call_started',
      'tool_call_completed',
      'agent_status',
      'tool_call_completed',
      'turn_completed',
    ]);
    const statuses = events.filter((event) => event.kind === 'agent_status');
    expect(statuses[0]).toMatchObject({ toolCallId: 'toolu_task', agent: 'prover', status: 'running' });
    expect(statuses[1]).toMatchObject({ toolCallId: 'toolu_task', agent: 'prover', status: 'completed' });
    const deltas = events.filter((event) => event.kind === 'subagent_text_delta');
    expect(deltas[0]).toMatchObject({ parentToolCallId: 'toolu_task', deltaKind: 'thinking', text: 'hmm' });
    expect(deltas[1]).toMatchObject({ parentToolCallId: 'toolu_task', deltaKind: 'text', text: 'Working' });
    expect(events.find((event) => event.kind === 'subagent_text_completed')).toMatchObject({
      parentToolCallId: 'toolu_task',
      text: 'Working',
      messageId: 'msg_sub',
    });
    const childCall = events.filter((event) => event.kind === 'tool_call_started')[1];
    expect(childCall).toMatchObject({ toolCallId: 'toolu_sub', parentToolCallId: 'toolu_task', tool: 'Read' });
  });

  it('writes a steer into the running turn as another user message', async () => {
    const thread = new ClaudeCodeThread(launch(), (event) => events.push(event));
    await thread.send('turn-1', 'first');
    await flush();
    await thread.steer('USER MESSAGE (arrived while you were working)');
    expect(child.writtenJson()).toHaveLength(2);
    expect(child.writtenJson()[1]).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'USER MESSAGE (arrived while you were working)' }] },
    });
    child.emitLine({ type: 'result', subtype: 'success', is_error: false, usage: {} });
    await flush();
    await expect(thread.steer('late')).rejects.toThrow('No turn is running.');
  });

  it('passes the system prompt through a file and keeps the launch env authoritative', async () => {
    const args = buildClaudeArgs(
      launch({ claude: { systemPromptFile: '/tmp/system.md', pluginDir: '/res/blueprint', allowedTools: ['mcp__fuse', 'Task'], maxTurns: 200 } }),
      null,
    );
    expect(args).toContain('--system-prompt-file');
    expect(args[args.indexOf('--system-prompt-file') + 1]).toBe('/tmp/system.md');
    expect(args.slice(args.indexOf('--allowedTools'), args.indexOf('--allowedTools') + 3)).toEqual(['--allowedTools', 'mcp__fuse', 'Task']);
    expect(args.slice(-2)).toEqual(['--max-turns', '200']);

    const thread = new ClaudeCodeThread(launch({ env: { MCP_TOOL_TIMEOUT: '600000', FUSE_API_URL: 'http://127.0.0.1:1' } }), (event) => events.push(event));
    await thread.send('turn-1', 'hello');
    await flush();
    expect(spawnMock.mock.calls[0][2].env).toMatchObject({
      MCP_TOOL_TIMEOUT: '600000',
      FUSE_API_URL: 'http://127.0.0.1:1',
      CLAUDE_CODE_DISABLE_CRON: '1',
      // Task calls must block on their child: a backgrounded subagent's
      // result arrives in a CLI-initiated turn this adapter never sees.
      CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1',
    });
  });

  it('ignores task lines for background Bash commands and only tracks local agents', async () => {
    const thread = new ClaudeCodeThread(launch(), (event) => events.push(event));
    await thread.send('turn-1', 'build');
    await flush();
    child.emitLine({ type: 'system', subtype: 'task_started', task_id: 'b1', tool_use_id: 'toolu_bash', description: 'lake build', task_type: 'local_bash', is_backgrounded: false });
    child.emitLine({ type: 'system', subtype: 'task_notification', task_id: 'b1', tool_use_id: 'toolu_bash', status: 'completed', summary: 'done' });
    child.emitLine({ type: 'system', subtype: 'task_started', task_id: 'a1', tool_use_id: 'toolu_task', description: 'prove', task_type: 'local_agent', subagent_type: 'fuse:prover' });
    child.emitLine({ type: 'system', subtype: 'task_notification', task_id: 'a1', tool_use_id: 'toolu_task', status: 'completed', summary: 'done' });
    // A notification for a task never started as an agent is not a child either.
    child.emitLine({ type: 'system', subtype: 'task_notification', task_id: 'x', tool_use_id: 'toolu_unknown', status: 'failed' });
    await flush();
    const statuses = events.filter((event) => event.kind === 'agent_status');
    expect(statuses).toEqual([
      expect.objectContaining({ toolCallId: 'toolu_task', agent: 'fuse:prover', status: 'running' }),
      expect.objectContaining({ toolCallId: 'toolu_task', agent: 'fuse:prover', status: 'completed' }),
    ]);
  });

  it('surfaces the errors of an error_during_execution result', async () => {
    const thread = new ClaudeCodeThread(launch({ providerThreadId: '00000000-0000-4000-8000-000000000000' }), (event) => events.push(event));
    await thread.send('turn-1', 'hello');
    await flush();
    expect(spawnMock.mock.calls[0][1].slice(-2)).toEqual(['--resume', '00000000-0000-4000-8000-000000000000']);
    child.emitLine({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['No conversation found with session ID: 00000000-0000-4000-8000-000000000000'], usage: {} });
    await flush();
    expect(events[events.length - 1]).toMatchObject({ kind: 'turn_failed', message: 'No conversation found with session ID: 00000000-0000-4000-8000-000000000000' });
  });

  it('fails the turn when the process exits early', async () => {
    const thread = new ClaudeCodeThread(launch(), (event) => events.push(event));
    await thread.send('turn-1', 'hello');
    await flush();
    child.exit(1);
    await flush();
    expect(events[events.length - 1]).toMatchObject({ kind: 'turn_failed', turnId: 'turn-1', message: 'Claude Code exited unexpectedly (exit code 1).' });
    expect(thread.busy).toBe(false);
  });

  it('reports an interrupted turn, not a failure, when the exit follows close()', async () => {
    const thread = new ClaudeCodeThread(launch(), (event) => events.push(event));
    await thread.send('turn-1', 'hello');
    await flush();
    await thread.close();
    expect(child.killed).toBe('SIGTERM');
    child.exit(null, 'SIGTERM');
    await flush();
    expect(events[events.length - 1]).toMatchObject({ kind: 'turn_interrupted', turnId: 'turn-1' });
    expect(events.some((event) => event.kind === 'turn_failed')).toBe(false);
  });

  it('ignores the exit of an idle-stopped process after a fresh one took over the thread', async () => {
    vi.useFakeTimers();
    const thread = new ClaudeCodeThread(launch(), (event) => events.push(event));
    await thread.send('turn-1', 'first');
    child.emitLine({ type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-opus-5' });
    child.emitLine({ type: 'result', subtype: 'success', is_error: false, usage: {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(thread.busy).toBe(false);
    // The idle timer stops the process; it exits asynchronously.
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000 + 1);
    expect(child.killed).toBe('SIGTERM');
    const replacement = new FakeProcess();
    spawnMock.mockImplementation(() => replacement);
    await thread.send('turn-2', 'second');
    await vi.advanceTimersByTimeAsync(0);
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock.mock.calls[1][1]).toContain('--resume');
    // Now the old process finally goes away.
    child.exit(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(events.some((event) => event.kind === 'turn_failed')).toBe(false);
    expect(thread.busy).toBe(true);
    // The replacement still drives the turn to completion.
    replacement.emitLine({ type: 'result', subtype: 'success', is_error: false, usage: {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(events[events.length - 1]).toMatchObject({ kind: 'turn_completed', turnId: 'turn-2' });
  });

  it('reports an interrupted turn when a result follows an interrupt', async () => {
    const thread = new ClaudeCodeThread(launch(), (event) => events.push(event));
    await thread.send('turn-1', 'hello');
    await flush();
    await thread.interrupt();
    const control = child.writtenJson().find((line) => line.type === 'control_request');
    expect(control).toMatchObject({ request: { subtype: 'interrupt' } });
    child.emitLine({ type: 'result', subtype: 'success', is_error: false, usage: {} });
    await flush();
    expect(events[events.length - 1]).toMatchObject({ kind: 'turn_interrupted', turnId: 'turn-1' });
  });
});
