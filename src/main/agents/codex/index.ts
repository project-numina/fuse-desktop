import type { AgentEvent, PermissionDecision } from '@shared/agent-events';
import { asRecord, asString, now, type EventSink, type ProviderThread, type ThreadLaunch } from '../types';
import { CodexTransport } from './transport';
import { buildCodexArgs, buildCodexTurnText, threadOptions } from './options';
import { CodexEventTranslator } from './events';

export { buildCodexArgs, CODEX_FEATURE_OVERRIDES } from './options';

interface QueuedTurn { turnId: string; text: string }

/** A persistent app-server connection owns the parent and its native child threads. */
export class CodexThread implements ProviderThread {
  private transport: CodexTransport | null = null;
  private ready: Promise<void> | null = null;
  private threadId: string | null;
  private nativeTurnId: string | null = null;
  private current: QueuedTurn | null = null;
  private readonly queue: QueuedTurn[] = [];
  private readonly childTurns = new Map<string, string>();
  private readonly attached = new Set<string>();
  private readonly attaching = new Map<string, Promise<void>>();
  private readonly events: CodexEventTranslator;
  private closed = false;
  private interrupted = false;

  constructor(private readonly launch: ThreadLaunch, private readonly emit: EventSink) {
    this.threadId = launch.providerThreadId;
    this.events = new CodexEventTranslator(emit, {
      currentTurnId: () => this.current?.turnId ?? null,
      rootThreadId: () => this.threadId,
      subscribeChild: (id) => {
        if (this.attaching.has(id)) return;
        const pending = this.attachChild(id);
        this.attaching.set(id, pending);
        void pending.finally(() => this.attaching.delete(id));
      },
      onTurnStarted: (id, turnId) => {
        if (id === this.threadId) {
          if (!this.current || (this.nativeTurnId && this.nativeTurnId !== turnId)) return;
          this.nativeTurnId = turnId;
          if (this.interrupted) void this.interrupt().catch((error) => this.log(String(error)));
        } else this.childTurns.set(id, turnId);
      },
      onTurnCompleted: (id, turn) => this.completed(id, turn),
    });
  }

  get providerThreadId(): string | null { return this.threadId; }
  get busy(): boolean { return this.current !== null; }

  async send(turnId: string, text: string): Promise<void> {
    if (this.closed) throw new Error('This thread has been closed.');
    this.queue.push({ turnId, text });
    void this.pump();
  }

  async steer(text: string): Promise<void> {
    if (!this.current || !this.nativeTurnId || !this.transport) throw new Error('No Codex turn is running.');
    await this.transport.request('turn/steer', {
      threadId: this.threadId, expectedTurnId: this.nativeTurnId,
      input: [{ type: 'text', text, text_elements: [] }],
    });
  }

  async interrupt(): Promise<void> {
    if (!this.current) return;
    this.interrupted = true;
    await Promise.all([
      this.stopChildren(),
      this.nativeTurnId && this.transport
        ? this.transport.request('turn/interrupt', { threadId: this.threadId, turnId: this.nativeTurnId })
        : Promise.resolve(),
    ]);
  }

  async respondPermission(_requestId: string, _decision: PermissionDecision): Promise<boolean> { return false; }

  async close(): Promise<void> {
    this.closed = true;
    this.queue.length = 0;
    this.transport?.close();
    this.transport = null;
    if (this.current) this.finish({ kind: 'turn_interrupted', turnId: this.current.turnId, at: now() });
  }

  private async pump(): Promise<void> {
    if (this.current || this.closed || !this.queue.length) return;
    const turn = this.queue.shift()!;
    this.current = turn;
    this.interrupted = false;
    this.events.resetTurn();
    this.emit({ kind: 'user_message', turnId: turn.turnId, text: turn.text, at: now() });
    this.emit({ kind: 'turn_started', turnId: turn.turnId, at: now() });
    try {
      await this.ensureReady();
      if (this.current !== turn || this.closed) return;
      if (this.interrupted) {
        this.finish({ kind: 'turn_interrupted', turnId: turn.turnId, at: now() });
        return;
      }
      const response = await this.transport!.request('turn/start', {
        threadId: this.threadId,
        input: [{ type: 'text', text: buildCodexTurnText(this.launch, turn.text), text_elements: [] }],
        ...(this.launch.config.effort ? { effort: this.launch.config.effort } : {}),
      });
      if (this.current === turn) {
        this.nativeTurnId = asString(asRecord(response.turn).id);
        if (this.interrupted) await this.interrupt();
      }
    } catch (error) {
      if (this.current === turn) {
        this.transport?.close();
        this.transport = null;
        this.ready = null;
        this.attached.clear();
        this.fail(String(error));
      }
    }
  }

