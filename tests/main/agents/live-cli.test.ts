/**
 * Opt-in end-to-end checks against the real CLIs. They spend a few cents of
 * API usage and need `claude` / `codex` logged in, so they only run with
 * `FUSE_LIVE_CLI=1 npx vitest run tests/main/agents/live-cli.test.ts`.
 * The model listings make no model calls and cost nothing.
 */

import { execFileSync } from 'node:child_process';

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@shared/agent-events';
import { DEFAULT_AGENT_CONFIG as DEFAULT_THREAD_CONFIG } from '@main/store/rows';
import { ClaudeCodeThread } from '@main/agents/claude-code';
import { CodexThread } from '@main/agents/codex';
import { listModels, stopModelProbes } from '@main/agents/models';
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

/** Model probe processes still running: a `claude`/`codex` executable with only the probes' arguments. */
function runningProbes(): string[] {
  const commands = execFileSync('ps', ['-Ao', 'command='], { encoding: 'utf8' }).split('\n');
  return commands.filter(command => /(^|\/)claude -p --input-format stream-json .*--no-session-persistence$/.test(command)
    || /(^|\/)codex app-server$/.test(command));
}

describe.skipIf(!live)('live CLI model listings', () => {
  it.each([
    ['claude', ['opus', 'sonnet', 'haiku']],
    ['codex', []],
  ] as const)('lists the models %s reports, then stops the probe', async (provider, expected) => {
    const started = Date.now();
    const models = await listModels(provider, '');
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(model.value).toMatch(/^\S+$/);
      expect(model.value).not.toBe('default');
      expect(model.label.trim()).not.toBe('');
    }
    expect(new Set(models.map(model => model.value)).size).toBe(models.length);
    expect(models.map(model => model.value)).toEqual(expect.arrayContaining([...expected]));
    expect(Date.now() - started).toBeLessThan(20_000);

    // A second request is served from the cache without starting the CLI.
    const cachedStart = Date.now();
    await expect(listModels(provider, '')).resolves.toEqual(models);
    expect(Date.now() - cachedStart).toBeLessThan(50);

    await stopModelProbes();
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(runningProbes()).toEqual([]);
  }, 60_000);

  it('rejects promptly for a CLI path that does not exist', async () => {
    const started = Date.now();
    await expect(listModels('codex', join(tmpdir(), 'fuse-missing-codex'))).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
