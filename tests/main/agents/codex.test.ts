import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@shared/agent-events';
import { DEFAULT_AGENT_CONFIG as DEFAULT_THREAD_CONFIG } from '@main/store/rows';
import { FakeProcess, flush } from '@test/main/agents/fake-process';

const spawnMock = vi.fn();
vi.mock('@main/agents/spawn', () => ({
  spawnCli: (...args: unknown[]) => spawnMock(...args),
  killCli: (child: { kill(signal: string): void }, signal: string) => child.kill(signal),
}));

const { CodexThread, buildCodexArgs, CODEX_FEATURE_OVERRIDES, developerInstructionsChannel } = await import('@main/agents/codex');

const FEATURE_ARGS = CODEX_FEATURE_OVERRIDES.flatMap((override) => ['-c', override]);

function launch(overrides: Partial<Parameters<typeof buildCodexArgs>[0]> = {}) {
  return {
    threadId: 'thread-1',
    repoPath: '/repo',
    config: { ...DEFAULT_THREAD_CONFIG, provider: 'codex' as const, model: 'gpt-5.6-sol', effort: 'low' as const },
    providerThreadId: null,
    executable: '',
    ...overrides,
  };
}

describe('buildCodexArgs', () => {
  it('starts a new thread in the repository with the chosen sandbox and the web parity overrides', () => {
    expect(buildCodexArgs(launch(), null, 'linux')).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--color',
      'never',
      '-C',
      '/repo',
      '-s',
      'workspace-write',
      '-c',
      'sandbox_mode="workspace-write"',
      '-c',
      'approval_policy="never"',
      ...FEATURE_ARGS,
      '-m',
      'gpt-5.6-sol',
      '-c',
      'model_reasoning_effort="low"',
      '-',
    ]);
    expect(FEATURE_ARGS).toEqual(expect.arrayContaining(['features.multi_agent=false', 'features.multi_agent_v2=false', 'web_search="disabled"']));
  });

  it('resumes an existing thread re-applying the current sandbox through the config override', () => {
    const args = buildCodexArgs(launch({ config: { ...launch().config, codex_sandbox: 'read-only' } }), 'thread-abc', 'linux');
    expect(args.slice(0, 3)).toEqual(['exec', 'resume', 'thread-abc']);
    expect(args).not.toContain('-s');
    expect(args).not.toContain('-C');
    expect(args).not.toContain('--color');
    // `-s` is first-turn only; a narrowed Settings choice must still narrow this turn.
    expect(args).toContain('sandbox_mode="read-only"');
    expect(args).toContain('approval_policy="never"');
  });

  it('maps full access to the bypass flag', () => {
    const args = buildCodexArgs(launch({ config: { ...launch().config, codex_sandbox: 'danger-full-access' } }), null, 'linux');
    expect(args).toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(args).not.toContain('approval_policy="never"');
    expect(args.some((arg) => arg.startsWith('sandbox_mode='))).toBe(false);
  });

  it('serialises the MCP server config as TOML values', () => {
    const args = buildCodexArgs(
      launch({ codex: { mcpServers: { fuse: { command: 'C:\\Program Files\\Fuse\\Fuse.exe', args: ['C:\\Users\\Justin Asher\\mcp-bootstrap.cjs'], env: { ELECTRON_RUN_AS_NODE: '1' } } } } }),
      null,
      'linux',
    );
    expect(args).toContain('mcp_servers.fuse.command="C:\\\\Program Files\\\\Fuse\\\\Fuse.exe"');
    expect(args).toContain('mcp_servers.fuse.args=["C:\\\\Users\\\\Justin Asher\\\\mcp-bootstrap.cjs"]');
    expect(args).toContain('mcp_servers.fuse.env.ELECTRON_RUN_AS_NODE="1"');
  });

  it('delivers the developer instructions as a config override, or in the prompt when the command line is too long', () => {
    const short = launch({ codex: { developerInstructions: 'Reply "PINEAPPLE" first.\nAlways.' } });
    expect(developerInstructionsChannel(short, 'linux')).toBe('config');
    expect(developerInstructionsChannel(short, 'win32')).toBe('config');
    const args = buildCodexArgs(short, null, 'linux');
    expect(args).toContain('developer_instructions="Reply \\"PINEAPPLE\\" first.\\nAlways."');
    const long = launch({ codex: { developerInstructions: 'x'.repeat(33_000) } });
    expect(developerInstructionsChannel(long, 'linux')).toBe('config');
    expect(developerInstructionsChannel(long, 'win32')).toBe('prompt');
    expect(buildCodexArgs(long, null, 'win32').some((arg) => arg.startsWith('developer_instructions='))).toBe(false);
    expect(developerInstructionsChannel(launch(), 'linux')).toBeNull();
  });
});

