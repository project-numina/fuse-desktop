import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThreadLaunch } from '@main/agents/types';
import type { AgentEvent } from '@shared/agent-events';
import { DEFAULT_AGENT_CONFIG } from '@main/store/rows';
import { FakeProcess, flush } from '@test/main/agents/fake-process';

const spawnMock = vi.fn();
vi.mock('@main/agents/spawn', () => ({
  spawnCli: (...args: unknown[]) => spawnMock(...args),
  killCli: (child: { kill(signal: string): void }, signal: string) => child.kill(signal),
}));

const { CodexThread, buildCodexArgs } = await import('@main/agents/codex');
const { threadOptions } = await import('@main/agents/codex/options');

function launch(overrides: Partial<ThreadLaunch> = {}): ThreadLaunch {
  return {
    threadId: 'thread-1', repoPath: '/repo', providerThreadId: null, executable: '',
    config: { ...DEFAULT_AGENT_CONFIG, provider: 'codex' as const, model: 'gpt-5.6-sol', effort: 'low' as const },
    ...overrides,
  };
}

async function start(child: FakeProcess, threadId = 'native-thread') {
  for (let pass = 0; pass < 4; pass++) {
    await flush();
    const messages = child.writtenJson();
    for (const message of messages) {
      if (message.id && (message.method === 'initialize' || message.method === 'thread/start' || message.method === 'thread/resume' || message.method === 'turn/start')) {
        const result = message.method === 'initialize' ? {} : message.method === 'turn/start' ? { turn: { id: 'native-turn' } } : { thread: { id: threadId }, model: 'gpt' };
        child.emitLine({ id: message.id, result });
      }
    }
  }
  await flush();
}
function requests(child: FakeProcess) { return child.writtenJson().filter((m) => m.method); }

describe('Codex app-server options', () => {
  it('uses app-server and feature overrides', () => expect(buildCodexArgs()).toEqual(expect.arrayContaining(['app-server', '-c', 'features.multi_agent=true'])));
  it('sends sandbox, MCP, instructions, model and eight-agent config in private thread options', () => {
    const options = threadOptions(launch({ codex: { developerInstructions: 'x'.repeat(40_000), mcpServers: { fuse: { command: 'node', args: [] } }, roles: { 'fuse:prover': { description: 'Prove', config_file: '/private/prover.toml' } } } }));
    expect(options).toMatchObject({ cwd: '/repo', model: 'gpt-5.6-sol', approvalPolicy: 'never', sandbox: 'workspace-write', developerInstructions: expect.any(String), config: expect.objectContaining({ model_reasoning_effort: 'low', agents: expect.objectContaining({ max_threads: 8, 'fuse:prover': { description: 'Prove', config_file: '/private/prover.toml' } }) }) });
  });
});

