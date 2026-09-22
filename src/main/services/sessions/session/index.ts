/**
 * One live session: the in-memory model the web keeps per run
 * (`services/agent/session_model.py::Session`) plus the event consumer that
 * turns provider-neutral `AgentEvent`s into the session SSE protocol and the
 * persisted transcript (`runtime/consumer.py`, `runner/steering.py`,
 * `persistence.py::_finalize_undelivered_messages`, `session.py::end_session`).
 *
 * Everything here is transport-free: events come in through `consume()`,
 * SSE frames go out through the room, rows go out through the transcript
 * writer, and the service that owns the provider thread hears about turn
 * boundaries through hooks. That keeps the mapping table testable with a
 * scripted event list and no CLI.
 */

import { randomUUID } from 'node:crypto';
import type { AgentEvent } from '@shared/agent-events';
import type {
  BuildStatus,
  LiveSessionCapabilities,
  MessageDeliveryState,
  SessionChatMessage,
  SessionStatus,
} from '@shared/api-types';
import type { SseRoom } from '../../../server/sse';
import type { OpenProject } from '../../types';
import type { AttachmentPromptContext } from '../attachments';
import { isTerminalStatus, sessionLiveState } from '../live-state';
import { SessionMessageDelivery } from './delivery';
import { claudeApiErrorMessage } from './event-state';
import { SessionToolEvents } from './tool-events';
import { SessionTranscript } from './transcript';
import type {
  LocalSessionInit,
  QueuedUserMessage,
  SessionHooks,
  SteerTarget,
  TurnEndEvent,
  TurnRecord,
} from './types';
import { summarizeToolInput } from '../tool-summaries';
import { assistantTurnId } from '../turn-id';

export { touchesLeanFile, TurnLivenessTracker } from './event-state';
export type {
  LocalSessionInit,
  QueuedUserMessage,
  SessionHooks,
  SteerTarget,
  TranscriptWriter,
  TurnEndEvent,
  TurnKind,
  TurnRecord,
} from './types';

/** The web caps queued follow-ups; the composer refuses more with a 429. */
export const MAX_PENDING_USER_MESSAGES = 8;

export class LocalSession {
  readonly sessionId: string;
  readonly conversationId: string;
  readonly agentJobId: string;
  readonly project: OpenProject;
  readonly room: SseRoom;
  readonly createdAt: string;

  status: SessionStatus = 'starting';
  turnActive = false;
  userStopRequested = false;
  messageAdmissionClosed = false;
  /** In-memory transcript (user/agent rows in delivery order): the turn-id walk. */
  readonly messages: SessionChatMessage[];
  /** Follow-ups waiting for the next turn, in send order. */
  readonly queue: QueuedUserMessage[];
  /** Follow-ups held for the running turn's next live write point. */
  readonly pendingSteers: QueuedUserMessage[];
  /** Steers written to the provider, not yet confirmed by a model call. */
  readonly unconfirmedSteers: QueuedUserMessage[];
  /** Every follow-up accepted by this session and its current state. */
  readonly acceptedStates: Map<string, MessageDeliveryState>;
  /** Retained rows from the previous run, consumed when the first turn starts. */
  readonly retainedMessageIds: string[];
  /** Spawn tool call id → agent type, for children with no terminal status yet. */
  readonly liveChildAgents: Map<string, string>;
  /** Permission prompts published and not yet answered (the CLI is blocked on the user). */
  readonly pendingPermissionIds = new Set<string>();
  /**
   * The replay boundary of this session's own room: the highest event id
   * whose row is on disk. The web keeps it per in-memory session, so a
   * resumed conversation starts again from 0 with its fresh room.
   */
  lastPersistedEventId = 0;
  currentTurn: TurnRecord | null = null;
  numTurns = 0;
  inputTokens = 0;
  outputTokens = 0;
  totalCostUsd = 0;
  model: string | null;
  providerThreadId: string | null;
  /** True once the turn that hit the activity timeout has been retried. */
  recoveryAttempted = false;
  /** Adapter-independent "no events for a while" clock. */
  lastActivityAt: number;
  steerTarget: SteerTarget | null = null;

  private readonly transcript: SessionTranscript;
  private readonly delivery: SessionMessageDelivery;
  private readonly toolEvents: SessionToolEvents;
  private readonly hooks: SessionHooks;
  private readonly attachmentContext: AttachmentPromptContext | null;
  private readonly clock: () => number;
  private readonly readBuildStatus: () => BuildStatus;
  /** Streaming text block id → its assistant_turn_id. */
  private readonly streamingBlocks = new Map<string, string>();
  private lastReportedCostUsd = 0;
  private terminalResolve: (() => void) | null = null;
  readonly terminal: Promise<void>;