  private ensureReady(): Promise<void> {
    if (!this.ready) this.ready = this.initialize();
    return this.ready;
  }

  private async initialize(): Promise<void> {
    const transport = new CodexTransport(this.launch, buildCodexArgs(), {
      notification: (method, params) => {
        if (this.transport === transport && !this.closed) this.events.handle(method, params);
      },
      request: (id, method) => {
        // The selected Codex sandbox runs with approvalPolicy=never, including children.
        transport.reject(id, `Fuse does not support ${method} under the selected Codex approval policy.`);
      },
      log: (message) => this.log(message),
      exit: (message) => {
        if (this.transport !== transport) return;
        this.transport = null;
        this.ready = null;
        this.attached.clear();
        this.fail(message);
      },
    });
    this.transport = transport;
    await transport.request('initialize', {
      clientInfo: { name: 'fuse_desktop', title: 'Fuse Desktop', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    });
    transport.notify('initialized');
    const response = await transport.request(this.threadId ? 'thread/resume' : 'thread/start', {
      ...threadOptions(this.launch),
      ...(this.threadId ? { threadId: this.threadId } : {}),
    });
    const threadId = asString(asRecord(response.thread).id);
    if (!threadId) throw new Error('Codex did not return a thread ID.');
    const resumedTurns = asRecord(response.thread).turns;
    if (Array.isArray(resumedTurns) && resumedTurns.some((turn) => asRecord(turn).status === 'inProgress')) {
      throw new Error('This Codex thread already has an active turn. Stop it before resuming in Fuse.');
    }
    this.threadId = threadId;
    this.emit({ kind: 'thread_started', providerThreadId: threadId, model: asString(response.model), at: now() });
  }

  private async attachChild(threadId: string): Promise<void> {
    if (this.attached.has(threadId) || !this.transport) return;
    this.attached.add(threadId);
    const transport = this.transport;
    const current = this.current;
    try {
      const response = await transport.request('thread/resume', { threadId });
      if (this.transport === transport && this.current === current && !this.closed) {
        const thread = asRecord(response.thread);
        for (const raw of Array.isArray(thread.turns) ? thread.turns : []) {
          const turn = asRecord(raw);
          const id = asString(turn.id);
          if (id && turn.status === 'inProgress') this.childTurns.set(threadId, id);
        }
        this.events.hydrateChild(threadId, thread);
      }
    } catch (error) {
      this.emit({ kind: 'runtime_log', turnId: current?.turnId ?? null, level: 'error',
        message: `Could not attach Codex child ${threadId}: ${String(error)}. Update Codex CLI and Fuse to compatible versions; child activity may be incomplete.`, at: now() });
    } finally {
      this.attached.delete(threadId);
    }
  }

  private completed(threadId: string, turn: Record<string, unknown>): void {
    if (threadId !== this.threadId) { this.childTurns.delete(threadId); return; }
    const current = this.current;
    if (!current || !this.nativeTurnId || asString(turn.id) !== this.nativeTurnId) return;
    void this.stopChildren().finally(() => {
      if (this.current !== current) return;
      const status = asString(turn.status);
      if (status === 'interrupted' || this.interrupted) this.finish({ kind: 'turn_interrupted', turnId: current.turnId, at: now() });
      else if (status === 'failed') this.fail(asString(asRecord(turn.error).message) ?? 'Codex turn failed.');
      else this.finish({ kind: 'turn_completed', turnId: current.turnId, stopReason: 'end_turn', durationMs: null, costUsd: null, at: now() });
    });
  }

  private async stopChildren(): Promise<void> {
    await Promise.all([...this.attaching.values()]);
    const transport = this.transport;
    if (!transport) return;
    await Promise.all([...this.childTurns].map(async ([threadId, turnId]) => {
      try { await transport.request('turn/interrupt', { threadId, turnId }); }
      catch (error) { this.log(`Could not interrupt Codex child: ${String(error)}`); }
    }));
    this.childTurns.clear();
  }

  private finish(event: AgentEvent): void {
    if (!this.current) return;
    this.current = null;
    this.nativeTurnId = null;
    this.emit(event);
    void this.pump();
  }

  private fail(message: string): void {
    if (this.current) {
      const detail = `${message}\nIf Codex app-server cannot start or its protocol is incompatible, update Codex CLI and Fuse to compatible versions. No exec fallback was attempted.`;
      this.emit({ kind: 'runtime_log', turnId: this.current.turnId, level: 'error', message: detail, at: now() });
      this.finish({ kind: 'turn_failed', turnId: this.current.turnId, message: detail, at: now() });
    }
  }

  private log(message: string): void {
    this.emit({ kind: 'runtime_log', turnId: this.current?.turnId ?? null, level: 'info', message, at: now() });
  }
}
