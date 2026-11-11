import { asNumber as number, asRecord as record, asString as string, type EventSink } from '../types';

export interface CodexEventTranslatorHooks {
  currentTurnId: () => string | null;
  rootThreadId: () => string | null;
  subscribeChild: (threadId: string) => void;
  onTurnStarted: (threadId: string, turnId: string) => void;
  onTurnCompleted: (threadId: string, turn: Record<string, unknown>) => void;
}
type Notice = { method: string; params: Record<string, unknown> };
type Spawn = { id: string; item: Record<string, unknown>; children: Set<string>; statuses: Map<string, string>; agent: string; settled: boolean };
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const scope = (...parts: string[]): string => parts.map(encodeURIComponent).join(':');
const terminal = (status: unknown): string | null => {
  if (status === 'completed') return 'completed';
  if (status === 'errored' || status === 'failed' || status === 'notFound') return 'failed';
  if (status === 'interrupted' || status === 'shutdown') return 'stopped';
  return null;
};

/** App-server v2 notifications. Native identities never become the application's turn id.
 * Protocol reference: openai/codex, codex-rs/app-server-protocol/schema/typescript.
 * Root lifecycle belongs to the runtime hooks; child lifecycle belongs to Agent cards.
 */
export class CodexEventTranslator {
  private readonly started = new Set<string>();
  private readonly completed = new Set<string>();
  private readonly childTools = new Map<string, string>();
  private readonly streamedReasoning = new Set<string>();
  private readonly retiredTurns = new Set<string>();
  private readonly nativeTurns = new Map<string, string>();
  private readonly seenTurns = new Map<string, Set<string>>();
  private readonly children = new Map<string, Spawn>();
  private readonly metadata = new Map<string, Record<string, unknown>>();
  private readonly pending = new Map<string, Notice[]>();
  private readonly subscribed = new Set<string>();
  private readonly spawns = new Map<string, Spawn>();
  private rootFinished = false;
  private localTurn: string | null = null;

  constructor(private readonly emit: EventSink, private readonly hooks: CodexEventTranslatorHooks) {}

  /** Called before assigning a new local turn. Also settles abandoned child cards. */
  resetTurn(): void {
    this.stopChildren();
    for (const [thread, turns] of this.seenTurns) for (const turn of turns) this.retiredTurns.add(scope(thread, turn));
    this.started.clear(); this.completed.clear(); this.streamedReasoning.clear(); this.childTools.clear();
    this.nativeTurns.clear(); this.children.clear();
    this.pending.clear(); this.subscribed.clear(); this.spawns.clear();
    this.rootFinished = false; this.localTurn = null;
  }

  /** Replay an attached child's snapshot, retaining native item identities for live dedup. */
  hydrateChild(threadId: string, thread: Record<string, unknown>): void {
    if (threadId === this.hooks.rootThreadId() || this.rootFinished) return;
    this.observeThread({ ...thread, id: threadId });
    // A resume snapshot includes history. Only the newest native turn can belong
    // to the current run; replaying older turns would prematurely settle its card.
    for (const raw of list(thread.turns).slice(-1)) {
      const turn = record(raw), turnId = string(turn.id);
      if (!turnId) continue;
      this.handle('turn/started', { threadId, turn: { id: turnId } });
      for (const itemRaw of list(turn.items)) {
        const item = record(itemRaw);
        // Completed turns are authoritative; active tool items carry their own status.
        const done = terminal(turn.status) !== null || item.completedAtMs != null || terminal(item.status) !== null;
        this.handle(done ? 'item/completed' : 'item/started', { threadId, turnId, item });
      }
      if (terminal(turn.status)) this.handle('turn/completed', { threadId, turn });
    }
  }

