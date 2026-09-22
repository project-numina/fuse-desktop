import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeProcess } from '@test/main/agents/fake-process';

const { spawnCli, killCli } = vi.hoisted(() => ({
  spawnCli: vi.fn(),
  killCli: vi.fn((child: FakeProcess, signal: NodeJS.Signals) => child.kill(signal)),
}));

vi.mock('@main/agents/spawn', () => ({ spawnCli, killCli }));

const { codexHistoryRequest } = await import('@main/services/sessions/codex-history-rpc');

describe('codexHistoryRequest', () => {
  let child: FakeProcess;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    child = new FakeProcess();
    spawnCli.mockReturnValue(child);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('performs the initialize handshake, ignores unrelated frames, and returns a fragmented UTF-8 result', async () => {
    const response = codexHistoryRequest('', 'thread/read', { threadId: 'thread-1', includeTurns: true });

    expect(spawnCli).toHaveBeenCalledWith('codex', ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    expect(child.writtenJson()).toEqual([{ id: 0, method: 'initialize', params: {
      clientInfo: { name: 'numina_fuse_history', title: 'Fuse History', version: '0.1.0' },
    } }]);

    child.stdout.write('not json\n');
    child.emitLine({ id: 99, result: 'ignored' });
    child.emitLine({ id: 0, result: { serverInfo: {} } });
    expect(child.writtenJson().slice(1)).toEqual([
      { method: 'initialized', params: {} },
      { id: 1, method: 'thread/read', params: { threadId: 'thread-1', includeTurns: true } },
    ]);

    const encoded = Buffer.from(`${JSON.stringify({ id: 1, result: { title: 'café 🍵' } })}\n`);
    const tea = encoded.indexOf(Buffer.from('🍵'));
    child.stdout.write(encoded.subarray(0, tea + 2));
    child.stdout.write(encoded.subarray(tea + 2));

    await expect(response).resolves.toEqual({ title: 'café 🍵' });
    expect(killCli).toHaveBeenCalledWith(child, 'SIGTERM');
    child.exit(0);
  });

  it('turns a JSON-RPC error into a stable user-facing error', async () => {
    const response = codexHistoryRequest('/bin/codex', 'thread/list', { cwd: '/repo' });
    child.emitLine({ id: 0, result: {} });
    child.emitLine({ id: 1, error: { code: -32603, message: 'private local detail' } });

    await expect(response).rejects.toThrow('The installed Codex CLI could not read its history. Try updating it.');
    expect(killCli).toHaveBeenCalledWith(child, 'SIGTERM');
    child.exit(1);
  });

  it('rejects if the app-server exits before replying', async () => {
    const response = codexHistoryRequest('codex-custom', 'thread/list', {});
    child.exit(2);

    await expect(response).rejects.toThrow('Codex history is unavailable. Check the Codex CLI in Settings → Agents.');
    expect(killCli).toHaveBeenCalledWith(child, 'SIGTERM');
  });

  it('bounds an unterminated response before it can exhaust application memory', async () => {
    const response = codexHistoryRequest('codex', 'thread/list', {});
    child.stdout.write(Buffer.alloc(64 * 1024 * 1024 + 1, 0x78));

    await expect(response).rejects.toThrow('This Codex history response is too large to display.');
    expect(killCli).toHaveBeenCalledWith(child, 'SIGTERM');
    child.exit(1);
  });

  it('times out and escalates cleanup to SIGKILL when the process does not exit', async () => {
    const response = codexHistoryRequest('codex', 'thread/list', {});
    const rejection = expect(response).rejects.toThrow('Codex history timed out. Check the Codex CLI in Settings → Agents.');

    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;
    expect(killCli).toHaveBeenCalledWith(child, 'SIGTERM');

    await vi.advanceTimersByTimeAsync(1_000);
    expect(killCli).toHaveBeenLastCalledWith(child, 'SIGKILL');
  });
});