  constructor(init: LocalSessionInit) {
    this.sessionId = init.sessionId;
    this.conversationId = init.conversationId;
    this.agentJobId = init.agentJobId;
    this.project = init.project;
    this.room = init.room;
    this.hooks = init.hooks;
    this.attachmentContext = init.attachmentContext;
    this.clock = init.now ?? (() => Date.now());
    this.readBuildStatus = init.buildStatus ?? (() => 'not_started');
    this.messages = init.initialMessages.slice();
    this.transcript = new SessionTranscript(init.transcript, this.clock, (eventId) => {
      this.lastPersistedEventId = Math.max(this.lastPersistedEventId, eventId);
    });
    this.delivery = new SessionMessageDelivery({
      messages: this.messages,
      transcript: this.transcript,
      attachmentContext: this.attachmentContext,
      publish: (event, data) => this.publish(event, data),
    });
    this.queue = this.delivery.queue;
    this.pendingSteers = this.delivery.pendingSteers;
    this.unconfirmedSteers = this.delivery.unconfirmedSteers;
    this.acceptedStates = this.delivery.acceptedStates;
    this.retainedMessageIds = this.delivery.retainedMessageIds;
    this.model = init.model;
    this.toolEvents = new SessionToolEvents({
      transcript: this.transcript,
      publish: (event, data) => this.publish(event, data),
      model: () => this.model,
      currentTurn: () => this.currentTurn,
    });
    this.liveChildAgents = this.toolEvents.liveChildAgents;
    this.providerThreadId = init.providerThreadId;
    this.createdAt = new Date(this.clock()).toISOString();
    this.lastActivityAt = this.clock();
    this.terminal = new Promise((resolve) => {
      this.terminalResolve = resolve;
    });
  }

  get isTerminal(): boolean {
    return isTerminalStatus(this.status);
  }

  get eventCounter(): number {
    return this.room.eventCounter;
  }

  /** Follow-ups accepted but not yet handed to the model. */
  get pendingCount(): number {
    return this.delivery.pendingCount;
  }

  get hasUserMessageCapacity(): boolean {
    return this.pendingCount < MAX_PENDING_USER_MESSAGES;
  }

  liveState(): LiveSessionCapabilities {
    return sessionLiveState({
      status: this.status,
      turnActive: this.turnActive,
      userStopRequested: this.userStopRequested,
      messageAdmissionClosed: this.messageAdmissionClosed,
      hasUserMessageCapacity: this.hasUserMessageCapacity,
      buildStatus: this.readBuildStatus(),
    });
  }

  // ── Publishing / persistence ───────────────────────────────────────────

  publish(event: string, data: unknown): number {
    return this.room.publish(event, data);
  }

  /** Mark the session running: the first lifecycle frame after the create response. */
  markRunning(): void {
    if (this.status !== 'starting') return;
    this.status = 'running';
    this.publish('session_status', { status: 'running' });
  }

  // ── Follow-up admission and delivery states ────────────────────────────

  /**
   * Record an accepted follow-up (`messaging.py::_publish_queued_message`).
   * The row is born `queued`; only the consumer promotes it. The caller has
   * already persisted the row and decided the route.
   */
  announceAccepted(message: QueuedUserMessage): void {
    this.delivery.announceAccepted(message);
    this.turnActive = true;
    this.publish('turn_status', { turn_active: true });
  }

  /** Whether a follow-up should be held for the running turn rather than queued. */
  get acceptsSteering(): boolean {
    return this.currentTurn !== null && this.turnActive && !this.userStopRequested && this.steerTarget !== null;
  }

  /**
   * Publish and record a delivery-state change. Delivered/steered rows move
   * to the end of the in-memory transcript: the row was accepted before the
   * prior answer finished, and its transcript position is the point at
   * which the agent actually receives it.
   */
  recordDeliveryState(
    message: QueuedUserMessage,
    state: MessageDeliveryState,
    options: { preserveTranscriptPosition?: boolean } = {},
  ): void {
    this.delivery.recordState(message, state, options);
  }

  /** Queue a follow-up for the next turn (front when re-queued after a failed steer). */
  enqueue(message: QueuedUserMessage, atFront = false): void {
    this.delivery.enqueue(message, atFront);
  }

  /** Take every waiting follow-up for one turn, in send order. */
  drainQueue(): QueuedUserMessage[] {
    return this.delivery.drainQueue();
  }

