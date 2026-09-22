import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { getSessionInfo, getSessionMessages, listSessions } from '@anthropic-ai/claude-agent-sdk';
import { codexHistoryRequest } from '@main/services/sessions/codex-history-rpc';
import { claudeMessages, codexMessages, ProviderNativeHistory } from '@main/services/sessions/native-history';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ getSessionInfo: vi.fn(), getSessionMessages: vi.fn(), listSessions: vi.fn() }));
vi.mock('@main/services/sessions/codex-history-rpc', () => ({ codexHistoryRequest: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

describe('native history adapters', () => {
  it('reads Claude text, tools, results, and attachment placeholders in order', () => {
    const rows = claudeMessages([
      { uuid: 'u', type: 'user', message: { content: 'Hello' } },
      { uuid: 'a', type: 'assistant', message: { content: [{ type: 'text', text: 'Working' }, { type: 'tool_use', id: 't', name: 'Read', input: { file_path: 'a.lean' } }] } },
      { uuid: 'r', type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'source' }, { type: 'image' }] } },
    ]);
    expect(rows.map((row) => row.role)).toEqual(['user', 'agent', 'tool', 'tool', 'user']);
    expect(rows[2].tool_use_id).toBe('t');
    expect(rows[3].content).toContain('source');
    expect(rows[4].content).toBe('[Image attachment]');
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  it('preserves Codex text, commands, diffs, and unknown events', () => {
    const rows = codexMessages({ turns: [{ items: [
      { id: 'u', type: 'userMessage', content: [{ type: 'text', text: 'Fix it' }] },
      { id: 'c', type: 'commandExecution', command: 'lake build', aggregatedOutput: 'ok' },
      { id: 'f', type: 'fileChange', changes: [{ path: 'A.lean', diff: '+x' }] },
      { id: 'a', type: 'agentMessage', text: 'Done' },
    ] }] });
    expect(rows.map((row) => row.role)).toEqual(['user', 'tool', 'tool', 'tool', 'agent']);
    expect(rows[3].content).toContain('+x');
  });

  it('scopes both providers to exact folders, deduplicates roots and paginates Codex', async () => {
    vi.mocked(listSessions).mockResolvedValue([{ sessionId: 'c1', cwd: '/repo', summary: 'Claude', lastModified: 1000 }, { sessionId: 'other', cwd: '/other', summary: 'Private', lastModified: 1000 }]);
    vi.mocked(codexHistoryRequest).mockResolvedValueOnce({ data: [{ id: 'x1', cwd: '/repo', preview: 'Codex', createdAt: 1, updatedAt: 2 }], nextCursor: 'next' })
      .mockResolvedValueOnce({ data: [{ id: 'outside', cwd: '/other', preview: 'Private' }], nextCursor: null });
    const result = await new ProviderNativeHistory(() => '/bin/codex').list(['/repo', '/repo']);
    expect(result.sessions.map((row) => row.threadId).sort()).toEqual(['c1', 'x1']);
    expect(result.errors).toEqual([]);
    expect(listSessions).toHaveBeenCalledTimes(1);
    expect(codexHistoryRequest).toHaveBeenLastCalledWith('/bin/codex', 'thread/list', expect.objectContaining({ cursor: 'next', cwd: resolve('/repo') }));
  });

  it('keeps one provider available when the other fails', async () => {
    vi.mocked(listSessions).mockResolvedValue([{ sessionId: 'c1', cwd: '/repo', summary: 'Claude', lastModified: 1000 }]);
    vi.mocked(codexHistoryRequest).mockRejectedValue(new Error('missing binary'));
    const result = await new ProviderNativeHistory(() => 'codex').list(['/repo']);
    expect(result.sessions).toHaveLength(1);
    expect(result.errors[0]).toContain('Codex history could not be read');
  });

  it('does not read a session from a different folder', async () => {
    vi.mocked(getSessionInfo).mockResolvedValue({ sessionId: 'c', cwd: '/other', summary: '', lastModified: 1000 });
    const reader = new ProviderNativeHistory(() => 'codex');
    await expect(reader.read({ provider: 'claude', threadId: 'c', directory: '/repo' })).rejects.toThrow('different folder');
    expect(getSessionMessages).not.toHaveBeenCalled();
    vi.mocked(codexHistoryRequest).mockResolvedValue({ thread: { id: 'x', cwd: '/other', turns: [] } });
    await expect(reader.read({ provider: 'codex', threadId: 'x', directory: '/repo' })).rejects.toThrow('different folder');
    expect(codexHistoryRequest).toHaveBeenCalledWith('codex', 'thread/read', { threadId: 'x', includeTurns: true });
  });
});
