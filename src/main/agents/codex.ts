/**
 * Drives the Codex CLI through `codex exec --json`, one subprocess per turn.
 *
 * Codex persists its own thread on disk; follow-up turns run
 * `codex exec resume <thread_id>` so the conversation continues. Codex has no
 * interactive permission prompt in exec mode, so the sandbox mode chosen in
 * the UI is the safety boundary.
 */

import type { ChildProcess } from 'node:child_process';
import type { AgentEvent, PermissionDecision, UsageSnapshot } from '@shared/agent-events';
import { JsonLineReader } from './jsonl';
import { killCli, spawnCli } from './spawn';
import { asNumber, asRecord, asString, now, type EventSink, type ProviderThread, type ThreadLaunch } from './types';

/**
 * Windows caps a command line at 32 767 characters; the developer message
 * only travels as `-c developer_instructions=...` when the whole command line
 * stays well inside that, else it opens the first prompt.
 */
const MAX_COMMAND_LINE_CHARS = 30_000;

/**
 * Web parity: the Codex parent runs without native subagents, apps, plugins,
 * browser/computer use, image generation, goals or web search (the web's
 * `[features]` block). Codex 0.153 still advertises its collaboration tools
 * with `multi_agent` off; the prompt tells the model not to use them, and an
 * item type this adapter does not know is logged rather than lost silently.
 */
export const CODEX_FEATURE_OVERRIDES: readonly string[] = [
  'features.multi_agent=false',
  'features.multi_agent_v2=false',
  'features.code_mode=false',
  'features.apps=false',
  'features.browser_use=false',
  'features.computer_use=false',
  'features.plugins=false',
  'features.image_generation=false',
  'features.goals=false',
  'web_search="disabled"',
];

interface QueuedTurn {
  turnId: string;
  text: string;
}

export class CodexThread implements ProviderThread {
  private process: ChildProcess | null = null;
  private threadId: string | null;
  private currentTurn: QueuedTurn | null = null;
  private readonly queue: QueuedTurn[] = [];
  private readonly startedItems = new Set<string>();
  /** Set when `turn.completed` lands; emitted once the process exits. */
  private pendingCompletion: AgentEvent | null = null;
  private lingerTimer: NodeJS.Timeout | null = null;
  private interruptRequested = false;
  private closed = false;

  constructor(
    private readonly launch: ThreadLaunch,
    private readonly emit: EventSink,
  ) {
    this.threadId = launch.providerThreadId;
  }

  get providerThreadId(): string | null {
    return this.threadId;
  }

  get busy(): boolean {
    return this.currentTurn !== null;
  }

  async send(turnId: string, text: string): Promise<void> {
    if (this.closed) throw new Error('This thread has been closed.');
    this.queue.push({ turnId, text });
    this.pump();
  }

  async interrupt(): Promise<void> {
    if (!this.process || !this.currentTurn) return;
    // The model already finished (`turn.completed` landed); the process is
    // only flushing its session file, so the turn stays a completed one.
    if (this.pendingCompletion) return;
    this.interruptRequested = true;
    killCli(this.process, 'SIGINT');
    const child = this.process;
    setTimeout(() => {
      if (child.exitCode === null) killCli(child, 'SIGKILL');
    }, 3000);
  }

  async respondPermission(_requestId: string, _decision: PermissionDecision): Promise<boolean> {
    // Codex exec never asks; approvals are decided by the sandbox mode.
    return false;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.queue.length = 0;
    if (this.process) killCli(this.process, 'SIGTERM');
  }

