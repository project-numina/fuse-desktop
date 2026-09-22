import type { AgentEvent, PermissionDecision } from '@shared/agent-events';
import type { AgentConfig } from '../store/rows';

/** Claude Code specific launch options (see the session spec for the wiring). */
export interface ClaudeLaunchOptions {
  /** Replaces the CLI's default system prompt (`--system-prompt`). */
  systemPrompt?: string;
  /**
   * Same as `systemPrompt` but read from a file (`--system-prompt-file`).
   * Preferred for long prompts: Windows caps a command line at 32K chars.
   */
  systemPromptFile?: string;
  /** Appended to the default system prompt (`--append-system-prompt`). */
  appendSystemPrompt?: string;
  /** Directory of CLAUDE.md + agents/*.md passed as `--plugin-dir`. */
  pluginDir?: string;
  /**
   * Path of the `--mcp-config` JSON file (with `--strict-mcp-config`).
   * Preferred over `mcpConfigJson`: the file keeps the MCP server's token off
   * the command line.
   */
  mcpConfigFile?: string;
  /** Inline JSON for `--mcp-config`, when no file was written. */
  mcpConfigJson?: string;
  addDirs?: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  maxTurns?: number;
}

/** Codex specific launch options. */
export interface CodexLaunchOptions {
  /**
   * The developer message for the thread: passed as `-c developer_instructions`
   * on every turn where the command line can carry it, else inside a
   * delimited block at the top of the first turn's prompt.
   */
  developerInstructions?: string;
  /**
   * `-c mcp_servers.<name>.command=...` entries. Every value here lands on the
   * Codex command line, so `env` must hold nothing secret (a private bootstrap
   * file carries the server's real environment; see `sessions/launch.ts`).
   */
  mcpServers?: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
}

export interface ThreadLaunch {
  threadId: string;
  /** Working directory for the CLI (the repository root). */
  repoPath: string;
  config: AgentConfig;
  /** Provider conversation id to resume, when one exists. */
  providerThreadId: string | null;
  /** Explicit executable path, or '' to look the CLI up on PATH. */
  executable: string;
  /**
   * Extra environment for the CLI process itself. Everything here is
   * inherited by every shell command the agent runs, so the MCP server's
   * credentials are delivered through its own config instead.
   */
  env?: Record<string, string>;
  claude?: ClaudeLaunchOptions;
  codex?: CodexLaunchOptions;
}

export type EventSink = (event: AgentEvent) => void;

/**
 * One provider conversation. Adapters keep the CLI process (Claude) or the
 * provider thread id (Codex) so follow-up turns continue the conversation.
 */
export interface ProviderThread {
  readonly providerThreadId: string | null;
  /** True while a turn is running. Sends during a turn are queued. */
  readonly busy: boolean;
  send(turnId: string, text: string): Promise<void>;
  /**
   * Write a user message into the turn that is running right now, without
   * ending it. Only providers whose protocol accepts mid-turn input implement
   * this (Claude Code's stream-json stdin); callers must check for it and
   * queue the message for the next turn otherwise. The write is not
   * acknowledged: the caller confirms delivery from the next
   * `assistant_message_started` event.
   */
  steer?(text: string): Promise<void>;
  interrupt(): Promise<void>;
  /**
   * Answer a pending permission prompt. Resolves false when the request is
   * unknown or already answered (the prompt expired with its turn), so the
   * host can tell a late or duplicate answer from an accepted one.
   */
  respondPermission(requestId: string, decision: PermissionDecision): Promise<boolean>;
  close(): Promise<void>;
}

export function now(): number {
  return Date.now();
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
