import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AGENT_CONFIG } from '@main/store/rows';
import { FakeProcess, flush } from '@test/main/agents/fake-process';
import { CodexTransport } from '@main/agents/codex/transport';

const spawn = vi.hoisted(() => vi.fn());
vi.mock('@main/agents/spawn', () => ({
  spawnCli: spawn,
  killCli: (child: FakeProcess, signal: NodeJS.Signals) => child.kill(signal),
}));

const launch = { threadId: 'local', repoPath: '/repo', config: DEFAULT_AGENT_CONFIG, providerThreadId: null, executable: '' };

function makeHooks() {
  return { notification: vi.fn<() => void>(), request: vi.fn<() => void>(), log: vi.fn<() => void>(), exit: vi.fn<() => void>() };
}

describe('CodexTransport', () => {
  let child: FakeProcess;
  let transport: CodexTransport;
  let hooks: ReturnType<typeof makeHooks>;
  beforeEach(() => {
    child = new FakeProcess();
    spawn.mockReturnValue(child);
    hooks = makeHooks();
    transport = new CodexTransport(launch, ['app-server'], hooks);
  });
  afterEach(() => { transport.close(); vi.useRealTimers(); });

  it('correlates out-of-order responses and routes server requests separately', async () => {
    const first = transport.request('one', {});
    const second = transport.request('two', {});
    child.emitLine({ id: 2, result: { second: true } });
    child.emitLine({ method: 'notice', params: { text: 'hello' } });
    child.emitLine({ id: 'approval', method: 'approve', params: { command: 'test' } });
    child.emitLine({ id: 1, result: { first: true } });
    await expect(first).resolves.toEqual({ first: true });
    await expect(second).resolves.toEqual({ second: true });
    expect(hooks.notification).toHaveBeenCalledWith('notice', { text: 'hello' });
    expect(hooks.request).toHaveBeenCalledWith('approval', 'approve', { command: 'test' });
    transport.reject('approval', 'unsupported');
    expect(child.writtenJson().at(-1)).toMatchObject({ id: 'approval', error: { code: -32601 } });
  });

  it('reports RPC failures and rejects all pending requests when the process exits', async () => {
    const failed = transport.request('bad', {}).catch((error: Error) => error.message);
    child.emitLine({ id: 1, error: { message: 'invalid config' } });
    expect(await failed).toBe('invalid config');
    const pending = transport.request('pending', {}).catch((error: Error) => error.message);
    child.exit(1);
    expect(await pending).toContain('closed');
    expect(hooks.exit).toHaveBeenCalledOnce();
    await expect(transport.request('later', {})).rejects.toThrow('closed');
  });

  it('times out unacknowledged requests and ignores late replies', async () => {
    vi.useFakeTimers();
    const pending = transport.request('turn/start', {}).catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toContain('timed out');
    child.emitLine({ id: 1, result: {} });
    expect(hooks.notification).not.toHaveBeenCalled();
  });

  it('closes idempotently and escalates a process that ignores termination', async () => {
    vi.useFakeTimers();
    transport.close();
    expect(child.killed).toBe('SIGTERM');
    await vi.advanceTimersByTimeAsync(3000);
    expect(child.killed).toBe('SIGKILL');
    transport.close();
    child.exit(0);
    expect(hooks.exit).not.toHaveBeenCalled();
  });

  it('handles a closed stdin without an unhandled stream error', async () => {
    child.stdin.emit('error', new Error('EPIPE'));
    await flush();
    expect(hooks.exit).toHaveBeenCalledWith(expect.stringContaining('EPIPE'));
  });
});
