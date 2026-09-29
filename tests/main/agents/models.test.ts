import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeProcess, flush } from '@test/main/agents/fake-process';

const spawnMock = vi.fn();
vi.mock('@main/agents/spawn', () => ({
  spawnCli: (...args: unknown[]) => spawnMock(...args),
  killCli: (child: { kill(signal: string): void }, signal: string) => child.kill(signal),
}));

const { listModels, parseClaudeModels, parseCodexModels } = await import('@main/agents/models');

let child: FakeProcess;
beforeEach(() => {
  spawnMock.mockReset();
  spawnMock.mockImplementation(() => {
    child = new FakeProcess();
    return child;
  });
});

describe('parsing CLI model listings', () => {
  it('keeps Claude Code aliases and IDs but not its own "default" entry', () => {
    expect(parseClaudeModels({ models: [
      { value: 'default', displayName: 'Default (recommended)' },
      { value: 'opus', displayName: 'Opus 5.5', description: 'For complex work' },
      { value: 'claude-sonnet-5' },
    ] })).toEqual([
      { value: 'opus', label: 'Opus 5.5', description: 'For complex work' },
      { value: 'claude-sonnet-5', label: 'claude-sonnet-5', description: undefined },
    ]);
    expect(() => parseClaudeModels({})).toThrow(/did not report/);
  });

  it('leaves out models Codex marks hidden', () => {
    expect(parseCodexModels({ data: [
      { id: 'gpt-6-astra', displayName: 'GPT-6-Astra', description: 'Frontier', hidden: false },
      { id: 'internal', displayName: 'Internal', hidden: true },
    ] })).toEqual([{ value: 'gpt-6-astra', label: 'GPT-6-Astra', description: 'Frontier' }]);
    expect(() => parseCodexModels({ data: null })).toThrow(/did not report/);
  });
});

describe('listModels', () => {
  it('asks Claude Code through the initialize control request, then stops it', async () => {
    const listing = listModels('claude', '/bin/claude-a');
    await flush();
    expect(spawnMock).toHaveBeenCalledWith('/bin/claude-a',
      ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence'],
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }));
    expect(child.writtenJson()).toEqual([{ type: 'control_request', request_id: 'models', request: { subtype: 'initialize' } }]);
    child.emitLine({ type: 'system', subtype: 'hook_started' });
    child.emitLine({ type: 'control_response', response: { subtype: 'success', request_id: 'models', response: {
      models: [{ value: 'opus', displayName: 'Opus 5.5' }],
    } } });
    await expect(listing).resolves.toEqual([{ value: 'opus', label: 'Opus 5.5', description: undefined }]);
    expect(child.killed).toBe('SIGTERM');
  });

  it('asks Codex through app-server model/list', async () => {
    const listing = listModels('codex', '/bin/codex-a');
    await flush();
    expect(spawnMock).toHaveBeenCalledWith('/bin/codex-a', ['app-server'], expect.any(Object));
    expect(child.writtenJson().map(message => message.method)).toEqual(['initialize', 'initialized', 'model/list']);
    child.emitLine({ id: 1, result: {} });
    child.emitLine({ id: 2, result: { data: [{ id: 'gpt-6-astra', displayName: 'GPT-6-Astra' }] } });
    await expect(listing).resolves.toEqual([{ value: 'gpt-6-astra', label: 'GPT-6-Astra', description: undefined }]);
  });

  it('reuses a successful listing for the same executable', async () => {
    const first = listModels('codex', '/bin/codex-b');
    await flush();
    child.emitLine({ id: 2, result: { data: [{ id: 'gpt-6-astra' }] } });
    await first;
    await expect(listModels('codex', ' /bin/codex-b ')).resolves.toEqual([{ value: 'gpt-6-astra', label: 'gpt-6-astra', description: undefined }]);
    expect(spawnMock).toHaveBeenCalledOnce();
  });

  it('rejects when the CLI exits or errors, and asks again next time', async () => {
    const exited = listModels('codex', '/bin/codex-c');
    await flush();
    child.exit(1);
    await expect(exited).rejects.toThrow(/exited before listing/);

    const refused = listModels('codex', '/bin/codex-c');
    await flush();
    child.emitLine({ id: 2, error: { message: 'not signed in' } });
    await expect(refused).rejects.toThrow('not signed in');
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('gives up on a CLI that never answers', async () => {
    vi.useFakeTimers();
    try {
      const listing = listModels('claude', '/bin/claude-slow');
      const assertion = expect(listing).rejects.toThrow(/did not list its models in time/);
      await vi.advanceTimersByTimeAsync(20_000);
      await assertion;
      expect(child.killed).toBe('SIGTERM');
    } finally {
      vi.useRealTimers();
    }
  });
});
