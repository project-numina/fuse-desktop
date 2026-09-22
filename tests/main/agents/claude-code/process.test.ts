import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AGENT_CONFIG } from '@main/store/rows';
import type { ThreadLaunch } from '@main/agents/types';
import { FakeProcess, flush } from '@test/main/agents/fake-process';

const spawnMock = vi.fn();
vi.mock('@main/agents/spawn', () => ({
  spawnCli: (...args: unknown[]) => spawnMock(...args),
  killCli: (child: { kill(signal: string): void }, signal: string) => child.kill(signal),
}));

const { ClaudeProcess } = await import('@main/agents/claude-code/process');

function launch(): ThreadLaunch {
  return {
    threadId: 'thread-1',
    repoPath: '/repo',
    config: { ...DEFAULT_AGENT_CONFIG, provider: 'claude' },
    providerThreadId: null,
    executable: '',
  };
}

describe('ClaudeProcess', () => {
  let child: FakeProcess;

  beforeEach(() => {
    child = new FakeProcess();
    spawnMock.mockReset();
    spawnMock.mockReturnValue(child);
  });

  it('owns JSONL, stderr, stdin and termination for one process', async () => {
    const callbacks = {
      onLine: vi.fn(),
      onInvalidLine: vi.fn(),
      onStderr: vi.fn(),
      onError: vi.fn(),
      onExit: vi.fn(),
    };
    const runtime = ClaudeProcess.start(launch(), null, callbacks);
    child.emitLine({ type: 'system', subtype: 'init' });
    child.stdout.write('not-json\n');
    child.stderr.write('warning\n');
    runtime.write({ type: 'user' });
    await flush();

    expect(callbacks.onLine).toHaveBeenCalledWith({ type: 'system', subtype: 'init' }, expect.anything());
    expect(callbacks.onInvalidLine).toHaveBeenCalledWith('not-json', runtime);
    expect(callbacks.onStderr).toHaveBeenCalledWith('warning');
    expect(child.writtenJson()).toEqual([{ type: 'user' }]);

    runtime.stop();
    expect(child.killed).toBe('SIGTERM');
    child.exit(0);
    expect(callbacks.onExit).toHaveBeenCalledWith(0, null, runtime);
  });
});
