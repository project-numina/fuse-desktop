/**
 * Whether a provider still holds the state a stored thread id points at.
 *
 * Both CLIs keep their conversations as files under the user's home
 * directory and prune them over time (Claude Code after `cleanupPeriodDays`,
 * Codex when its session store is rotated), and a user may move machines.
 * Resuming such an id fails hard (`No conversation found with session ID`,
 * `no rollout found for thread id`), so the session service checks first
 * and falls back to replaying the stored transcript, as the web does when
 * a session's local state is gone.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ProviderId } from '@shared/agent-events';

export interface ProviderStateOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
}

/** Messages the CLIs print when the thread behind `--resume` / `exec resume` is gone. */
const MISSING_THREAD_PATTERNS = [/No conversation found with session ID/i, /no rollout found for thread id/i, /no rollout found/i];

export function isMissingProviderThreadError(message: string): boolean {
  return MISSING_THREAD_PATTERNS.some((pattern) => pattern.test(message));
}

function claudeSessionExists(threadId: string, options: ProviderStateOptions): boolean | null {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const configDir = env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude');
  const projects = join(configDir, 'projects');
  let entries: string[];
  try {
    entries = readdirSync(projects);
  } catch {
    return null;
  }
  const file = `${threadId}.jsonl`;
  for (const entry of entries) {
    const dir = join(projects, entry);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    if (existsSync(join(dir, file))) return true;
  }
  return false;
}

/** Walk `<root>/YYYY/MM/DD/rollout-…-<id>.jsonl` (bounded depth) for a file naming the thread. */
function rolloutExists(root: string, threadId: string, depth: number): boolean | null {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const path = join(root, entry);
    let isDirectory: boolean;
    try {
      isDirectory = statSync(path).isDirectory();
    } catch {
      continue;
    }
    if (isDirectory) {
      if (depth > 0 && rolloutExists(path, threadId, depth - 1) === true) return true;
    } else if (entry.includes(threadId) && entry.endsWith('.jsonl')) {
      return true;
    }
  }
  return false;
}

function codexRolloutExists(threadId: string, options: ProviderStateOptions): boolean | null {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const codexHome = env.CODEX_HOME?.trim() || join(home, '.codex');
  const roots = [join(codexHome, 'sessions'), join(codexHome, 'archived_sessions')];
  let sawStore = false;
  for (const root of roots) {
    const found = rolloutExists(root, threadId, 3);
    if (found === null) continue;
    sawStore = true;
    if (found) return true;
  }
  return sawStore ? false : null;
}

/**
 * True when the provider can resume `threadId`, false when its store exists
 * but no longer holds the thread. An unreadable or unknown store layout
 * yields true: the launch is attempted and a resume failure handled then.
 */
export function providerStateExists(provider: ProviderId, threadId: string, options: ProviderStateOptions = {}): boolean {
  if (!threadId.trim()) return false;
  const found = provider === 'codex' ? codexRolloutExists(threadId, options) : claudeSessionExists(threadId, options);
  return found !== false;
}