describe('CodexThread', () => {
  let child: FakeProcess;
  let events: AgentEvent[];

  beforeEach(() => {
    child = new FakeProcess();
    events = [];
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => child);
  });

  it('translates exec JSONL items into normalized events', async () => {
    const thread = new CodexThread(launch(), (event) => events.push(event));
    await thread.send('turn-1', 'Read hello.py and fix it');
    await flush();
    expect(spawnMock.mock.calls[0][0]).toBe('codex');
    expect(spawnMock.mock.calls[0][2]).toMatchObject({ cwd: '/repo', stdio: ['pipe', 'pipe', 'pipe'] });
    expect(child.written.join('')).toBe('Read hello.py and fix it');

    child.emitLine({ type: 'thread.started', thread_id: '01a0-thread' });
    child.emitLine({ type: 'turn.started' });
    child.emitLine({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'I’ll read the file.' } });
    child.emitLine({ type: 'item.started', item: { id: 'item_1', type: 'command_execution', command: "/bin/bash -lc 'cat hello.py'", aggregated_output: '', exit_code: null, status: 'in_progress' } });
    child.emitLine({ type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: "/bin/bash -lc 'cat hello.py'", aggregated_output: "print('hi')\n", exit_code: 0, status: 'completed' } });
    child.emitLine({ type: 'item.started', item: { id: 'item_2', type: 'file_change', changes: [{ path: '/repo/hello.py', kind: 'update' }], status: 'in_progress' } });
    child.emitLine({ type: 'item.completed', item: { id: 'item_2', type: 'file_change', changes: [{ path: '/repo/hello.py', kind: 'update' }], status: 'completed' } });
    child.emitLine({ type: 'item.completed', item: { id: 'item_3', type: 'agent_message', text: 'done' } });
    child.emitLine({ type: 'turn.completed', usage: { input_tokens: 50248, cached_input_tokens: 45312, cache_write_input_tokens: 0, output_tokens: 97, reasoning_output_tokens: 0 } });
    child.exit(0);
    await flush();

    expect(events.map((event) => event.kind)).toEqual([
      'user_message',
      'turn_started',
      'thread_started',
      'assistant_text_completed',
      'tool_call_started',
      'tool_call_completed',
      'tool_call_started',
      'tool_call_completed',
      'assistant_text_completed',
      'usage',
      'turn_completed',
    ]);
    const command = events.find((event) => event.kind === 'tool_call_started');
    // Item ids restart per process, so they are namespaced by the turn.
    expect(command && command.kind === 'tool_call_started' && command).toMatchObject({
      toolCallId: 'turn-1:item_1',
      tool: 'Bash',
      input: { command: "/bin/bash -lc 'cat hello.py'" },
    });
    // A file change is reported in Claude's shape so the renderer's Lean reload and activity rows understand it.
    const change = events.filter((event) => event.kind === 'tool_call_started')[1];
    expect(change).toMatchObject({ toolCallId: 'turn-1:item_2', tool: 'Edit', input: { file_path: '/repo/hello.py' } });
    expect(events.filter((event) => event.kind === 'tool_call_completed')[1]).toMatchObject({ toolCallId: 'turn-1:item_2', isError: false });
    const usage = events.find((event) => event.kind === 'usage');
    // Codex counts cached reads inside input_tokens; the snapshot reports the uncached remainder.
    expect(usage && usage.kind === 'usage' && usage.usage).toMatchObject({ inputTokens: 50248 - 45312, cachedInputTokens: 45312, cacheCreationInputTokens: 0, outputTokens: 97 });
    expect(thread.providerThreadId).toBe('01a0-thread');
    expect(thread.busy).toBe(false);
  });

  it('fans a multi-file change out into one Write/Edit call per file', async () => {
    const thread = new CodexThread(launch(), (event) => events.push(event));
    await thread.send('turn-1', 'edit');
    await flush();
    const changes = [
      { path: '/repo/New.lean', kind: 'add' },
      { path: '/repo/Old.lean', kind: 'update' },
    ];
    child.emitLine({ type: 'item.started', item: { id: 'item_0', type: 'file_change', changes, status: 'in_progress' } });
    child.emitLine({ type: 'item.completed', item: { id: 'item_0', type: 'file_change', changes, status: 'completed' } });
    await flush();
    expect(events.filter((event) => event.kind === 'tool_call_started')).toEqual([
      expect.objectContaining({ toolCallId: 'turn-1:item_0:0', tool: 'Write', input: { file_path: '/repo/New.lean' } }),
      expect.objectContaining({ toolCallId: 'turn-1:item_0:1', tool: 'Edit', input: { file_path: '/repo/Old.lean' } }),
    ]);
    expect(events.filter((event) => event.kind === 'tool_call_completed').map((event) => event.kind === 'tool_call_completed' && event.toolCallId)).toEqual([
      'turn-1:item_0:0',
      'turn-1:item_0:1',
    ]);
  });

  it('reports a successful MCP call (error: null) as a success with its text, and a failed one with its message', async () => {
    const thread = new CodexThread(launch(), (event) => events.push(event));
    await thread.send('turn-1', 'list');
    await flush();
    child.emitLine({
      type: 'item.completed',
      item: {
        id: 'item_1',
        type: 'mcp_tool_call',
        server: 'fuse',
        tool: 'blueprint_list_declarations',
        arguments: {},
        result: { content: [{ type: 'text', text: '{"count": 6}' }], structured_content: null },
        error: null,
        status: 'completed',
      },
    });
    child.emitLine({
      type: 'item.completed',
      item: {
        id: 'item_2',
        type: 'mcp_tool_call',
        server: 'fuse',
        tool: 'lean_reload_file',
        arguments: { file_path: 'A.lean' },
        result: null,
        error: { message: 'MCP tool call requires approval, but approval policy is never' },
        status: 'failed',
      },
    });
    await flush();
    const results = events.filter((event) => event.kind === 'tool_call_completed');
    expect(results[0]).toMatchObject({ toolCallId: 'turn-1:item_1', isError: false, result: '{"count": 6}' });
    expect(results[1]).toMatchObject({ toolCallId: 'turn-1:item_2', isError: true, result: 'MCP tool call requires approval, but approval policy is never' });
    const started = events.filter((event) => event.kind === 'tool_call_started');
    expect(started[0]).toMatchObject({ tool: 'mcp__fuse__blueprint_list_declarations' });
  });

  it('resumes the provider thread for the next turn', async () => {
    const thread = new CodexThread(launch(), (event) => events.push(event));
    await thread.send('turn-1', 'first');
    await flush();
    child.emitLine({ type: 'thread.started', thread_id: 't-1' });
    child.emitLine({ type: 'turn.completed', usage: {} });
    child.exit(0);
    await flush();

    const second = new FakeProcess();
    spawnMock.mockImplementation(() => second);
    await thread.send('turn-2', 'second');
    await flush();
    const args = spawnMock.mock.calls[1][1] as string[];
    expect(args.slice(0, 3)).toEqual(['exec', 'resume', 't-1']);
  });

  it('marks a failed command and an aborted process', async () => {
    const thread = new CodexThread(launch(), (event) => events.push(event));
    await thread.send('turn-1', 'run');
    await flush();
    child.emitLine({ type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: 'false', aggregated_output: '', exit_code: 1, status: 'failed' } });
    child.stderr.write('boom\n');
    child.exit(2);
    await flush();
    const completed = events.find((event) => event.kind === 'tool_call_completed');
    expect(completed && completed.kind === 'tool_call_completed' && completed.isError).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ kind: 'turn_failed' });
    const failure = events[events.length - 1];
    expect(failure.kind === 'turn_failed' && failure.message).toContain('boom');
  });

  it('kills the process on interrupt and reports the turn as interrupted', async () => {
    const thread = new CodexThread(launch(), (event) => events.push(event));
    await thread.send('turn-1', 'run');
    await flush();
    await thread.interrupt();
    expect(child.killed).toBe('SIGINT');
    child.exit(null, 'SIGINT');
    await flush();
    expect(events[events.length - 1]).toMatchObject({ kind: 'turn_interrupted' });
  });

  it('keeps a completed turn completed when Stop lands while the process is still flushing', async () => {
    const thread = new CodexThread(launch(), (event) => events.push(event));
    await thread.send('turn-1', 'run');
    await flush();
    child.emitLine({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } });
    await flush();
    await thread.interrupt();
    // The model already finished: no signal, and the exit closes the turn as completed.
    expect(child.killed).toBeNull();
    child.exit(0);
    await flush();
    expect(events[events.length - 1]).toMatchObject({ kind: 'turn_completed', turnId: 'turn-1' });
    expect(events.some((event) => event.kind === 'turn_interrupted')).toBe(false);
  });

  it('survives a CLI that closes stdin before reading the prompt', async () => {
    const thread = new CodexThread(launch({ codex: { developerInstructions: 'x'.repeat(40_000) } }), (event) => events.push(event));
    await thread.send('turn-1', 'run');
    await flush();
    // The stream error a broken pipe raises must be handled, not thrown.
    expect(child.stdin.listenerCount('error')).toBeGreaterThan(0);
    child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    child.stderr.write('Error: thread/resume failed: no rollout found for thread id x\n');
    child.exit(1);
    await flush();
    expect(events[events.length - 1]).toMatchObject({ kind: 'turn_failed' });
    expect(thread.busy).toBe(false);
  });

  it('wraps the developer instructions in a delimited block when they cannot travel on the command line', async () => {
    const spawnedArgs: string[][] = [];
    spawnMock.mockImplementation((_file: string, args: string[]) => {
      spawnedArgs.push(args);
      return child;
    });
    const instructions = 'Be terse.\n'.repeat(4_000);
    const thread = new CodexThread(launch({ codex: { developerInstructions: instructions } }), (event) => events.push(event));
    await thread.send('turn-1', 'hello');
    await flush();
    const written = child.stdinText;
    if (process.platform === 'win32') {
      expect(written).toBe(`<system_instructions>\n${instructions.trim()}\n</system_instructions>\n\nhello`);
    } else {
      expect(written).toBe('hello');
      expect(spawnedArgs[0]).toContain(`developer_instructions=${JSON.stringify(instructions)}`);
    }
  });
});
