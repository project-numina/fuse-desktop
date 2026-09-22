/**
 * Provider-neutral event vocabulary shared by the main process (where the
 * Claude Code and Codex CLIs are spawned) and the renderer (where events are
 * folded into a transcript).
 *
 * Both provider adapters translate their native JSON streams into this
 * union. Nothing here imports provider-specific types, so the renderer never
 * needs to know which CLI produced an event.
 */

export type ProviderId = 'claude' | 'codex';

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Claude Code's `--permission-mode` values that make sense for a desktop host. */
export type ClaudePermissionMode = 'manual' | 'acceptEdits' | 'plan' | 'bypassPermissions';

/** Codex's `--sandbox` values. Codex has no per-tool prompt in exec mode. */
export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

/**
 * Token usage of one turn in Anthropic's convention: `inputTokens` are the
 * uncached input tokens, and the cached reads / cache writes are reported
 * separately, so the total input is the sum of the three. Adapters whose
 * provider counts cached tokens inside `input_tokens` (Codex) subtract them
 * before reporting.
 */
export interface UsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  reasoningOutputTokens: number;
  costUsd: number | null;
  contextWindow: number | null;
}

export interface PermissionSuggestion {
  /** Human-readable label, e.g. "Always allow Bash(npm test:*)". */
  label: string;
  /** Opaque provider payload echoed back when the user picks this option. */
  payload: unknown;
}

/** One normalized event emitted while a thread is active. */
export type AgentEvent =
  | { kind: 'user_message'; turnId: string; text: string; at: number }
  | { kind: 'thread_started'; providerThreadId: string; model: string | null; at: number }
  | { kind: 'turn_started'; turnId: string; at: number }
  | { kind: 'assistant_text_delta'; turnId: string; blockId: string; text: string; at: number }
  | { kind: 'assistant_text_completed'; turnId: string; blockId: string; text: string; at: number }
  | { kind: 'thinking_delta'; turnId: string; blockId: string; text: string; at: number }
  | { kind: 'thinking_completed'; turnId: string; blockId: string; at: number }
  | {
      kind: 'tool_call_started';
      turnId: string;
      toolCallId: string;
      tool: string;
      input: Record<string, unknown>;
      parentToolCallId: string | null;
      at: number;
    }
  | {
      kind: 'tool_call_completed';
      turnId: string;
      toolCallId: string;
      result: string | null;
      isError: boolean;
      at: number;
    }
  | {
      kind: 'permission_request';
      turnId: string;
      requestId: string;
      toolCallId: string | null;
      tool: string;
      input: Record<string, unknown>;
      description: string | null;
      reason: string | null;
      suggestions: PermissionSuggestion[];
      at: number;
    }
  | { kind: 'permission_resolved'; turnId: string; requestId: string; behavior: 'allow' | 'deny'; at: number }
  | { kind: 'usage'; turnId: string; usage: UsageSnapshot; at: number }
  | {
      kind: 'turn_completed';
      turnId: string;
      stopReason: string | null;
      durationMs: number | null;
      costUsd: number | null;
      at: number;
    }
  | { kind: 'turn_interrupted'; turnId: string; at: number }
  | { kind: 'turn_failed'; turnId: string; message: string; at: number }
  | { kind: 'runtime_log'; turnId: string | null; level: 'info' | 'warn' | 'error'; message: string; at: number }
  /**
   * The top-level model started a new message (Claude `message_start`).
   * Proof that the model has read everything written to it so far; the
   * session runner uses it to confirm steered user messages.
   */
  | { kind: 'assistant_message_started'; turnId: string; at: number }
  /** Prose streamed by a subagent (Claude `Task`), keyed by the spawning tool call. */
  | {
      kind: 'subagent_text_delta';
      turnId: string;
      parentToolCallId: string;
      text: string;
      deltaKind: 'text' | 'thinking';
      at: number;
    }
  /** One complete text block of a subagent message; `messageId` is the provider message id. */
  | {
      kind: 'subagent_text_completed';
      turnId: string;
      parentToolCallId: string;
      text: string;
      messageId: string;
      at: number;
    }
  /**
   * Lifecycle of a subagent run: `running` when it starts, then one of
   * `completed` | `failed` | `stopped`. `toolCallId` is the spawning tool
   * call (the card identity in the UI); null when the provider gave none.
   */
  | { kind: 'agent_status'; turnId: string; toolCallId: string | null; agent: string; status: string; at: number };

export type AgentEventKind = AgentEvent['kind'];

export interface PermissionDecision {
  behavior: 'allow' | 'deny';
  /** Optional message shown to the model when denying. */
  message?: string;
  /** A suggestion payload the user accepted, e.g. "always allow". */
  suggestion?: unknown;
}