  handle(method: string, value: unknown): void {
    const params = record(value);
    if (method === 'thread/started') { this.observeThread(record(params.thread)); return; }
    const thread = string(params.threadId), local = this.hooks.currentTurnId();
    if (!thread || !local || this.rootFinished) return;
    this.localTurn ??= local;
    const turn = string(params.turnId) ?? string(record(params.turn).id);
    if (turn && this.retiredTurns.has(scope(thread, turn))) return;
    if (thread !== this.hooks.rootThreadId() && !this.children.has(thread)) {
      // Subscription notifications may beat both thread/started and spawn completion.
      if (this.isSupported(method)) {
        const queue = this.pending.get(thread) ?? [];
        queue.push({ method, params }); this.pending.set(thread, queue);
      }
      return;
    }
    if (turn) {
      this.nativeTurns.set(thread, turn);
      const seen = this.seenTurns.get(thread) ?? new Set<string>();
      seen.add(turn); this.seenTurns.set(thread, seen);
    }
    const nativeTurn = turn ?? this.nativeTurns.get(thread);
    if (!nativeTurn) return;
    const parent = this.children.get(thread);
    if (method === 'turn/started') {
      this.hooks.onTurnStarted(thread, nativeTurn);
      return;
    }
    if (method === 'turn/completed') {
      const data = record(params.turn), key = scope(thread, nativeTurn, 'turn-end');
      if (this.completed.has(key)) return;
      this.completed.add(key);
      if (parent) {
        this.childStatus(thread, terminal(data.status) ?? 'failed', string(record(data.error).message));
        this.hooks.onTurnCompleted(thread, data);
      } else {
        this.stopChildren(); this.rootFinished = true;
        this.hooks.onTurnCompleted(thread, data);
      }
      return;
    }
    if (method === 'thread/tokenUsage/updated') {
      if (!parent) this.usage(params);
      return;
    }
    if (method === 'error') {
      this.emit({ kind: 'runtime_log', turnId: local, level: 'error', message: string(record(params.error).message) ?? 'Codex reported an error.', at: Date.now() });
      return;
    }
    if (method === 'turn/plan/updated') {
      const id = scope(thread, nativeTurn, 'plan', JSON.stringify(params.plan));
      this.start(id, 'TodoWrite', { todos: list(params.plan).map(raw => {
        const step = record(raw); return { content: step.step, status: step.status === 'inProgress' ? 'in_progress' : step.status };
      }) }, parent);
      this.finish(id, null, false); return;
    }
    if (method === 'item/started' || method === 'item/completed') {
      this.item(thread, nativeTurn, record(params.item), method === 'item/completed', parent); return;
    }
    if (method === 'item/agentMessage/delta' || method === 'item/plan/delta') {
      const itemId = string(params.itemId), text = string(params.delta);
      if (!itemId || !text) return;
      const id = scope(thread, nativeTurn, itemId);
      if (this.completed.has(id)) return;
      if (parent) this.emit({ kind: 'subagent_text_delta', turnId: local, parentToolCallId: parent.id, text, deltaKind: 'text', at: Date.now() });
      else this.emit({ kind: 'assistant_text_delta', turnId: local, blockId: id, text, at: Date.now() });
      return;
    }
    if (method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta') {
      const itemId = string(params.itemId), text = string(params.delta);
      if (!itemId || !text) return;
      const id = scope(thread, nativeTurn, itemId);
      if (this.completed.has(id)) return;
      this.streamedReasoning.add(id);
      if (parent) this.emit({ kind: 'subagent_text_delta', turnId: local, parentToolCallId: parent.id, text, deltaKind: 'thinking', at: Date.now() });
      else this.emit({ kind: 'thinking_delta', turnId: local, blockId: id, text, at: Date.now() });
    }
  }

  private isSupported(method: string): boolean {
    return ['turn/started', 'turn/completed', 'item/started', 'item/completed', 'item/agentMessage/delta',
      'item/reasoning/summaryTextDelta', 'item/reasoning/textDelta', 'item/plan/delta', 'turn/plan/updated', 'error', 'thread/tokenUsage/updated'].includes(method);
  }

  private observeThread(thread: Record<string, unknown>): void {
    const id = string(thread.id);
    if (!id || id === this.hooks.rootThreadId() || this.rootFinished) return;
    const source = record(record(thread.source).subAgent);
    // Current protocol uses thread_spawn; older app-server versions use spawn.
    const spawn = record(source.thread_spawn ?? source.spawn);
    const parent = string(thread.parentThreadId) ?? string(spawn.parent_thread_id) ?? string(spawn.parentThreadId);
    if (parent !== this.hooks.rootThreadId()) return; // exactly one native level
    this.metadata.set(id, { ...this.metadata.get(id), ...spawn, ...thread });
    this.subscribe(id);
  }

  private subscribe(thread: string): void {
    if (this.subscribed.has(thread)) return;
    this.subscribed.add(thread); this.hooks.subscribeChild(thread);
  }

  private associate(thread: string, spawn: Spawn): void {
    if (this.children.has(thread) || spawn.settled) return;
    this.children.set(thread, spawn); spawn.children.add(thread);
    this.ensureAgent(spawn, thread);
    this.subscribe(thread);
    const pending = this.pending.get(thread) ?? [];
    this.pending.delete(thread);
    for (const notice of pending) this.handle(notice.method, notice.params);
  }

