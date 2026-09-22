/**
 * Drives Claude Code as one long-lived `stream-json` process per conversation.
 * Follow-up turns share stdin; result lines delimit turns, while permission
 * control requests are correlated and answered on the same transport.
 */

import { randomUUID } from 'node:crypto';
import type { AgentEvent, PermissionDecision } from '@shared/agent-events';
import { ClaudeEventTranslator } from './events';
import { ClaudePermissionController } from './permissions';
import { ClaudeProcess } from './process';
import { now, type EventSink, type ProviderThread, type ThreadLaunch } from '../types';

export { buildClaudeArgs } from './options';

interface QueuedTurn {
  turnId: string;
  text: string;
  /** The process serving this turn, once its user message was written. */
  process?: ClaudeProcess;
}

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

export class ClaudeCodeThread implements ProviderThread {
  private process: ClaudeProcess | null = null;
  /** Process whose stdout currently owns the protocol translator. */
  private protocolProcess: ClaudeProcess | null = null;
  private sessionId: string | null;
  private currentTurn: QueuedTurn | null = null;
  private readonly queue: QueuedTurn[] = [];
  private readonly permissions: ClaudePermissionController;
  private readonly events: ClaudeEventTranslator;
  private interruptRequested = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private exitedDuringTurn = false;

  constructor(
    private readonly launch: ThreadLaunch,
    private readonly emit: EventSink,
  ) {
    this.sessionId = launch.providerThreadId;
    this.permissions = new ClaudePermissionController(emit, (payload) => this.write(payload));
    this.events = new ClaudeEventTranslator(emit, this.permissions, {
      currentTurnId: () => this.currentTurn?.turnId ?? null,
      onThreadStarted: (sessionId, model) => this.onThreadStarted(sessionId, model),
      finishTurn: (event) => this.finishTurn(event),
      interruptRequested: () => this.interruptRequested,
      log: (level, message) => this.log(level, message),
    });
  }

  get providerThreadId(): string | null {
    return this.sessionId;
  }

  get busy(): boolean {
    return this.currentTurn !== null;
  }

  async send(turnId: string, text: string): Promise<void> {
    if (this.closed) throw new Error('This thread has been closed.');
    this.queue.push({ turnId, text });
    this.pump();
  }

  /** Inject a user message into the running stream-json turn. */
  async steer(text: string): Promise<void> {
    if (this.closed) throw new Error('This thread has been closed.');
    if (!this.currentTurn || !this.process) throw new Error('No turn is running.');
    this.write(userMessage(text));
  }

  async interrupt(): Promise<void> {
    if (!this.currentTurn || !this.process) return;
    this.interruptRequested = true;
    this.write({
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'interrupt' },
    });
  }

  async respondPermission(requestId: string, decision: PermissionDecision): Promise<boolean> {
    return this.permissions.respond(requestId, decision);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.clearIdleTimer();
    this.stopProcess();
  }

  private pump(): void {
    if (this.currentTurn || this.queue.length === 0) return;
    const turn = this.queue.shift()!;
    this.currentTurn = turn;
    this.interruptRequested = false;
    this.clearIdleTimer();
    this.emit({ kind: 'user_message', turnId: turn.turnId, text: turn.text, at: now() });
    this.emit({ kind: 'turn_started', turnId: turn.turnId, at: now() });
    try {
      this.ensureProcess();
    } catch (error) {
      this.failTurn(error instanceof Error ? error.message : String(error));
      return;
    }
    turn.process = this.process ?? undefined;
    this.write(userMessage(turn.text));
  }

  private ensureProcess(): void {
    if (this.process) return;
    const runtime = ClaudeProcess.start(this.launch, this.sessionId, {
      // Once an idle process has been replaced, its trailing stdout belongs
      // to no active turn and must not be translated against the new one.
      onLine: (value, source) => {
        if (this.protocolProcess === source) this.events.handleLine(value);
      },
      onInvalidLine: (line, source) => {
        if (this.protocolProcess === source) this.log('warn', `Unparseable output: ${line.slice(0, 200)}`);
      },
      onStderr: (line) => this.log('info', line),
      onError: (error, source) => this.handleProcessError(source, error),
      onExit: (code, signal, source) => this.handleProcessExit(source, code, signal),
    });
    this.process = runtime;
    this.protocolProcess = runtime;
    this.exitedDuringTurn = false;
    this.events.resetProcess();
  }

  private handleProcessError(runtime: ClaudeProcess, error: Error): void {
    this.log('error', `Failed to start Claude Code: ${error.message}`);
    if (this.process === runtime) this.process = null;
    const turn = this.currentTurn;
    if (turn && (turn.process === runtime || turn.process === undefined)) {
      this.failTurn(`Failed to start Claude Code: ${error.message}`);
    }
  }

  private handleProcessExit(runtime: ClaudeProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.protocolProcess === runtime) this.protocolProcess = null;
    if (this.process === runtime) this.process = null;
    // An idle-stopped process can exit after its replacement starts. Only the
    // process assigned to the active turn may complete or fail that turn.
    const turn = this.currentTurn;
    if (!turn || turn.process !== runtime) return;
    this.exitedDuringTurn = true;
    if (this.closed || this.interruptRequested) {
      this.finishTurn({ kind: 'turn_interrupted', turnId: turn.turnId, at: now() });
      return;
    }
    const reason = signal ? `signal ${signal}` : `exit code ${code}`;
    this.failTurn(`Claude Code exited unexpectedly (${reason}).`);
  }

  private stopProcess(): void {
    const runtime = this.process;
    if (!runtime) return;
    this.process = null;
    runtime.stop();
  }

  private write(payload: unknown): void {
    this.process?.write(payload);
  }

  private scheduleIdleShutdown(): void {
    this.clearIdleTimer();
    // Resume by session id after the warm process is retired.
    this.idleTimer = setTimeout(() => {
      if (!this.currentTurn && this.sessionId) this.stopProcess();
    }, IDLE_TIMEOUT_MS);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private finishTurn(event: AgentEvent): void {
    const turn = this.currentTurn;
    if (!turn) return;
    this.currentTurn = null;
    this.events.resetTurn();
    this.permissions.expire(turn.turnId);
    this.emit(event);
    if (this.queue.length > 0) this.pump();
    else if (!this.exitedDuringTurn) this.scheduleIdleShutdown();
  }

  private failTurn(message: string): void {
    const turn = this.currentTurn;
    if (turn) this.finishTurn({ kind: 'turn_failed', turnId: turn.turnId, message, at: now() });
  }

  private onThreadStarted(sessionId: string, model: string | null): void {
    this.sessionId = sessionId;
    this.emit({ kind: 'thread_started', providerThreadId: sessionId, model, at: now() });
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.emit({ kind: 'runtime_log', turnId: this.currentTurn?.turnId ?? null, level, message, at: now() });
  }
}

function userMessage(text: string): Record<string, unknown> {
  return { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } };
}
