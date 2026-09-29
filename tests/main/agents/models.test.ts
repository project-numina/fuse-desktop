import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeProcess, flush } from '@test/main/agents/fake-process';

const spawnMock = vi.fn();
vi.mock('@main/agents/spawn', () => ({
  spawnCli: (...args: unknown[]) => spawnMock(...args),
  killCli: (child: { kill(signal: string): void }, signal: string) => child.kill(signal),
}));

const { listModels, parseClaudeModels, parseCodexModels, stopModelProbes } = await import('@main/agents/models');

let child: FakeProcess;
let children: FakeProcess[];
beforeEach(() => {
  children = [];
  spawnMock.mockReset();
  spawnMock.mockImplementation(() => {
    child = new FakeProcess();
    children.push(child);
    return child;
  });
});

afterEach(() => {
  for (const process of children) { process.exit(0); process.emit('close'); }
  vi.useRealTimers();
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
    expect(child.writtenJson().map(message => message.method)).toEqual(['initialize']);
    child.emitLine({ id: 1, result: {} });
    expect(child.writtenJson().map(message => message.method)).toEqual(['initialize', 'initialized', 'model/list']);
    child.emitLine({ id: 2, result: { data: [{ id: 'gpt-6-astra', displayName: 'GPT-6-Astra' }] } });
    await expect(listing).resolves.toEqual([{ value: 'gpt-6-astra', label: 'GPT-6-Astra', description: undefined }]);
  });

  it('reuses a successful listing for the same executable', async () => {
    const first = listModels('codex', '/bin/codex-b');
    await flush();
    child.emitLine({ id: 1, result: {} });
    child.emitLine({ id: 2, result: { data: [{ id: 'gpt-6-astra' }] } });
    await first;
    await expect(listModels('codex', ' /bin/codex-b ')).resolves.toEqual([{ value: 'gpt-6-astra', label: 'gpt-6-astra', description: undefined }]);
    expect(spawnMock).toHaveBeenCalledOnce();
  });

  it('rejects when the CLI exits or errors, and asks again next time', async () => {
    const exited = listModels('codex', '/bin/codex-c');
    await flush();
    child.exit(1);
    child.emit('close');
    await expect(exited).rejects.toThrow(/exited before listing/);

    const refused = listModels('codex', '/bin/codex-c');
    await flush();
    child.emitLine({ id: 1, result: {} });
    child.emitLine({ id: 2, error: { message: 'not signed in' } });
    await expect(refused).rejects.toThrow('not signed in');
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('rejects initialization errors immediately without requesting models', async () => {
    const listing = listModels('codex', '/bin/codex-init-error');
    child.emitLine({ id: 1, error: { message: 'initialization failed' } });
    await expect(listing).rejects.toThrow('initialization failed');
    expect(child.writtenJson()).toHaveLength(1);
  });

  it('collects every model page and ignores unrelated responses', async () => {
    const listing = listModels('codex', '/bin/codex-pages');
    child.emitLine({ id: 1, result: {} });
    child.emitLine({ id: 2, result: { data: [{ id: 'first' }], nextCursor: 'page-2' } });
    expect(child.killed).toBeNull();
    expect(child.writtenJson().at(-1)).toEqual({ id: 3, method: 'model/list', params: { cursor: 'page-2' } });
    child.emitLine({ id: 2, result: { data: [{ id: 'duplicate' }] } });
    child.emitLine({ id: 3, result: { data: [{ id: 'second' }], nextCursor: null } });
    await expect(listing).resolves.toEqual([
      { value: 'first', label: 'first' }, { value: 'second', label: 'second' },
    ]);
  });

  it('reads the final response after exit, including split UTF-8 and no newline', async () => {
    const listing = listModels('claude', '/bin/claude-drain');
    child.exit(0);
    const line = Buffer.from(JSON.stringify({ type: 'control_response', response: {
      subtype: 'success', request_id: 'models', response: { models: [{ value: 'opus', displayName: 'Modèle' }] },
    } }));
    const split = line.indexOf(Buffer.from('è')) + 1;
    child.stdout.write(line.subarray(0, split));
    child.stdout.write(line.subarray(split));
    child.emit('close');
    await expect(listing).resolves.toEqual([{ value: 'opus', label: 'Modèle' }]);
    expect(child.killed).toBeNull();
  });

  it('rejects transport and spawn errors and allows retry', async () => {
    const listing = listModels('claude', '/bin/claude-errors');
    child.stdin.emit('error', new Error('broken pipe'));
    await expect(listing).rejects.toThrow('broken pipe');
    const retry = listModels('claude', '/bin/claude-errors');
    child.emit('error', new Error('ENOENT'));
    child.emit('close');
    await expect(retry).rejects.toThrow('ENOENT');
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('shares an in-flight probe and escalates termination even after success', async () => {
    vi.useFakeTimers();
    const listing = listModels('codex', '/bin/codex-stubborn');
    expect(listModels('codex', '/bin/codex-stubborn')).toBe(listing);
    child.emitLine({ id: 1, result: {} });
    child.emitLine({ id: 2, result: { data: [] } });
    await listing;
    expect(child.killed).toBe('SIGTERM');
    await vi.advanceTimersByTimeAsync(3000);
    expect(child.killed).toBe('SIGKILL');
  });

  it('cancels probes on app shutdown and clears escalation on signal exit', async () => {
    vi.useFakeTimers();
    const listing = listModels('claude', '/bin/claude-shutdown');
    const assertion = expect(listing).rejects.toThrow('Model discovery stopped');
    const stopped = stopModelProbes();
    expect(child.killed).toBe('SIGTERM');
    child.exit(null, 'SIGTERM');
    await stopped;
    await assertion;
    await vi.advanceTimersByTimeAsync(3000);
    expect(child.killed).toBe('SIGTERM');
  });

  it('rejects an invalid provider without launching anything', async () => {
    await expect(listModels('invalid' as 'claude', '')).rejects.toThrow('Unknown model provider');
    expect(spawnMock).not.toHaveBeenCalled();
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