  private ensureAgent(spawn: Spawn, thread?: string): void {
    const meta = this.metadata.get(thread ?? '') ?? {};
    const role = string(meta.agentRole) ?? string(meta.agent_role) ?? 'default';
    if (!this.started.has(spawn.id)) spawn.agent = role.startsWith('fuse:') ? role : `fuse:${role}`;
    this.start(spawn.id, 'Agent', {
      subagent_type: spawn.agent,
      description: string(meta.agentNickname) ?? string(meta.agent_nickname) ?? string(spawn.item.prompt)?.slice(0, 120) ?? 'Codex subagent',
      prompt: string(spawn.item.prompt) ?? '',
    });
    if (!this.started.has(`${spawn.id}:running`)) {
      this.started.add(`${spawn.id}:running`); this.status(spawn, 'running');
    }
  }

  private item(thread: string, turn: string, item: Record<string, unknown>, done: boolean, parent?: Spawn): void {
    const itemId = string(item.id), type = string(item.type);
    if (!itemId || !type) return;
    const id = scope(thread, turn, itemId), local = this.localTurn!;
    if (type === 'collabAgentToolCall') { if (!parent) this.collab(id, item, done); return; }
    if (type === 'agentMessage' || type === 'reasoning' || type === 'plan') {
      if (type === 'agentMessage' && !parent && !this.started.has(id)) {
        this.started.add(id);
        this.emit({ kind: 'assistant_message_started', turnId: local, at: Date.now() });
      }
      if (!done || this.completed.has(id)) return;
      this.completed.add(id);
      if (type === 'reasoning') {
        const text = list(item.summary).concat(list(item.content)).filter(x => typeof x === 'string').join('\n');
        if (text && !this.streamedReasoning.has(id)) {
          if (parent) this.emit({ kind: 'subagent_text_delta', turnId: local, parentToolCallId: parent.id, text, deltaKind: 'thinking', at: Date.now() });
          else this.emit({ kind: 'thinking_delta', turnId: local, blockId: id, text, at: Date.now() });
        }
        if (!parent) this.emit({ kind: 'thinking_completed', turnId: local, blockId: id, at: Date.now() });
      } else {
        const text = string(item.text);
        if (text) this.emit(parent
          ? { kind: 'subagent_text_completed', turnId: local, parentToolCallId: parent.id, messageId: id, text, at: Date.now() }
          : { kind: 'assistant_text_completed', turnId: local, blockId: id, text, at: Date.now() });
      }
      return;
    }
    const isError = item.status === 'failed' || item.status === 'declined';
    if (type === 'commandExecution') {
      this.start(id, 'Bash', { command: string(item.command) ?? '', cwd: string(item.cwd) }, parent);
      if (done) this.finish(id, string(item.aggregatedOutput), isError || (number(item.exitCode) ?? 0) !== 0);
    } else if (type === 'fileChange') {
      list(item.changes).forEach((raw, index) => {
        const change = record(raw), key = `${id}:file:${index}`;
        this.start(key, record(change.kind).type === 'add' ? 'Write' : 'Edit', { file_path: string(change.path) ?? '', diff: string(change.diff) ?? '' }, parent);
        if (done) this.finish(key, null, isError);
      });
    } else if (type === 'mcpToolCall') {
      this.start(id, `mcp__${string(item.server) ?? 'mcp'}__${string(item.tool) ?? 'tool'}`, record(item.arguments), parent);
      if (done) this.finish(id, string(record(item.error).message) ?? this.result(item.result), isError || item.error != null);
    } else if (type === 'webSearch') {
      this.start(id, 'WebSearch', { query: string(item.query) ?? '', action: item.action }, parent);
      if (done) this.finish(id, this.result(item.action), false);
    }
  }