  /**
   * Write held messages into the turn if it is provably still live. A
   * failed write sends the remaining messages back to the queue. Called
   * after every top-level tool call opens the window, and by the service
   * right after acceptance in case the window is already open (a long
   * tool call would otherwise hold the message until its result).
   */
  deliverPendingSteers(): void {
    this.delivery.deliverPendingSteers({
      turnIsLive: this.toolEvents.turnIsLive,
      userStopRequested: this.userStopRequested,
      hasCurrentTurn: this.currentTurn !== null,
      steerTarget: this.steerTarget,
    });
  }

  // ── Turn boundaries ────────────────────────────────────────────────────

  beginTurn(turn: TurnRecord): void {
    this.currentTurn = turn;
    this.toolEvents.beginTurn();
    this.streamingBlocks.clear();
    this.lastActivityAt = this.clock();
  }

  /** The current anchor for a permission prompt (same walk as the store's). */
  currentAssistantTurnId(): string {
    return assistantTurnId(this.messages);
  }

  // ── The consumer ───────────────────────────────────────────────────────

  consume(event: AgentEvent): void {
    // The web's publish_event returns None once the session is gone; a late
    // adapter event after teardown (the killed process exiting) is dropped.
    if (this.isTerminal) return;
    this.lastActivityAt = this.clock();
    if (this.currentTurn) this.currentTurn.lastActivityAt = this.lastActivityAt;
    this.hooks.onEvent?.(this, event);
    switch (event.kind) {
      case 'user_message':
        // The initial message was published at creation; follow-ups at
        // acceptance. The adapter's echo carries nothing new.
        return;
      case 'thread_started':
        this.providerThreadId = event.providerThreadId;
        if (event.model) this.model = event.model;
        this.hooks.onThreadStarted?.(this, event.providerThreadId, event.model);
        return;
      case 'turn_started':
        this.turnActive = true;
        this.publish('turn_status', { turn_active: true });
        this.consumeRetainedMessages();
        return;
      case 'assistant_message_started':
        this.streamingBlocks.clear();
        this.delivery.confirmSteers();
        return;
      case 'assistant_text_delta':
        this.textDelta(event.blockId, event.text);
        return;
      case 'assistant_text_completed':
        this.textCompleted(event.blockId, event.text);
        return;
      case 'thinking_delta':
      case 'thinking_completed':
        // The web never shows orchestrator reasoning.
        return;
      case 'tool_call_started':
        this.toolEvents.started(event);
        this.deliverPendingSteers();
        return;
      case 'tool_call_completed':
        this.toolEvents.completed(event);
        return;
      case 'subagent_text_delta':
        this.publish('subagent_stream_delta', {
          parent_tool_use_id: event.parentToolCallId,
          text: event.text,
          delta_kind: event.deltaKind,
        });
        return;
      case 'subagent_text_completed': {
        const text = event.text.trim();
        if (!text) return;
        const messageId = randomUUID();
        const payload = { parent_tool_use_id: event.parentToolCallId, text, message_id: messageId };
        // Persisted first, then published: a reload after the event must
        // already see the row (the web's boundary rule for child prose).
        this.transcript.persistTool({ kind: 'subagent_text', ...payload }, null);
        const id = this.publish('subagent_text', payload);
        this.transcript.advanceBoundary(id);
        return;
      }
      case 'agent_status':
        this.toolEvents.agentStatus(event.toolCallId, event.agent, event.status);
        return;
      case 'permission_request':
        this.pendingPermissionIds.add(event.requestId);
        this.publish('permission_request', {
          request_id: event.requestId,
          turn_id: event.turnId,
          tool_call_id: event.toolCallId,
          tool: event.tool,
          // The card shows a short preview; the adapter keeps the raw input
          // for the answer, so a large Write body is not shipped twice.
          input: summarizeToolInput(event.tool, event.input),
          description: event.description,
          reason: event.reason,
          suggestions: event.suggestions.map((suggestion) => ({ label: suggestion.label, payload: suggestion.payload })),
          tool_use_id: event.toolCallId,
          assistant_turn_id: this.currentAssistantTurnId(),
        });
        return;
      case 'permission_resolved':
        this.pendingPermissionIds.delete(event.requestId);
        this.publish('permission_resolved', { request_id: event.requestId, behavior: event.behavior });
        return;
      case 'usage':
        this.inputTokens += event.usage.inputTokens + event.usage.cachedInputTokens + event.usage.cacheCreationInputTokens;
        this.outputTokens += event.usage.outputTokens;
        this.publish('token_usage', { input_tokens: this.inputTokens, output_tokens: this.outputTokens });
        return;
      case 'turn_completed':
      case 'turn_interrupted':
      case 'turn_failed':
        this.finishTurn(event);
        return;
      case 'runtime_log': {
        if (event.level !== 'error') return;
        const friendly = claudeApiErrorMessage(event.message);
        if (!friendly) return;
        if (this.currentTurn) this.currentTurn.hadError = true;
        this.publish('error', { message: friendly });
        return;
      }
      default:
        return;
    }
  }

