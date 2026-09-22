import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isMissingProviderThreadError, providerStateExists } from '@main/services/sessions/provider-state';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fuse-home-'));
  dirs.push(dir);
  return dir;
}

describe('providerStateExists', () => {
  it('finds Claude sessions under <config>/projects/*/<id>.jsonl', () => {
    const dir = home();
    mkdirSync(join(dir, '.claude', 'projects', '-home-user-repo'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'projects', '-home-user-repo', 'abc.jsonl'), '{}\n');
    expect(providerStateExists('claude', 'abc', { home: dir, env: {} })).toBe(true);
    expect(providerStateExists('claude', 'missing', { home: dir, env: {} })).toBe(false);
    // CLAUDE_CONFIG_DIR relocates the store.
    const other = home();
    mkdirSync(join(other, 'cfg', 'projects', 'p'), { recursive: true });
    writeFileSync(join(other, 'cfg', 'projects', 'p', 'xyz.jsonl'), '');
    expect(providerStateExists('claude', 'xyz', { home: dir, env: { CLAUDE_CONFIG_DIR: join(other, 'cfg') } })).toBe(true);
  });

  it('finds Codex rollouts under <CODEX_HOME>/sessions/YYYY/MM/DD', () => {
    const dir = home();
    const day = join(dir, '.codex', 'sessions', '2026', '09', '13');
    mkdirSync(day, { recursive: true });
    writeFileSync(join(day, 'rollout-2026-09-13T10-00-00-01a0-thread.jsonl'), '');
    expect(providerStateExists('codex', '01a0-thread', { home: dir, env: {} })).toBe(true);
    expect(providerStateExists('codex', '01a0-other', { home: dir, env: {} })).toBe(false);
    mkdirSync(join(dir, '.codex', 'archived_sessions'), { recursive: true });
    writeFileSync(join(dir, '.codex', 'archived_sessions', 'rollout-2026-09-01T10-00-00-01a0-old.jsonl'), '');
    expect(providerStateExists('codex', '01a0-old', { home: dir, env: {} })).toBe(true);
  });

  it('assumes the state exists when the store cannot be inspected', () => {
    const dir = home();
    expect(providerStateExists('claude', 'abc', { home: dir, env: {} })).toBe(true);
    expect(providerStateExists('codex', 'abc', { home: dir, env: {} })).toBe(true);
    expect(providerStateExists('codex', '', { home: dir, env: {} })).toBe(false);
  });

  it('recognises the CLIs\' missing-thread errors', () => {
    expect(isMissingProviderThreadError('No conversation found with session ID: 0000')).toBe(true);
    expect(isMissingProviderThreadError('Codex exited with exit code 1:\nError: thread/resume: thread/resume failed: no rollout found for thread id x (code -32600)')).toBe(true);
    expect(isMissingProviderThreadError('Claude Code exited unexpectedly (exit code 1).')).toBe(false);
  });
});