  private collab(id: string, item: Record<string, unknown>, done: boolean): void {
    const tool = string(item.tool);
    if (tool === 'spawnAgent') {
      let spawn = this.spawns.get(id);
      if (!spawn) {
        spawn = { id, item, children: new Set(), statuses: new Map(), agent: 'fuse:default', settled: false };
        this.spawns.set(id, spawn);
      }
      spawn.item = { ...spawn.item, ...item };
      // Associate every receiver before replaying buffered terminal events.
      const receivers = [...new Set(list(item.receiverThreadIds).filter((x): x is string => typeof x === 'string'))];
      for (const child of receivers) spawn.children.add(child);
      for (const child of receivers) this.associate(child, spawn);
      if (done && item.status === 'failed') { this.ensureAgent(spawn); this.settle(spawn, 'failed', this.result(item.agentsStates)); return; }
      // Spawn completion means launch success, never completion of the child's work.
      if (done) this.ensureAgent(spawn, receivers[0]);
    } else if (['sendInput', 'wait', 'closeAgent', 'resumeAgent'].includes(tool ?? '')) {
      if (tool === 'sendInput' && item.status !== 'failed') {
        for (const receiver of list(item.receiverThreadIds)) {
          if (typeof receiver !== 'string') continue;
          const previous = this.children.get(receiver);
          if (previous && !previous.settled) continue;
          const runId = `${id}:agent:${encodeURIComponent(receiver)}`;
          if (this.spawns.has(runId)) continue;
          const run: Spawn = { id: runId, item, children: new Set(), statuses: new Map(), agent: previous?.agent ?? 'fuse:default', settled: false };
          // Every previously observed native turn belongs to the previous run.
          // This also excludes old snapshot turns when reattaching the persistent thread.
          for (const turn of this.seenTurns.get(receiver) ?? []) this.retiredTurns.add(scope(receiver, turn));
          this.nativeTurns.delete(receiver);
          this.subscribed.delete(receiver);
          this.spawns.set(run.id, run); this.children.delete(receiver); this.associate(receiver, run);
        }
      }
      this.start(id, `codex_${tool}`, { receiverThreadIds: item.receiverThreadIds, prompt: item.prompt });
      if (done) this.finish(id, this.result(item.agentsStates), item.status === 'failed');
    } else return;
    for (const [thread, raw] of Object.entries(record(item.agentsStates))) {
      const state = record(raw), status = terminal(state.status);
      if (status) this.childStatus(thread, status, string(state.message));
    }
    if (tool === 'closeAgent' && done && item.status !== 'failed') {
      for (const child of list(item.receiverThreadIds)) if (typeof child === 'string') this.childStatus(child, 'stopped', null);
    }
  }

  private childStatus(thread: string, status: string, message: string | null): void {
    const spawn = this.children.get(thread);
    if (!spawn || spawn.settled || spawn.statuses.has(thread)) return;
    spawn.statuses.set(thread, status);
    if ([...spawn.children].every(id => spawn.statuses.has(id))) {
      const states = [...spawn.statuses.values()];
      this.settle(spawn, states.includes('failed') ? 'failed' : states.includes('stopped') ? 'stopped' : 'completed', message);
    }
  }

  private settle(spawn: Spawn, status: string, message: string | null): void {
    if (spawn.settled) return;
    this.ensureAgent(spawn); spawn.settled = true;
    // Remove SessionToolEvents' live child before tool_result can infer completed.
    this.status(spawn, status);
    for (const [id, parent] of this.childTools) if (parent === spawn.id) this.finish(id, message, status !== 'completed');
    this.finish(spawn.id, message, status === 'failed');
  }
  private stopChildren(): void {
    for (const spawn of this.spawns.values()) if (!spawn.settled) this.settle(spawn, 'stopped', null);
  }
  private status(spawn: Spawn, status: string): void {
    if (this.localTurn) this.emit({ kind: 'agent_status', turnId: this.localTurn, toolCallId: spawn.id, agent: spawn.agent, status, at: Date.now() });
  }
  private start(id: string, tool: string, input: Record<string, unknown>, parent?: Spawn): void {
    if (this.started.has(id)) return;
    this.started.add(id);
    if (parent) this.childTools.set(id, parent.id);
    this.emit({ kind: 'tool_call_started', turnId: this.localTurn!, toolCallId: id, tool, input, parentToolCallId: parent?.id ?? null, at: Date.now() });
  }
  private finish(id: string, result: string | null, isError: boolean): void {
    if (this.completed.has(id)) return;
    this.completed.add(id);
    this.emit({ kind: 'tool_call_completed', turnId: this.localTurn!, toolCallId: id, result, isError, at: Date.now() });
  }
  private result(value: unknown): string | null {
    if (value == null) return null;
    const text = list(record(value).content).map(record).filter(x => x.type === 'text').map(x => string(x.text)).filter(Boolean);
    return text.length ? text.join('\n') : typeof value === 'string' ? value : JSON.stringify(value);
  }
  private usage(params: Record<string, unknown>): void {
    const usage = record(params.tokenUsage), last = record(usage.last);
    if (!Object.keys(last).length) return;
    const cached = number(last.cachedInputTokens) ?? 0;
    this.emit({ kind: 'usage', turnId: this.localTurn!, usage: {
      inputTokens: Math.max(0, (number(last.inputTokens) ?? 0) - cached), cachedInputTokens: cached,
      outputTokens: number(last.outputTokens) ?? 0, reasoningOutputTokens: number(last.reasoningOutputTokens) ?? 0,
      cacheCreationInputTokens: 0, contextWindow: number(usage.modelContextWindow), costUsd: null,
    }, at: Date.now() });
  }
}