describe('CodexThread app-server runtime', () => {
  let child: FakeProcess; let events: AgentEvent[];
  beforeEach(() => { child = new FakeProcess(); events = []; spawnMock.mockReset(); spawnMock.mockReturnValue(child); });
  afterEach(async () => { child.exit(0); await flush(); });

  it.each(['read-only', 'workspace-write', 'danger-full-access'] as const)('applies %s to resumed threads', async (sandbox) => {
    const thread = new CodexThread(launch({ providerThreadId: 'saved', config: { ...launch().config, codex_sandbox: sandbox } }), (e) => events.push(e));
    await thread.send('a', 'continue'); await start(child, 'saved');
    expect(requests(child).find((m) => m.method === 'thread/resume')).toMatchObject({ params: { threadId: 'saved', sandbox, approvalPolicy: 'never' } });
    expect(requests(child).some((m) => m.method === 'thread/start')).toBe(false);
    await thread.close();
  });

  it('closes active work, discards queued work and rejects further sends', async () => {
    const thread = new CodexThread(launch(), (e) => events.push(e));
    await thread.send('a', 'first'); await start(child); await thread.send('b', 'queued');
    await thread.close();
    expect(child.killed).toBe('SIGTERM');
    expect(events.filter((e) => e.kind === 'turn_interrupted')).toHaveLength(1);
    expect(events.filter((e) => e.kind === 'user_message')).toHaveLength(1);
    expect(thread.busy).toBe(false);
    await expect(thread.send('c', 'closed')).rejects.toThrow('closed');
  });

  it.each(['stdin', 'exit', 'spawn'])('reports %s failures once', async (failure) => {
    const thread = new CodexThread(launch(), (e) => events.push(e));
    await thread.send('a', 'first'); await start(child);
    if (failure === 'stdin') child.stdin.emit('error', new Error('EPIPE'));
    else if (failure === 'spawn') child.emit('error', new Error('ENOENT'));
    else child.exit(2);
    await flush(); child.exit(2); await flush();
    expect(events.filter((e) => e.kind === 'turn_failed')).toHaveLength(1);
    expect(thread.busy).toBe(false);
  });

  it('initializes, starts a turn, translates notifications, and resumes later turns', async () => {
    const thread = new CodexThread(launch(), (e) => events.push(e));
    await thread.send('turn-1', 'hello'); await start(child);
    child.emitLine({ method: 'turn/started', params: { threadId: 'native-thread', turn: { id: 'native-turn' } } });
    child.emitLine({ method: 'item/agentMessage/delta', params: { threadId: 'native-thread', turnId: 'native-turn', itemId: 'message-1', delta: 'hi' } });
    child.emitLine({ method: 'turn/completed', params: { threadId: 'native-thread', turn: { id: 'native-turn', status: 'completed' } } }); await flush();
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(['user_message', 'turn_started', 'thread_started', 'assistant_text_delta', 'turn_completed']));
    expect(thread.providerThreadId).toBe('native-thread');
    await thread.send('turn-2', 'again'); await flush();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(requests(child).filter((m) => m.method === 'turn/start')).toHaveLength(2);
  });

  it('queues turns and starts the next only after completion', async () => {
    const thread = new CodexThread(launch(), (e) => events.push(e)); await thread.send('a', 'one'); await thread.send('b', 'two'); await start(child);
    expect(requests(child).filter((m) => m.method === 'turn/start')).toHaveLength(1);
    child.emitLine({ method: 'turn/completed', params: { threadId: 'native-thread', turn: { id: 'native-turn', status: 'completed' } } }); await flush();
    expect(requests(child).filter((m) => m.method === 'turn/start')).toHaveLength(2);
  });

  it('interrupts a turn whose start response arrives after Stop', async () => {
    const thread = new CodexThread(launch(), event => events.push(event));
    await thread.send('a', 'one');
    await flush();
    const init = requests(child).find(message => message.method === 'initialize')!;
    child.emitLine({ id: init.id, result: {} }); await flush();
    const create = requests(child).find(message => message.method === 'thread/start')!;
    child.emitLine({ id: create.id, result: { thread: { id: 'root' } } }); await flush();
    const startRequest = requests(child).find(message => message.method === 'turn/start')!;
    await thread.interrupt();
    child.emitLine({ id: startRequest.id, result: { turn: { id: 'late-turn' } } }); await flush();
    const interrupt = requests(child).find(message => message.method === 'turn/interrupt')!;
    expect(interrupt).toMatchObject({ params: { threadId: 'root', turnId: 'late-turn' } });
    child.emitLine({ id: interrupt.id, result: {} });
    child.emitLine({ method: 'turn/completed', params: { threadId: 'root', turn: { id: 'late-turn', status: 'interrupted' } } });
    await flush();
    expect(events.filter(event => event.kind === 'turn_interrupted')).toHaveLength(1);
  });

  it('waits for child attachment before finishing and interrupts its active snapshot turn', async () => {
    const thread = new CodexThread(launch(), event => events.push(event));
    await thread.send('a', 'one'); await start(child);
    child.emitLine({ method: 'item/completed', params: { threadId: 'native-thread', turnId: 'native-turn', item: {
      id: 'spawn', type: 'collabAgentToolCall', tool: 'spawnAgent', status: 'completed', receiverThreadIds: ['worker'],
    } } });
    await flush();
    const attach = requests(child).find(message => message.method === 'thread/resume' && (message.params as Record<string, unknown>).threadId === 'worker')!;
    child.emitLine({ method: 'turn/completed', params: { threadId: 'native-thread', turn: { id: 'native-turn', status: 'completed' } } });
    await flush();
    expect(events.some(event => event.kind === 'turn_completed')).toBe(false);
    child.emitLine({ id: attach.id, result: { thread: { id: 'worker', turns: [{ id: 'worker-turn', status: 'inProgress', items: [] }] } } });
    await flush();
    const interrupt = requests(child).find(message => message.method === 'turn/interrupt')!;
    expect(interrupt).toMatchObject({ params: { threadId: 'worker', turnId: 'worker-turn' } });
    child.emitLine({ id: interrupt.id, result: {} }); await flush();
    expect(events.filter(event => event.kind === 'turn_completed')).toHaveLength(1);
    await thread.close();
  });

  it('steers and interrupts the active turn', async () => {
    const thread = new CodexThread(launch(), (e) => events.push(e)); await thread.send('a', 'one'); await start(child);
    const steering = thread.steer('focus'); await flush();
    const steer = requests(child).at(-1)!;
    expect(steer).toMatchObject({ method: 'turn/steer', params: { expectedTurnId: 'native-turn' } });
    child.emitLine({ id: steer.id, result: {} }); await steering;
    const interrupting = thread.interrupt(); await flush();
    const interrupt = requests(child).at(-1)!;
    expect(interrupt).toMatchObject({ method: 'turn/interrupt' });
    child.emitLine({ id: interrupt.id, result: {} }); await interrupting;
    child.emitLine({ method: 'turn/completed', params: { threadId: 'native-thread', turn: { id: 'native-turn', status: 'interrupted' } } }); await flush();
    expect(events.at(-1)).toMatchObject({ kind: 'turn_interrupted' });
  });

  it('closes, reports process errors, and tolerates long stdio prompts', async () => {
    const thread = new CodexThread(launch({ codex: { developerInstructions: 'x'.repeat(50_000) } }), (e) => events.push(e)); await thread.send('a', 'prompt'); await start(child);
    expect(child.stdinText).toContain('x'.repeat(50_000));
    expect(requests(child).find((m) => m.method === 'turn/start')).toMatchObject({ params: { input: [{ type: 'text', text: 'prompt', text_elements: [] }] } });
    expect(JSON.stringify(spawnMock.mock.calls[0][1])).not.toContain('x'.repeat(100));
    child.emit('error', new Error('spawn failed')); await flush(); expect(events.at(-1)).toMatchObject({ kind: 'turn_failed' });
    await thread.close(); expect(child.killed).toBe('SIGTERM'); expect(thread.busy).toBe(false);
  });
});
