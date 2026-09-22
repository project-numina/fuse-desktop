/**
 * Opt-in end-to-end checks against the real CLIs. They spend a few cents of
 * API usage and need `claude` / `codex` logged in, so they only run with
 * `FUSE_LIVE_CLI=1 npx vitest run tests/main/agents/live-cli.test.ts`.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@shared/agent-events';
import { DEFAULT_AGENT_CONFIG as DEFAULT_THREAD_CONFIG } from '@main/store/rows';
import { ClaudeCodeThread } from '@main/agents/claude-code';
import { CodexThread } from '@main/agents/codex';
import type { ProviderThread } from '@main/agents/types';

const live = process.env.FUSE_LIVE_CLI === '1';

function scratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fuse-live-'));
  writeFileSync(join(dir, 'hello.py'), "print('hi')\n");
  return dir;
}

async function runTurn(thread: ProviderThread, events: AgentEvent[], prompt: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('turn timed out')), 120_000);
    const check = setInterval(() => {
      const last = events[events.length - 1];
      if (last && (last.kind === 'turn_completed' || last.kind === 'turn_failed' || last.kind === 'turn_interrupted')) {
        clearInterval(check);
        clearTimeout(timer);
        resolve();
      }
    }, 100);
    void thread.send(`turn-${events.length}`, prompt);
  });
}

describe.skipIf(!live)('live CLI round trips', () => {
  it('drives Claude Code through two turns with a tool call', async () => {
    const events: AgentEvent[] = [];
    const thread = new ClaudeCodeThread(
      {
        threadId: 't',
        repoPath: scratchRepo(),
        config: { ...DEFAULT_THREAD_CONFIG, provider: 'claude', model: 'haiku', claude_permission_mode: 'acceptEdits' },
        providerThreadId: null,
        executable: '',
      },
      (event) => events.push(event),
    );
    try {
      await runTurn(thread, events, 'Read hello.py with the Read tool, then reply with exactly: hello');
      expect(events.some((event) => event.kind === 'thread_started')).toBe(true);
      expect(events.some((event) => event.kind === 'tool_call_started' && event.tool === 'Read')).toBe(true);
      expect(events.some((event) => event.kind === 'assistant_text_completed' && /hello/i.test(event.text))).toBe(true);
      expect(events[events.length - 1].kind).toBe('turn_completed');
      const firstCount = events.length;
      await runTurn(thread, events, 'Reply with exactly: again');
      expect(events.slice(firstCount).some((event) => event.kind === 'assistant_text_completed' && /again/i.test(event.text))).toBe(true);
    } finally {
      await thread.close();
    }
  }, 300_000);

  it('drives Codex through a turn and resumes it', async () => {
    const events: AgentEvent[] = [];
    const thread = new CodexThread(
      {
        threadId: 't',
        repoPath: scratchRepo(),
        config: { ...DEFAULT_THREAD_CONFIG, provider: 'codex', model: '', effort: 'low', codex_sandbox: 'read-only' },
        providerThreadId: null,
        executable: '',
      },
      (event) => events.push(event),
    );
    try {
      await runTurn(thread, events, 'Print the contents of hello.py with cat, then reply with exactly: hello');
      expect(thread.providerThreadId).not.toBeNull();
      expect(events.some((event) => event.kind === 'tool_call_started' && event.tool === 'Bash')).toBe(true);
      expect(events[events.length - 1].kind).toBe('turn_completed');
      const firstCount = events.length;
      await runTurn(thread, events, 'Reply with exactly: again');
      if (process.env.FUSE_LIVE_DEBUG) console.error(JSON.stringify(events.slice(firstCount), null, 1).slice(0, 4000));
      expect(events.slice(firstCount).some((event) => event.kind === 'assistant_text_completed' && /again/i.test(event.text))).toBe(true);
    } finally {
      await thread.close();
    }
  }, 300_000);
});