  private pump(): void {
    if (this.currentTurn || this.queue.length === 0) return;
    const turn = this.queue.shift()!;
    this.currentTurn = turn;
    this.interruptRequested = false;
    this.pendingCompletion = null;
    this.startedItems.clear();
    this.emit({ kind: 'user_message', turnId: turn.turnId, text: turn.text, at: now() });
    this.emit({ kind: 'turn_started', turnId: turn.turnId, at: now() });

    const args = buildCodexArgs(this.launch, this.threadId);
    let child: ChildProcess;
    try {
      child = spawnCli(this.launch.executable || 'codex', args, {
        cwd: this.launch.repoPath,
        env: { ...process.env, ...(this.launch.env ?? {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // A CLI that exits before reading the prompt (auth failure, a missing
      // rollout, a bad flag) closes the pipe under the write; the exit handler
      // reports that from stderr, so the stream error itself is swallowed.
      child.stdin?.on('error', () => undefined);
      // The prompt travels over stdin (`-`) so free text never meets a shell.
      // When the command line cannot carry the developer message, the first
      // turn of a thread opens with it in a delimited block.
      const instructions = !this.threadId && developerInstructionsChannel(this.launch) === 'prompt' ? this.launch.codex?.developerInstructions : null;
      child.stdin?.end(instructions ? `${wrapDeveloperInstructions(instructions)}\n\n${turn.text}` : turn.text);
    } catch (error) {
      this.finishTurn({ kind: 'turn_failed', turnId: turn.turnId, message: String(error), at: now() });
      return;
    }
    this.process = child;
    const reader = new JsonLineReader(
      (value) => this.handleLine(value),
      (line) => this.log('info', line.slice(0, 500)),
    );
    const stderrLines: string[] = [];
    child.stdout?.on('data', (chunk: Buffer) => reader.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (!line.trim() || line.startsWith('Reading additional input from stdin')) continue;
        stderrLines.push(line.trimEnd());
        this.log('info', line.trimEnd());
      }
    });
    child.on('error', (error) => {
      if (this.process !== child) return;
      this.process = null;
      this.finishTurn({
        kind: 'turn_failed',
        turnId: turn.turnId,
        message: `Failed to start Codex: ${error.message}`,
        at: now(),
      });
    });
    child.on('exit', (code, signal) => {
      reader.end();
      // A stale exit from an earlier turn's process must not touch this one.
      if (this.process !== child || this.currentTurn !== turn) return;
      this.process = null;
      this.clearLingerTimer();
      // A completed turn stays completed even when a Stop landed while the
      // process was still flushing its session file.
      if (this.pendingCompletion) {
        this.finishTurn(this.pendingCompletion);
        return;
      }
      if (this.interruptRequested) {
        this.finishTurn({ kind: 'turn_interrupted', turnId: turn.turnId, at: now() });
        return;
      }
      if (code === 0) {
        // A clean exit without `turn.completed` (for example an empty response).
        this.finishTurn({
          kind: 'turn_completed',
          turnId: turn.turnId,
          stopReason: 'end_turn',
          durationMs: null,
          costUsd: null,
          at: now(),
        });
        return;
      }
      const detail = stderrLines.slice(-5).join('\n');
      const reason = signal ? `signal ${signal}` : `exit code ${code}`;
      this.finishTurn({
        kind: 'turn_failed',
        turnId: turn.turnId,
        message: detail ? `Codex exited with ${reason}:\n${detail}` : `Codex exited with ${reason}.`,
        at: now(),
      });
    });
  }

  private finishTurn(event: AgentEvent): void {
    if (!this.currentTurn) return;
    this.currentTurn = null;
    this.pendingCompletion = null;
    this.clearLingerTimer();
    this.emit(event);
    this.pump();
  }

  private clearLingerTimer(): void {
    if (this.lingerTimer) clearTimeout(this.lingerTimer);
    this.lingerTimer = null;
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.emit({ kind: 'runtime_log', turnId: this.currentTurn?.turnId ?? null, level, message, at: now() });
  }

  private handleLine(value: unknown): void {
    const turn = this.currentTurn;
    if (!turn) return;
    const record = asRecord(value);
    const type = asString(record.type);
    switch (type) {
      case 'thread.started': {
        const threadId = asString(record.thread_id);
        if (threadId && threadId !== this.threadId) {
          this.threadId = threadId;
          this.emit({ kind: 'thread_started', providerThreadId: threadId, model: null, at: now() });
        }
        return;
      }
      case 'turn.started':
        return;
      case 'item.started':
      case 'item.updated':
      case 'item.completed':
        this.handleItem(type, asRecord(record.item), turn.turnId);
        return;
      case 'turn.completed': {
        const usage = usageFromTurn(asRecord(record.usage));
        if (usage) this.emit({ kind: 'usage', turnId: turn.turnId, usage, at: now() });
        // The turn is over, but the process still flushes its session file;
        // finishing on exit keeps the next turn from racing it. A process that
        // lingers is asked to stop so the UI never waits on it.
        this.pendingCompletion = {
          kind: 'turn_completed',
          turnId: turn.turnId,
          stopReason: 'end_turn',
          durationMs: null,
          costUsd: null,
          at: now(),
        };
        this.clearLingerTimer();
        this.lingerTimer = setTimeout(() => {
          if (this.process && this.pendingCompletion) killCli(this.process, 'SIGTERM');
        }, 5000);
        return;
      }
      case 'turn.failed': {
        const message = asString(asRecord(record.error).message) ?? 'Codex reported a failed turn.';
        this.finishTurn({ kind: 'turn_failed', turnId: turn.turnId, message, at: now() });
        return;
      }
      case 'error': {
        const message = asString(record.message) ?? 'Codex reported an error.';
        this.log('error', message);
        return;
      }
      default:
        return;
    }
  }

  private handleItem(phase: string, item: Record<string, unknown>, turnId: string): void {
    // Codex numbers items per process (`item_0`, `item_1`, …) and every turn
    // is a new process, so the turn id keeps ids unique across the session.
    const id = `${turnId}:${asString(item.id) ?? `item-${this.startedItems.size}`}`;
    const type = asString(item.type);
    const completed = phase === 'item.completed';
    switch (type) {
      case 'agent_message': {
        if (!completed) return;
        const text = asString(item.text) ?? '';
        if (!text.trim()) return;
        this.emit({ kind: 'assistant_text_completed', turnId, blockId: id, text, at: now() });
        return;
      }
      case 'reasoning': {
        if (!completed) return;
        const text = asString(item.text) ?? '';
        if (!text.trim()) return;
        this.emit({ kind: 'thinking_delta', turnId, blockId: id, text, at: now() });
        this.emit({ kind: 'thinking_completed', turnId, blockId: id, at: now() });
        return;
      }
      case 'command_execution': {
        this.ensureStarted(id, turnId, 'Bash', { command: asString(item.command) ?? '' });
        if (!completed) return;
        const exitCode = asNumber(item.exit_code);
        const output = asString(item.aggregated_output) ?? '';
        const status = asString(item.status);
        this.emit({
          kind: 'tool_call_completed',
          turnId,
          toolCallId: id,
          result: output,
          isError: status === 'failed' || (exitCode !== null && exitCode !== 0),
          at: now(),
        });
        return;
      }
      case 'file_change': {
        // One Claude-shaped call per changed file (`Write` for a new file,
        // `Edit` otherwise, both with `file_path`): the renderer keys the
        // open-Lean-file reload and the activity rows on that shape.
        const changes = Array.isArray(item.changes) ? item.changes.map((change) => asRecord(change)) : [];
        const entries = changes.length > 0 ? changes : [{}];
        entries.forEach((change, index) => {
          const changeId = entries.length === 1 ? id : `${id}:${index}`;
          const kind = asString(change.kind) ?? 'update';
          this.ensureStarted(changeId, turnId, kind === 'add' ? 'Write' : 'Edit', { file_path: asString(change.path) ?? '' });
          if (!completed) return;
          this.emit({
            kind: 'tool_call_completed',
            turnId,
            toolCallId: changeId,
            result: null,
            isError: asString(item.status) === 'failed',
            at: now(),
          });
        });
        return;
      }
      case 'mcp_tool_call': {
        const server = asString(item.server) ?? 'mcp';
        const tool = asString(item.tool) ?? 'tool';
        this.ensureStarted(id, turnId, `mcp__${server}__${tool}`, asRecord(item.arguments));
        if (!completed) return;
        // Codex writes `"error": null` on every successful call.
        const error = item.error === null || item.error === undefined ? null : asRecord(item.error);
        const errorMessage = error ? (asString(error.message) ?? JSON.stringify(error)) : null;
        const isError = asString(item.status) === 'failed' || error !== null;
        this.emit({
          kind: 'tool_call_completed',
          turnId,
          toolCallId: id,
          result: errorMessage ?? mcpResultText(item.result),
          isError,
          at: now(),
        });
        return;
      }
      case 'web_search': {
        this.ensureStarted(id, turnId, 'WebSearch', { query: asString(item.query) ?? '' });
        if (completed) {
          this.emit({ kind: 'tool_call_completed', turnId, toolCallId: id, result: null, isError: false, at: now() });
        }
        return;
      }
      case 'todo_list': {
        const items = Array.isArray(item.items) ? item.items : [];
        this.ensureStarted(id, turnId, 'TodoWrite', { todos: items });
        if (completed) {
          this.emit({ kind: 'tool_call_completed', turnId, toolCallId: id, result: null, isError: false, at: now() });
        }
        return;
      }
      case 'error': {
        const message = asString(item.message) ?? 'Codex reported an error.';
        this.log('error', message);
        return;
      }
      default:
        // A feature the launch does not disable (a native subagent, an app)
        // would surface here; the log makes the invisible activity visible.
        if (type && completed) this.log('warn', `Ignoring unsupported Codex item type "${type}".`);
        return;
    }
  }

  private ensureStarted(id: string, turnId: string, tool: string, input: Record<string, unknown>): void {
    if (this.startedItems.has(id)) return;
    this.startedItems.add(id);
    this.emit({ kind: 'tool_call_started', turnId, toolCallId: id, tool, input, parentToolCallId: null, at: now() });
  }
}

/** A TOML basic string: JSON's escapes are a subset of TOML's. */
function tomlString(value: string): string {
  return JSON.stringify(value);
}

export function wrapDeveloperInstructions(instructions: string): string {
  return `<system_instructions>\n${instructions.trim()}\n</system_instructions>`;
}

/**
 * Where the developer message travels: the `-c developer_instructions`
 * override (a developer-role message on every turn) whenever the command
 * line can carry it, else the first prompt.
 */
export function developerInstructionsChannel(launch: ThreadLaunch, platform: NodeJS.Platform = process.platform): 'config' | 'prompt' | null {
  const instructions = launch.codex?.developerInstructions;
  if (!instructions) return null;
  if (platform !== 'win32') return 'config';
  const baseline = buildCodexArgs({ ...launch, codex: { ...launch.codex, developerInstructions: undefined } }, launch.providerThreadId).join(' ').length;
  return baseline + tomlString(instructions).length + 'developer_instructions='.length + 4 < MAX_COMMAND_LINE_CHARS ? 'config' : 'prompt';
}

export function buildCodexArgs(launch: ThreadLaunch, threadId: string | null, platform: NodeJS.Platform = process.platform): string[] {
  const { config } = launch;
  const args = ['exec'];
  if (threadId) args.push('resume', threadId);
  args.push('--json', '--skip-git-repo-check');
  if (!threadId) {
    // `resume` rejects --color and -C; both are remembered from the first turn.
    args.push('--color', 'never', '-C', launch.repoPath);
  }
  if (config.codex_sandbox === 'danger-full-access') {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  } else {
    // Only the first turn accepts `--sandbox`; the config override is what
    // re-applies the mode a resumed thread would otherwise inherit from its
    // first turn (a sandbox narrowed in Settings must narrow later turns too).
    if (!threadId) args.push('-s', config.codex_sandbox);
    args.push('-c', `sandbox_mode=${tomlString(config.codex_sandbox)}`);
    args.push('-c', 'approval_policy="never"');
  }
  for (const override of CODEX_FEATURE_OVERRIDES) args.push('-c', override);
  if (config.model) args.push('-m', config.model);
  if (config.effort) args.push('-c', `model_reasoning_effort="${config.effort}"`);
  for (const [name, server] of Object.entries(launch.codex?.mcpServers ?? {})) {
    args.push('-c', `mcp_servers.${name}.command=${tomlString(server.command)}`);
    args.push('-c', `mcp_servers.${name}.args=${JSON.stringify(server.args)}`);
    for (const [key, value] of Object.entries(server.env ?? {})) {
      args.push('-c', `mcp_servers.${name}.env.${key}=${tomlString(value)}`);
    }
  }
  if (launch.codex?.developerInstructions && developerInstructionsChannel(launch, platform) === 'config') {
    args.push('-c', `developer_instructions=${tomlString(launch.codex.developerInstructions)}`);
  }
  // `-` reads the prompt from stdin.
  args.push('-');
  return args;
}

/** The text of an MCP result (`content[].text` joined), as the web stores it; other shapes are serialised. */
function mcpResultText(result: unknown): string | null {
  if (result === null || result === undefined) return null;
  const record = asRecord(result);
  if (Array.isArray(record.content)) {
    const parts: string[] = [];
    for (const raw of record.content) {
      const block = asRecord(raw);
      if (asString(block.type) === 'text') {
        const text = asString(block.text);
        if (text) parts.push(text);
      }
    }
    if (parts.length > 0) return parts.join('\n');
  }
  if (typeof result === 'string') return result;
  return JSON.stringify(result);
}

function usageFromTurn(usage: Record<string, unknown>): UsageSnapshot | null {
  if (Object.keys(usage).length === 0) return null;
  const inputTokens = asNumber(usage.input_tokens) ?? 0;
  const cachedInputTokens = asNumber(usage.cached_input_tokens) ?? 0;
  const cacheCreationInputTokens = asNumber(usage.cache_write_input_tokens) ?? 0;
  return {
    // Codex counts cached reads (and cache writes) inside `input_tokens`;
    // the snapshot reports the uncached remainder like Anthropic does.
    inputTokens: Math.max(0, inputTokens - cachedInputTokens - cacheCreationInputTokens),
    outputTokens: asNumber(usage.output_tokens) ?? 0,
    cachedInputTokens,
    cacheCreationInputTokens,
    reasoningOutputTokens: asNumber(usage.reasoning_output_tokens) ?? 0,
    costUsd: null,
    contextWindow: null,
  };
}
