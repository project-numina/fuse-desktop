/**
 * Shared fixtures for the session tests: a fake open project, an in-memory
 * transcript writer, and a scripted provider thread that records what the
 * runner sends and lets a test push `AgentEvent`s as if the CLI had
 * produced them.
 */

import type { AgentEvent, PermissionDecision } from '@shared/agent-events';
import type { MessageDeliveryState } from '@shared/api-types';
import type { EventSink, ProviderThread, ThreadLaunch } from '@main/agents/types';
import { DEFAULT_AGENT_CONFIG, type BlueprintRow, type RepositoryRow, type TranscriptRow } from '@main/store/rows';
import { roomKeyFor, type OpenProject } from '@main/services/types';
import type { TranscriptWriter } from '@main/services/sessions/session';

export function fakeRepository(path = '/repo'): RepositoryRow {
  return { id: 1, owner: 'owner', name: 'repo', path, description: null, created_at: '2026-01-01T00:00:00.000Z', last_activity_at: null };
}

export function fakeBlueprint(overrides: Partial<BlueprintRow> = {}): BlueprintRow {
  return {
    id: 'sample',
    repository_id: 1,
    title: 'Sample',
    description: '',
    area: '',
    blueprint_file: 'blueprint/src/content.tex',
    project_subdir: '',
    source_type: 'none',
    source_id: null,
    pr_mode: 'off',
    auto_commit: false,
    orchestrator_child_concurrency: 1,
    agent: { ...DEFAULT_AGENT_CONFIG },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function fakeProject(repositoryPath = '/repo', blueprint: Partial<BlueprintRow> = {}): OpenProject {
  const repository = fakeRepository(repositoryPath);
  const row = fakeBlueprint(blueprint);
  return {
    repository,
    blueprint: row,
    clonePath: repository.path,
    projectSubdir: row.project_subdir,
    projectRoot: repository.path,
    blueprintFile: row.blueprint_file,
    roomKey: roomKeyFor(repository, row.id),
  };
}

export class MemoryTranscript implements TranscriptWriter {
  readonly rows: TranscriptRow[] = [];
  lastPersistedEventId = 0;
  readonly deliveryUpdates: Array<{ messageId: string; state: MessageDeliveryState; preserveDeliveredAt: boolean }> = [];

  appendRow(row: TranscriptRow, boundaryEventId: number | null): void {
    this.rows.push(row);
    if (boundaryEventId !== null) this.lastPersistedEventId = Math.max(this.lastPersistedEventId, boundaryEventId);
  }

  setDeliveryState(messageId: string, state: MessageDeliveryState, options: { preserveDeliveredAt?: boolean } = {}): void {
    this.deliveryUpdates.push({ messageId, state, preserveDeliveredAt: options.preserveDeliveredAt === true });
    const row = this.rows.find((entry) => entry.id === messageId);
    if (row) {
      row.delivery_state = state;
      if (!options.preserveDeliveredAt) row.delivered_at = state === 'delivered' || state === 'steered' || state === 'retained' ? new Date().toISOString() : null;
    }
  }

  advanceBoundary(eventId: number): void {
    this.lastPersistedEventId = Math.max(this.lastPersistedEventId, eventId);
  }
}

/** A provider thread driven by the test instead of a CLI. */
export class ScriptedThread implements ProviderThread {
  readonly sends: Array<{ turnId: string; text: string }> = [];
  readonly steers: string[] = [];
  readonly permissionResponses: Array<{ requestId: string; decision: PermissionDecision }> = [];
  interrupts = 0;
  closed = false;
  providerThreadId: string | null;
  private currentTurnId: string | null = null;
  /** When false the thread has no `steer` (Codex); set before the runner captures it. */
  static steerable = true;

  constructor(
    readonly launch: ThreadLaunch,
    private readonly sink: EventSink,
  ) {
    this.providerThreadId = launch.providerThreadId;
    if (!ScriptedThread.steerable) (this as { steer?: unknown }).steer = undefined;
  }

  get busy(): boolean {
    return this.currentTurnId !== null;
  }

  get turnId(): string {
    if (!this.currentTurnId) throw new Error('no turn running');
    return this.currentTurnId;
  }

  async send(turnId: string, text: string): Promise<void> {
    this.sends.push({ turnId, text });
    this.currentTurnId = turnId;
    this.push({ kind: 'user_message', turnId, text, at: Date.now() });
    this.push({ kind: 'turn_started', turnId, at: Date.now() });
  }

  async steer(text: string): Promise<void> {
    if (!this.currentTurnId) throw new Error('No turn is running.');
    this.steers.push(text);
  }

  async interrupt(): Promise<void> {
    this.interrupts += 1;
  }

  /** Request ids a test announced with `permission_request`; answering an unknown one reports false. */
  readonly pendingPermissionIds = new Set<string>();

  async respondPermission(requestId: string, decision: PermissionDecision): Promise<boolean> {
    if (!this.pendingPermissionIds.delete(requestId)) return false;
    this.permissionResponses.push({ requestId, decision });
    if (this.currentTurnId) this.push({ kind: 'permission_resolved', turnId: this.currentTurnId, requestId, behavior: decision.behavior, at: Date.now() });
    return true;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  /** Feed one event to the runner as the CLI would. */
  push(event: AgentEvent): void {
    if (event.kind === 'turn_completed' || event.kind === 'turn_failed' || event.kind === 'turn_interrupted') this.currentTurnId = null;
    if (event.kind === 'thread_started') this.providerThreadId = event.providerThreadId;
    if (event.kind === 'permission_request') this.pendingPermissionIds.add(event.requestId);
    this.sink(event);
  }

  /** Announce the provider thread id (Claude `system.init`). */
  start(providerThreadId = 'provider-1', model: string | null = 'claude-opus-5'): void {
    this.push({ kind: 'thread_started', providerThreadId, model, at: Date.now() });
  }

  text(text: string, blockId = `block-${this.sends.length}`): void {
    const turnId = this.turnId;
    this.push({ kind: 'assistant_message_started', turnId, at: Date.now() });
    this.push({ kind: 'assistant_text_delta', turnId, blockId, text, at: Date.now() });
    this.push({ kind: 'assistant_text_completed', turnId, blockId, text, at: Date.now() });
  }

  toolCall(toolCallId: string, tool: string, input: Record<string, unknown>, parentToolCallId: string | null = null): void {
    this.push({ kind: 'tool_call_started', turnId: this.turnId, toolCallId, tool, input, parentToolCallId, at: Date.now() });
  }

  toolResult(toolCallId: string, result: string | null = 'ok', isError = false): void {
    this.push({ kind: 'tool_call_completed', turnId: this.turnId, toolCallId, result, isError, at: Date.now() });
  }

  complete(costUsd: number | null = 0.01): void {
    this.push({ kind: 'turn_completed', turnId: this.turnId, stopReason: 'end_turn', durationMs: 1200, costUsd, at: Date.now() });
  }

  interrupted(): void {
    this.push({ kind: 'turn_interrupted', turnId: this.turnId, at: Date.now() });
  }

  fail(message = 'Claude Code exited unexpectedly (exit code 1).'): void {
    this.push({ kind: 'turn_failed', turnId: this.turnId, message, at: Date.now() });
  }
}

export async function flushAsync(rounds = 4): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Poll until `predicate` holds (the runner's post-turn work awaits file writes). */
export async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