  private consumeRetainedMessages(): void {
    this.delivery.consumeRetainedMessages();
  }

  private textDelta(blockId: string, text: string): void {
    let turnId = this.streamingBlocks.get(blockId);
    if (turnId === undefined) {
      // Announced lazily on the first delta so a blank block (Claude often
      // opens a message with one) never produces an empty streaming row.
      turnId = assistantTurnId(this.messages);
      this.streamingBlocks.set(blockId, turnId);
      this.publish('stream_start', { assistant_turn_id: turnId });
    }
    this.publish('stream_delta', { text, assistant_turn_id: turnId });
  }

  private textCompleted(blockId: string, rawText: string): void {
    const streamedId = this.streamingBlocks.get(blockId);
    this.streamingBlocks.delete(blockId);
    if (streamedId !== undefined) this.publish('stream_end', { assistant_turn_id: streamedId });
    const text = rawText.trim();
    if (!text) return;
    const turnId = assistantTurnId(this.messages);
    this.messages.push({ role: 'agent', content: text });
    const id = this.publish('chat', { role: 'agent', content: text, assistant_turn_id: turnId });
    this.transcript.persistAgentText(text, id);
  }

  /** A Lean build step from the blueprint room, mirrored into this session and its transcript. */
  forwardBuildStatus(phase: string, message: string): void {
    if (this.isTerminal) return;
    const id = this.publish('build_status', { phase, message });
    this.transcript.persistTool({ kind: 'build_status', phase, message }, id);
  }

  /** Close out child cards whose run never posted a terminal status (session end). */
  flushLiveChildAgents(): void {
    this.toolEvents.flushLiveChildren();
  }

  private finishTurn(event: TurnEndEvent): void {
    const turn = this.currentTurn ?? {
      turnId: event.turnId,
      kind: 'follow_up' as const,
      userMessage: '',
      startedAt: this.clock(),
      wroteLeanFiles: false,
      hadError: false,
      lastActivityAt: this.clock(),
    };
    this.streamingBlocks.clear();
    this.toolEvents.finishTurn();
    // The adapter answers (denies) prompts still open when its turn ends.
    this.pendingPermissionIds.clear();
    this.delivery.requeueSteers();
    // Children still live at turn end stay live: the web only marks them
    // stopped when the session ends (flushLiveChildAgents), and a child that
    // settled without a notice was closed by its spawn's tool result.
    if (event.kind === 'turn_completed') {
      this.numTurns += 1;
      if (event.costUsd !== null) {
        // Claude reports the cost of the whole process conversation so far;
        // a respawned process starts again from zero.
        this.totalCostUsd += event.costUsd >= this.lastReportedCostUsd ? event.costUsd - this.lastReportedCostUsd : event.costUsd;
        this.lastReportedCostUsd = event.costUsd;
      }
      // session_result goes out before the turn_status that clears the
      // turn; the store relies on that order.
      this.publish('session_result', {
        total_cost_usd: this.totalCostUsd,
        num_turns: this.numTurns,
        duration_ms: event.durationMs ?? Math.max(0, this.clock() - turn.startedAt),
        stop_reason: event.stopReason,
      });
    } else if (event.kind === 'turn_failed') {
      turn.hadError = true;
      this.publish('error', { message: event.message });
    }
    this.currentTurn = null;
    this.turnActive = false;
    this.publish('turn_status', { turn_active: false });
    this.hooks.onTurnEnded(this, event, turn);
  }

  // ── Teardown ───────────────────────────────────────────────────────────

  /**
   * Finalize user messages this session accepted but never delivered. A
   * user Stop retains them as context for the next run; other terminal
   * exits supersede them so a correction the agent never saw cannot read
   * as delivered after a reload.
   */
  finalizeUndeliveredMessages(): void {
    this.delivery.finalizeUndeliveredMessages(this.userStopRequested);
  }

  /** The Stop response: every still-queued message is destined to become retained. */
  stopDeliveryStates(): Record<string, MessageDeliveryState> {
    return this.delivery.stopDeliveryStates();
  }

  /** Mark terminal; the caller publishes session_end after the transcript is flushed. */
  markEnded(status: 'completed' | 'failed' | 'cancelled'): void {
    this.status = status;
    this.turnActive = false;
    this.currentTurn = null;
  }

  /** session_end is out and the room is closed: waiters (Stop, /wait, shutdown) may proceed. */
  markClosed(): void {
    this.terminalResolve?.();
  }
}
