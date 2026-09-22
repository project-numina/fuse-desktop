/**
 * Chat store + SSE lifecycle. Manages the message history and communicates
 * with the backend session API for real-time agent responses via SSE.
 *
 * Also tracks tool-call and subagent activity so the chat panel can show what
 * the agent is doing while the user waits, and exposes history loading for past
 * sessions.
 *
 * - `createChatStore(options)` is a side-effect-free factory returning a plain
 *   store object with imperative actions (`send`, `stop`, `loadHistory`,
 *   `prepareNewAgentSession`, `on`, `off`, `disconnect`) and
 *   lifecycle/subscription methods. Construction opens no EventSource, attaches
 *   no listeners, and arms no timers; side effects begin in `mount()` so only a
 *   mounted instance touches external state.
 * - The internal `state` object is mutated in place. Each mutation is followed
 *   by `emit()`, which rebuilds an immutable top-level snapshot with fresh
 *   collection and `liveSession` references. This lets `useSyncExternalStore`
 *   detect changes and re-render subscribers. The connection lifecycle handles
 *   reconnect backoff, CLOSED recovery, hidden-tab release and keepalive
 *   leasing, stall polling, visibility/focus/pageshow resume, exact-resume
 *   cursors, and buffer overflow recovery.
 * - `ChatProvider` owns one store per blueprint and drives `mount`/`dispose`
 *   from an effect; `useChat()` reads it via `useSyncExternalStore`.
 *
 * The external `on/off` listener registry is preserved unchanged: the blueprint
 * event stream piggybacks on this same EventSource.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import {
  ApiError,
  cancelSession,
  createSession as createSessionRequest,
  fetchLiveSessionForConversation,
  fetchSessionHistoryDetail,
  fetchSubagentHistory,
  fetchSessionState,
  keepaliveSession,
  sendSessionMessage,
} from '@/lib/api';
import { createBuildState } from './build-state';
import { createAssistantStreamState } from './assistant-stream-state';
import {
  attachActivitiesToMessages,
  hydratePersistedSubagents,
  mergePersistedSubagentTimeline,
  reconstructHistoryActivities,
  reconstructHistoryBuilds,
} from './history';
import {
  buildChatMessages,
  buildChatSnapshot,
  collectOptimisticTurnMessageIds,
  collectPersistedAssistantTurnIds,
  contextAttachmentPayload,
  createInitialChatState,
  createUserMessage,
  currentTurnContext,
  mergePendingLocalMessages,
  updateUserMessageDeliveryState,
} from './message-state';
import { createPermissionState } from './permission-state';
import { createSubagentEventState } from './subagent-event-state';
import { createToolCallState } from './tool-call-state';
import {
  CLOSED_STREAM_RECONNECT_INITIAL_MS,
  CLOSED_STREAM_RECONNECT_MAX_MS,
  EVENTSOURCE_RECONNECT_GRACE_MS,
  HIDDEN_SESSION_KEEPALIVE_INTERVAL_MS,
  HIDDEN_STREAM_DISCONNECT_DELAY_MS,
  parseSseEventData,
  STREAM_LIVENESS_POLL_INTERVAL_MS,
  STREAM_STALL_MS,
} from './sse';
import {
  cancelActiveSubagents,
} from './subagents';
import {
  historyStatusToSessionStatus,
  isDeliveryState,
  isTerminalSessionStatus,
  SESSION_STATUS,
  TERMINAL_SESSION_STATUSES,
} from './types';
import type {
  ChatContextAttachment,
  ChatMessage,
  ChatOptions,
  ChatState,
  ConversationLiveSessionResponse,
  LiveBuildStatus,
  SessionCreateResponse,
  SessionHistoryDetail,
  SessionStateResponse,
  SessionStatus,
  SubagentHistoryDetail,
  ToolHistoryEvent,
} from './types';
import { notifySessionHistoryChanged } from '@/lib/session-events';

// Re-export the public value types so `@/state/chat` is a one-stop import for
// consumers (chat panel, tool-call components, blueprint event hook).
export type {
  ActivityItem,
  BuildActivity,
  BuildStep,
  ChatAttachmentKind,
  ChatAttachmentSelection,
  ChatContextAttachment,
  ChatMessage,
  ChatOptions,
  ChatState,
  LiveBuildStatus,
  LiveSessionState,
  PermissionPrompt,
  PermissionSuggestion,
  PersistedChatMessage,
  SessionHistoryDetail,
  SessionStatus,
  SubagentStream,
  ToolHistoryEvent,
} from './types';

// ── Store factory ──

// How many delivered subagent event ids are remembered for replay dedup.
//
// The backend replays from a per-session ring buffer sized by
// `settings.sse_event_buffer_size` (default 1,000). That value is
// **configurable and not reported to the client** — no session or live-session
// response carries it — so this window cannot be sourced from the backend and
// is a heuristic, not a guarantee. Twice the shipped default covers the
// deployed configuration; raising `sse_event_buffer_size` past this window
// silently under-covers replay dedup (a reconnect could re-apply an already
// applied subagent event, duplicating a prose segment) with no failure signal,
// so raise this constant with it. The durable fix is for the backend to report
// the buffer size on `LiveSessionCapabilities` (the mixin every live-session
// payload already shares) and size this window off it; until then this constant
// is the contract. It is bounded on purpose: an unbounded set retains one
// string per token for the life of a multi-hour autonomous run.
const SUBAGENT_EVENT_DEDUP_LIMIT = 2_000;

// History transcripts can be several megabytes. Keep a small per-blueprint LRU
// so moving between recently viewed completed chats does not download and parse
// the same immutable transcript on every click.
const HISTORY_DETAIL_CACHE_LIMIT = 5;
const SUBAGENT_HISTORY_CACHE_LIMIT = 10;

/**
 * Creates a chat store scoped to a specific blueprint. Side-effect free: no
 * EventSource, listeners, or timers until `mount()` is called.
 *
 * On the first user message, creates a backend session and subscribes to its
 * SSE event stream. Subsequent messages are forwarded to the running session.
 * Agent responses arrive via the SSE stream and are appended to the message
 * list in real time.
 */
export function createChatStore({ repositoryOwner, repositoryName, blueprintName }: ChatOptions) {
  const state = createInitialChatState();

  // ── External-store subscription shell ──
  const listeners = new Set<() => void>();

  function buildSnapshot(): ChatState {
    // A fresh top-level object so `useSyncExternalStore`'s Object.is check sees
    // every change. Slice identity, however, is a *signal*: `emit()` runs after
    // every delivered SSE frame, and the chat-turn selectors filter + sort +
    // reduce the whole activity log (which is deliberately never trimmed, so it
    // grows with session length) whenever `activities` or `subagents` change
    // identity. Reallocating those unconditionally made that work run once per
    // streamed token. `activities`, `subagents`, `historyTools` and
    // `liveSession` are only ever *replaced* by their handlers, never mutated in
    // place, so passing them through by reference is both cheaper and a more
    // faithful change signal.
    //
    // `messages` and `buildHistory` are still mutated in place (streamed text is
    // appended to a live message object; build steps are promoted on the build
    // object), so they must be copied for the mutation to be observable. Both
    // are bounded by turn/build count rather than token count.
    return buildChatSnapshot(state);
  }

  let snapshot: ChatState = buildSnapshot();
  let disposed = false;
  // Monotonically-incrementing lifecycle token. Bumped on every dispose() so an
  // async operation captured before disposal (and which may resume even after a
  // later re-mount flips `disposed` back to false, as StrictMode's
  // mount→dispose→mount does) can detect it is stale after an await and bail out
  // before mutating state or (re)subscribing.
  let generation = 0;

  function emit(): void {
    if (disposed) return;
    snapshot = buildSnapshot();
    for (const listener of listeners) listener();
  }

  function getSnapshot(): ChatState {
    return snapshot;
  }

  function subscribeStore(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  let eventSource: EventSource | null = null;
  let pendingScrollCallback: (() => void) | null = null;
  let activeSessionEventCounter: number | null = null;
  let historyLoadVersion = 0;
  const historyDetailCache = new Map<string, SessionHistoryDetail>();
  const historyDetailRequests = new Map<
    string,
    Promise<SessionHistoryDetail>
  >();
  const subagentHistoryCache = new Map<string, SubagentHistoryDetail>();
  const subagentHistoryRequests = new Map<
    string,
    Promise<SubagentHistoryDetail>
  >();
  let reconnectErrorTimer: ReturnType<typeof setTimeout> | null = null;
  let closedStreamReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closedStreamReconnectDelayMs = CLOSED_STREAM_RECONNECT_INITIAL_MS;
  // True while a recoverClosedEventSource attempt is mid-flight (awaiting
  // /state). Guards against the backoff timer and the liveness poller kicking
  // off a second concurrent recovery that would double-subscribe.
  let recoveringClosedStream = false;
  let sessionCreationGeneration = 0;
  // Highest SSE event id delivered on the current session's stream, used
  // as the replay cursor when a hidden-tab suspension resumes.
  let lastSeenEventId: number | null = null;
  let hiddenSuspendTimer: ReturnType<typeof setTimeout> | null = null;
  let hiddenKeepaliveTimer: ReturnType<typeof setInterval> | null = null;
  let suspendedWhileHidden = false;
  let liveSessionLostWhileHidden = false;
  // Periodic liveness check for a visible tab whose stream died without the
  // browser reporting CLOSED (wedged CONNECTING, a buffering proxy, or a resume
  // the visibility event never fired). null when no live session is watched.
  let livenessPollTimer: ReturnType<typeof setInterval> | null = null;
  // Wall-clock ms of the last activity (any event or heartbeat) on the current
  // stream, or null when none is being watched. A stream that goes silent past
  // the stall window — no deltas and no heartbeats — is treated as dead.
  let lastStreamActivityMs: number | null = null;
  // True once mount() has armed the document/window listeners and it is safe to
  // arm the liveness poller; dispose() owns their cleanup.
  let ownsScopeCleanup = false;
  let mounted = false;
  // Monotonic counter assigning a chronological `order` to live activities
  // and subagents so the chat panel can interleave them within an anchor
  // bucket. Seeded past the reconstructed history range on each load.
  let activityOrderCounter = 0;
  // Tool-use ids already materialized (from reconstruction or earlier live
  // delivery). A reconnect replays the in-flight tail from the SSE buffer, which
  // can overlap the reconstructed transcript by a row or two; skipping ids that
  // are already applied keeps replay idempotent so tool/subagent rows are not
  // duplicated regardless of where the replay cursor lands.
  const appliedToolUseIds = new Set<string>();
  const appliedAssistantTurnIds = new Set<string>();
  const finalizedAssistantTurnIds = new Set<string>();
  const appliedSubagentEventIds = new Set<string>();
  const appliedSubagentMessageIds = new Set<string>();
  const appliedErrorEventKeys = new Set<string>();
  // A delivery update can precede the `chat` event that attaches the durable
  // id to the optimistic row. Hold it until identity adoption so a terminal
  // `steered` update cannot be overwritten by that chat event's initial
  // `queued` snapshot.

  function rememberSubagentEvent(eventId: string): boolean {
    if (!eventId) return true;
    if (appliedSubagentEventIds.has(eventId)) return false;
    appliedSubagentEventIds.add(eventId);
    if (appliedSubagentEventIds.size > SUBAGENT_EVENT_DEDUP_LIMIT) {
      const oldest = appliedSubagentEventIds.values().next().value;
      if (oldest !== undefined) appliedSubagentEventIds.delete(oldest);
    }
    return true;
  }

  function nextActivityOrder(): number {
    activityOrderCounter += 1;
    return activityOrderCounter;
  }

  const permissionState = createPermissionState({
    state,
    emit,
    currentTurnContext: () => currentTurnContext(state.messages),
    nextActivityOrder,
    scrollToLatest: () => pendingScrollCallback?.(),
  });
  const handlePermissionRequest = permissionState.handleRequest;
  const handlePermissionResolved = permissionState.handleResolved;
  const respondPermission = permissionState.respond;

  const buildState = createBuildState({
    state,
    emit,
    currentTurnId: () => currentTurnContext(state.messages).turnId,
    updateLiveBuildStatus: updateLiveSessionBuildStatus,
    scrollToLatest: () => pendingScrollCallback?.(),
  });
  const handleBuildSnapshot = buildState.handleSnapshot;
  const handleBuildStatus = buildState.handleStatus;

  const subagentEventState = createSubagentEventState({
    state,
    nextActivityOrder,
    currentTurnContext: () => currentTurnContext(state.messages),
    rememberEvent: rememberSubagentEvent,
    appliedMessageIds: appliedSubagentMessageIds,
  });
  const ensureSubagent = subagentEventState.ensure;
  const writeSubagent = subagentEventState.write;
  const handleSubagentStreamDelta = subagentEventState.handleStreamDelta;
  const handleSubagentMessage = subagentEventState.handleMessage;
  const handleSubagentText = subagentEventState.handleText;

  const toolCallState = createToolCallState({
    state,
    appliedToolUseIds,
    ensureSubagent,
    writeSubagent,
    currentTurnContext: () => currentTurnContext(state.messages),
    nextActivityOrder,
    scrollToLatest: () => pendingScrollCallback?.(),
  });
  const handleToolCall = toolCallState.handleCall;
  const handleToolResult = toolCallState.handleResult;
  const handleAgentStatus = toolCallState.handleAgentStatus;
  const handleProverBatchStatus = toolCallState.handleProverBatchStatus;

  const assistantStreamState = createAssistantStreamState({
    state,
    appliedTurnIds: appliedAssistantTurnIds,
    finalizedTurnIds: finalizedAssistantTurnIds,
    freezeActivities,
    emit,
    scrollToLatest: () => pendingScrollCallback?.(),
  });
  const handleStreamStart = assistantStreamState.handleStart;
  const handleStreamDelta = assistantStreamState.handleDelta;
  const handleChat = assistantStreamState.handleChat;
  const handleMessageDelivery = assistantStreamState.handleDelivery;

  // External listeners registered via on() are tracked so they can be
  // re-applied whenever the internal EventSource is (re)created.
  const externalListeners: Array<{
    event: string;
    handler: (event: Event) => void;
  }> = [];

  function clearHistoryView(): void {
    historyLoadVersion += 1;
    state.viewingConversationId = null;
    state.historySession = null;
    state.historyTools = [];
    buildState.reset();
    emit();
  }

  function clearLiveSessionState(): void {
    state.liveSession = {
      isActiveSession: false,
      canSend: true,
      canCancel: false,
      buildStatus: 'not_started',
      displayStatus: null,
      turnActive: false,
      activeProverBatchId: null,
      activeProverBatchTotal: 0,
      activeProverBatchCompleted: 0,
      activeWorkGroupCount: 0,
    };
    // A prompt only exists while a live turn is paused on it; every path that
    // clears live-session state (stop, session end, history switch, new chat)
    // also invalidates the prompt.
    state.permissions = [];
    emit();
  }

  function settleStoppedSession(): void {
    disconnect();
    // Stopping disconnects before terminal SSE events arrive, so cancel cards
    // that would otherwise remain queued or in their running shimmer state.
    state.subagents = cancelActiveSubagents(state.subagents, Date.now());
    state.sending = false;
    state.status = SESSION_STATUS.CANCELLED;
    state.sessionId = null;
    state.currentJobId = null;
    state.autonomousRunActive = false;
    activeSessionEventCounter = null;
    lastSeenEventId = null;
    pendingScrollCallback = null;
    clearLiveSessionState();
    const conversationId = state.conversationId;
    if (conversationId) {
      notifySessionHistoryChanged(conversationId);
    }
    emit();
  }

  function shouldAttachLiveSession(
    liveSession: ConversationLiveSessionResponse,
  ): boolean {
    if (liveSession.is_active_session === false) return false;
    if (liveSession.user_stop_requested) return false;
    if (isTerminalSessionStatus(liveSession.status)) return false;
    return true;
  }

  async function cancelCreatedSession(
    response: SessionCreateResponse,
  ): Promise<void> {
    try {
      await cancelSession(response.session_id);
      notifySessionHistoryChanged(response.conversation_id);
    } catch (cancelError) {
      // A 404 means the session finished or was evicted before the deferred
      // cancellation reached the backend.
      if (cancelError instanceof ApiError && cancelError.status === 404) return;
      throw cancelError;
    }
  }

  function applyLiveSessionState(
    source: {
      is_active_session?: boolean;
      can_send?: boolean;
      can_cancel?: boolean;
      build_status?: LiveBuildStatus;
      display_status?: string;
      turn_active?: boolean;
      active_prover_batch_id?: string | null;
      active_prover_batch_total?: number;
      active_prover_batch_completed?: number;
      active_work_group_count?: number;
    },
  ): void {
    state.liveSession = {
      isActiveSession: source.is_active_session ?? state.liveSession.isActiveSession,
      canSend: source.can_send ?? state.liveSession.canSend,
      canCancel: source.can_cancel ?? state.liveSession.canCancel,
      buildStatus: source.build_status ?? state.liveSession.buildStatus,
      displayStatus: source.display_status ?? state.liveSession.displayStatus,
      turnActive: source.turn_active ?? state.liveSession.turnActive,
      // Distinguish an explicit null ("no batch", which must clear any stale id)
      // from an absent field ("not reported", keep current). `??` treats null
      // like absent, so attaching a batch-free session after viewing one with a
      // batch would keep the old id and wedge canSend false via applyTurnEnded.
      activeProverBatchId: source.active_prover_batch_id !== undefined
        ? source.active_prover_batch_id
        : state.liveSession.activeProverBatchId,
      activeProverBatchTotal: source.active_prover_batch_total
        ?? state.liveSession.activeProverBatchTotal,
      activeProverBatchCompleted: source.active_prover_batch_completed
        ?? state.liveSession.activeProverBatchCompleted,
      activeWorkGroupCount: source.active_work_group_count
        ?? state.liveSession.activeWorkGroupCount,
    };
    emit();
  }

  function updateLiveSessionBuildStatus(buildStatus: LiveBuildStatus): void {
    const isActiveSession = !!state.sessionId
      && !isTerminalSessionStatus(state.status);
    const readyStatus = buildStatus === 'running'
      ? 'Ready for messages. Lean build still running.'
      : buildStatus === 'failed'
        ? 'Ready for messages. Lean build failed.'
        : 'Ready for messages.';
    // Preserve the agent's "working" displayStatus while a turn is in
    // flight: build progress and turn progress are independent, and
    // overwriting the status here would tell the user the chat is ready
    // for input even though the agent is still running.
    const turnInFlight = state.liveSession.turnActive
      || state.sending
      || state.liveSession.activeWorkGroupCount > 0;
    state.liveSession = {
      ...state.liveSession,
      isActiveSession,
      canCancel: isActiveSession,
      buildStatus,
      displayStatus: turnInFlight ? state.liveSession.displayStatus : readyStatus,
    };
    emit();
  }

  function applyTurnEnded(): void {
    const isActiveSession = !!state.sessionId
      && !isTerminalSessionStatus(state.status);
    state.liveSession = {
      ...state.liveSession,
      turnActive: false,
    };
    updateLiveSessionBuildStatus(state.liveSession.buildStatus);
    state.liveSession = {
      ...state.liveSession,
      isActiveSession,
      canSend: isActiveSession
        && !state.liveSession.activeProverBatchId
        && state.liveSession.activeWorkGroupCount === 0,
      canCancel: isActiveSession,
    };
    emit();
  }

  function attachLiveSession(
    detail: SessionHistoryDetail,
    liveSession: ConversationLiveSessionResponse,
    replayAfterEventId: number | null = liveSession.last_persisted_event_id
      ?? liveSession.event_counter,
  ): void {
    if (state.sessionId !== liveSession.session_id) {
      appliedErrorEventKeys.clear();
      // Prompts belong to one live session; the replay from the persisted
      // boundary re-delivers any that are still pending on the new one.
      state.permissions = [];
    }
    state.conversationId = detail.id;
    state.currentJobId = liveSession.agent_job_id;
    state.sessionId = liveSession.session_id;
    state.status = liveSession.status;
    state.autonomousRunActive = true;
    activeSessionEventCounter = liveSession.event_counter;
    lastSeenEventId = replayAfterEventId;
    state.viewingConversationId = null;
    state.historySession = detail;
    state.sending = false;
    applyLiveSessionState(liveSession);
    state.buildHistory = reconstructHistoryBuilds(detail.messages);
    applyPersistedHistory(detail, true);
    emit();
    subscribe(replayAfterEventId);
  }

  function invalidateHistoryLoads(): void {
    historyLoadVersion += 1;
  }

  function isShowingStaticHistory(jobId: string): boolean {
    return state.viewingConversationId === jobId
      && state.sessionId === null
      && !state.autonomousRunActive
      && state.historySession?.id === jobId;
  }

  function applyPersistedHistory(
    detail: SessionHistoryDetail,
    isLive: boolean,
  ): void {
    const optimisticTurnMessageIds = collectOptimisticTurnMessageIds(state.messages);
    state.suggestion = null;
    // The live snapshot is authoritative while attached. In particular, a
    // history request can still describe the persisted job as `queued` while
    // its live session has already advanced to `starting` or `running`.
    if (!isLive) state.status = historyStatusToSessionStatus(detail.status);
    state.buildHistory = reconstructHistoryBuilds(
      detail.messages,
      optimisticTurnMessageIds,
    );
    state.historyTools = detail.messages
      .filter((message) => message.role === 'tool')
      .map((message) => {
        try {
          return JSON.parse(message.content) as ToolHistoryEvent;
        } catch {
          return null;
        }
      })
      .filter((event): event is ToolHistoryEvent => event !== null);
    const historyActivities = reconstructHistoryActivities(
      detail.messages,
      optimisticTurnMessageIds,
    );
    // Restore the local optimistic-turn exception before activity attachment.
    // Reconstruction counted that persisted queued row as a real turn, so the
    // message walk that resolves its anchor must make the same decision.
    const persistedMessages = mergePendingLocalMessages(
      buildChatMessages(detail.messages, (suggestion) => {
        state.suggestion = suggestion;
      }),
      state.messages,
    );
    state.messages = attachActivitiesToMessages(
      persistedMessages,
      historyActivities,
    );
    appliedErrorEventKeys.clear();
    for (const message of state.messages) {
      if (message.errorEventKey) appliedErrorEventKeys.add(message.errorEventKey);
    }
    state.subagents = hydratePersistedSubagents(
      detail,
      isLive,
      optimisticTurnMessageIds,
    );
    appliedSubagentEventIds.clear();
    appliedSubagentMessageIds.clear();
    for (const subagent of state.subagents) {
      for (const message of subagent.messages ?? []) {
        if (message.messageId) appliedSubagentMessageIds.add(message.messageId);
      }
    }
    // Seed the dedup set with every tool call already in the reconstructed
    // transcript so a live replay that overlaps it is skipped rather than
    // appended a second time.
    appliedToolUseIds.clear();
    for (const activity of historyActivities) {
      if (activity.toolUseId) appliedToolUseIds.add(activity.toolUseId);
    }
    for (const subagent of state.subagents) {
      appliedToolUseIds.add(subagent.parentToolUseId);
      for (const call of subagent.toolCalls) {
        if (call.toolUseId) appliedToolUseIds.add(call.toolUseId);
      }
    }
    appliedAssistantTurnIds.clear();
    finalizedAssistantTurnIds.clear();
    for (const assistantTurnId of collectPersistedAssistantTurnIds(
      detail.messages,
      optimisticTurnMessageIds,
    )) {
      appliedAssistantTurnIds.add(assistantTurnId);
      finalizedAssistantTurnIds.add(assistantTurnId);
    }
    for (const message of state.messages) {
      if (message.role !== 'agent' || !message.assistantTurnId) continue;
      appliedAssistantTurnIds.add(message.assistantTurnId);
      if (message.streaming !== true || message.finalized === true) {
        finalizedAssistantTurnIds.add(message.assistantTurnId);
      }
    }
    // Reconstruction keys activities/subagents by their index in
    // detail.messages. Preview calls are omitted from that transcript but are
    // still persisted history, so live items must start past both ranges.
    activityOrderCounter = Math.max(
      detail.messages.length,
      ...state.subagents.flatMap((subagent) =>
        subagent.toolCalls.map((call) => call.order ?? 0)
      ),
    );
    emit();
  }

  function clearReconnectErrorTimer(): void {
    if (reconnectErrorTimer) {
      clearTimeout(reconnectErrorTimer);
      reconnectErrorTimer = null;
    }
  }

  function clearClosedStreamReconnectTimer(resetDelay = true): void {
    if (closedStreamReconnectTimer) {
      clearTimeout(closedStreamReconnectTimer);
      closedStreamReconnectTimer = null;
    }
    if (resetDelay) {
      closedStreamReconnectDelayMs = CLOSED_STREAM_RECONNECT_INITIAL_MS;
    }
  }

  function unblockSendingIfDisconnected(): void {
    if (!eventSource || eventSource.readyState !== EventSource.OPEN) {
      state.sending = false;
      emit();
    }
  }

  function shouldReconnectEventSource(): boolean {
    return !eventSource || eventSource.readyState === EventSource.CLOSED;
  }

  function applySessionStateSnapshot(sessionState: SessionStateResponse): void {
    state.status = sessionState.status;
    state.autonomousRunActive = true;
    state.sending = false;
    activeSessionEventCounter = sessionState.event_counter;
    applyLiveSessionState(sessionState);
    emit();
  }

  function scheduleClosedStreamReconnect(): void {
    if (
      disposed
      || closedStreamReconnectTimer
      || recoveringClosedStream
      || !state.sessionId
      || isTerminalSessionStatus(state.status)
    ) {
      return;
    }
    const delay = closedStreamReconnectDelayMs;
    closedStreamReconnectDelayMs = Math.min(
      closedStreamReconnectDelayMs * 2,
      CLOSED_STREAM_RECONNECT_MAX_MS,
    );
    closedStreamReconnectTimer = setTimeout(() => {
      closedStreamReconnectTimer = null;
      if (disposed) return;
      void recoverClosedEventSource();
    }, delay);
  }

  async function recoverClosedEventSource(): Promise<void> {
    if (disposed) return;
    if (!state.sessionId || isTerminalSessionStatus(state.status)) return;
    if (recoveringClosedStream) return;
    recoveringClosedStream = true;
    const recoveryGeneration = generation;
    const sessionId = state.sessionId;
    const replayAfterEventId = lastSeenEventId ?? activeSessionEventCounter ?? 0;
    try {
      const sessionState = await fetchSessionState(sessionId);
      // The store was disposed (or disposed then re-mounted) while awaiting;
      // dropping out here keeps a stale recovery from resubscribing a dead
      // provider's session.
      if (disposed || recoveryGeneration !== generation) return;
      if (state.sessionId !== sessionId) return;
      applySessionStateSnapshot(sessionState);
      if (isTerminalSessionStatus(sessionState.status)) {
        const conversationId = state.conversationId;
        if (conversationId) await loadHistory(conversationId);
        return;
      }
      // Resubscribe from the cursor as it stands now. If events were still
      // arriving on the old (stalled) stream during the await above, they
      // advanced lastSeenEventId; using the pre-await snapshot would replay them
      // again. lastSeenEventId is monotonic, so it is never behind the snapshot.
      subscribe(lastSeenEventId ?? replayAfterEventId);
    } catch (error) {
      if (disposed || recoveryGeneration !== generation) return;
      if (state.sessionId !== sessionId) return;
      // Clear the in-flight flag before scheduling a retry so the (guarded)
      // backoff scheduler is not blocked by this very attempt.
      recoveringClosedStream = false;
      const conversationId = state.conversationId;
      if (
        error instanceof ApiError
        && (error.status === 400 || error.status === 404)
        && conversationId
      ) {
        await loadHistory(conversationId).catch(() => {
          scheduleClosedStreamReconnect();
        });
        return;
      }
      scheduleClosedStreamReconnect();
    } finally {
      recoveringClosedStream = false;
    }
  }

  async function reconcileClosedStreamBeforeSend(): Promise<void> {
    const conversationId = state.conversationId;
    if (!state.sessionId || !conversationId || !shouldReconnectEventSource()) {
      return;
    }
    clearClosedStreamReconnectTimer();
    await loadHistory(conversationId).catch(() => {
      scheduleClosedStreamReconnect();
    });
  }

  async function recoverAfterBufferOverflow(recoverable: boolean): Promise<void> {
    // Recoverable overflow: a slow per-subscriber queue dropped events the ring
    // buffer still holds, so reconnect from the last event we actually received
    // and let replay backfill the gap. This preserves the in-flight assistant
    // tail instead of discarding it with a jump-to-latest reload. If the ring
    // buffer can no longer cover that cursor, the fresh subscription receives an
    // unrecoverable overflow and falls through to the durable reload below.
    if (recoverable && state.sessionId) {
      subscribe(lastSeenEventId ?? activeSessionEventCounter);
      return;
    }
    const conversationId = state.conversationId;
    if (conversationId) {
      await loadHistory(conversationId, { replayFromLatest: true }).catch(() => {
        scheduleClosedStreamReconnect();
      });
      return;
    }
    if (state.sessionId) {
      subscribe(activeSessionEventCounter);
    }
  }

  /**
   * Snapshots pending activities onto the last agent message
   * so they persist in the chat history, then clears the live list.
   */
  function freezeActivities(): void {
    if (!state.activities.length) return;
    // Try to attach to the last agent message in the transcript.
    let attached = false;
    for (let i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].role === 'agent') {
        state.messages[i].activities = [
          ...(state.messages[i].activities || []),
          ...state.activities,
        ];
        attached = true;
        break;
      }
    }
    // If no agent message exists yet (tool-first turn), create a
    // placeholder so the activities are not lost. Mark it as a placeholder so
    // it is excluded from the turn-id ordinal (matching reconstruction); an
    // unmarked empty row would shift every later turn id and misanchor cards.
    if (!attached) {
      state.messages.push({
        role: 'agent',
        text: '',
        activities: [...state.activities],
        placeholder: true,
      });
    }
    state.activities = [];
    emit();
  }

  function shouldResumeFromPriorConversation(): boolean {
    return isTerminalSessionStatus(state.status) && !!state.conversationId;
  }

  // ── Session lifecycle ──
  function handleSessionStatus(event: Event): void {
    const data = parseSseEventData<{ status?: unknown }>(event);
    if (data && typeof data.status === 'string') {
      const nextStatus = data.status as SessionStatus;
      state.status = nextStatus;
      const isActiveSession = !TERMINAL_SESSION_STATUSES.has(nextStatus);
      state.liveSession = {
        ...state.liveSession,
        isActiveSession,
        canCancel: isActiveSession,
        canSend: isActiveSession
          && !state.liveSession.turnActive
          && !state.liveSession.activeProverBatchId
          && state.liveSession.activeWorkGroupCount === 0,
      };
    }
  }

  function handleTurnStatus(event: Event): void {
    const data = parseSseEventData<{ turn_active?: unknown }>(event);
    if (!data || typeof data.turn_active !== 'boolean') return;
    if (data.turn_active) {
      const isActiveSession = !!state.sessionId
        && !isTerminalSessionStatus(state.status);
      state.liveSession = {
        ...state.liveSession,
        turnActive: true,
        isActiveSession,
        canCancel: isActiveSession,
        canSend: false,
      };
    } else {
      state.sending = false;
      // A prompt cannot outlive its turn: an interrupt or a turn failure ends
      // the turn without a `permission_resolved` for every open request.
      state.permissions = [];
      applyTurnEnded();
    }
  }

  function handleSessionResult(): void {
    freezeActivities();
    state.sending = false;
    // canSend/turnActive stay owned by turn_status. session_result is
    // emitted from inside _send_query before its finally clause clears
    // turn_active, so re-enabling input here would race the backend.
  }

  function handleWorkGroupStatus(event: Event): void {
    const data = parseSseEventData<{
      status?: unknown;
      task_count?: unknown;
      completed_count?: unknown;
      active_group_count?: unknown;
      integration_conflict_count?: unknown;
      resuming?: unknown;
    }>(event);
    if (!data || typeof data.status !== 'string') return;
    const total = typeof data.task_count === 'number' ? data.task_count : 0;
    const completed = typeof data.completed_count === 'number'
      ? data.completed_count
      : 0;
    const activeGroupCount = typeof data.active_group_count === 'number'
      ? Math.max(0, data.active_group_count)
      : data.status === 'running'
        ? Math.max(1, state.liveSession.activeWorkGroupCount)
        : Math.max(0, state.liveSession.activeWorkGroupCount - 1);
    const resuming = data.resuming === true;
    const integrationConflictCount = typeof data.integration_conflict_count === 'number'
      ? Math.max(0, data.integration_conflict_count)
      : 0;
    const resumeHint = resuming ? ' Autonomous agent is resuming.' : '';
    const isActiveSession = !!state.sessionId
      && !isTerminalSessionStatus(state.status);
    // `sending` is latched for the resume hop and cleared by the resumed turn's
    // turn_status(false) (or session_end). Requiring an active session is the
    // fallback for the case with no such clearing event: a group that reports
    // resuming after the session already reached a terminal status would
    // otherwise wedge the composer on a dead run.
    if (resuming && isActiveSession) state.sending = true;
    // 'cancelled' is a user stop (orchestration.py cancels the remaining
    // groups and reports every task as accounted for), not a completion, so it
    // must not read as "finished".
    const cancelled = data.status === 'cancelled';
    state.liveSession = {
      ...state.liveSession,
      activeWorkGroupCount: activeGroupCount,
      canSend: isActiveSession
        && activeGroupCount === 0
        && !resuming
        && !state.liveSession.turnActive
        && !state.liveSession.activeProverBatchId,
      displayStatus: data.status === 'running'
          ? `Delegated work is running (${completed}/${total}).`
          : cancelled
            ? `Delegated work was cancelled (${completed}/${total}).`
            : integrationConflictCount > 0
              ? `Delegated work finished with ${integrationConflictCount} integration ${integrationConflictCount === 1 ? 'conflict' : 'conflicts'} (${completed}/${total}).${resumeHint}`
            : resuming
              ? `Delegated work finished (${completed}/${total}). Autonomous agent is resuming.`
              : `Delegated work finished (${completed}/${total}).`,
    };
  }

  function handleErrorEvent(event: Event): void {
    const data = parseSseEventData<{ message?: unknown }>(event);
    if (typeof data?.message === 'string') {
      // Reconnects may replay the last buffered error. Include the message
      // because EventSource carries the previous id onto id-less stream errors.
      const eventId = (event as MessageEvent).lastEventId;
      const errorEventKey = eventId
        ? JSON.stringify([state.sessionId, eventId, data.message])
        : undefined;
      const isReplay = errorEventKey !== undefined
        && appliedErrorEventKeys.has(errorEventKey);
      if (errorEventKey && !isReplay) {
        appliedErrorEventKeys.add(errorEventKey);
      }
      if (!isReplay) {
        state.messages.push({
          role: 'agent',
          text: data.message,
          isError: true,
          errorEventKey,
        });
      }
    }
    state.sending = false;
    // Do not optimistically re-enable canSend here: an error from the
    // SDK does not necessarily mean the backend turn has ended. The
    // turn_status event (or the next /state poll) is the authoritative
    // signal that the agent is no longer working.
    if (state.sessionId && !isTerminalSessionStatus(state.status)) {
      state.liveSession = {
        ...state.liveSession,
        canCancel: true,
        isActiveSession: true,
      };
    }
  }

  function handleSessionEnd(event: Event): void {
    const data = parseSseEventData<{ status?: unknown }>(event);
    const endedConversationId = state.conversationId;
    buildState.finishLastStep();
    freezeActivities();
    state.sending = false;
    if (data && typeof data.status === 'string') {
      state.status = data.status as SessionStatus;
    }
    state.sessionId = null;
    clearLiveSessionState();
    disconnect();
    // Reconcile from durable history in case the final chat/tool events were
    // missed or arrived out of order before the stream closed.
    if (endedConversationId) {
      void loadHistory(endedConversationId).catch(() => {
        // Non-fatal: the existing transcript remains visible, and a manual
        // reload or later history open will reconcile persisted messages.
      });
    }
  }

  // ── Connection lifecycle ──

  // The stream fell behind and dropped events. Only when the server explicitly
  // marks it recoverable does the ring buffer still hold the gap, letting us
  // reconnect from our cursor; otherwise (or against an older server that omits
  // the flag) we reload durable history from the latest counter. Defaulting a
  // missing flag to unrecoverable is the safe choice: it can never loop (a
  // cursor resubscribe that keeps overflowing), only do a heavier reload.
  function handleBufferOverflow(event: Event): void {
    const data = parseSseEventData<{ recoverable?: unknown }>(event);
    const recoverable = !!data && data.recoverable === true;
    void recoverAfterBufferOverflow(recoverable);
  }

  function handleStreamOpen(): void {
    clearReconnectErrorTimer();
    clearClosedStreamReconnectTimer();
    markStreamActivity();
    state.connected = true;
    emit();
  }

  function handleStreamError(): void {
    state.connected = false;
    emit();
    // If the connection is permanently closed (browser gave up
    // reconnecting), actively rebuild the stream from the last delivered
    // event instead of waiting for the next send to trigger replay.
    if (eventSource && eventSource.readyState === EventSource.CLOSED) {
      clearReconnectErrorTimer();
      scheduleClosedStreamReconnect();
      return;
    }
    if (state.sending && !reconnectErrorTimer) {
      reconnectErrorTimer = setTimeout(() => {
        reconnectErrorTimer = null;
        unblockSendingIfDisconnected();
      }, EVENTSOURCE_RECONNECT_GRACE_MS);
    }
  }

  /**
   * Subscribes to the SSE event stream for the current session.
   */
  function subscribe(lastEventId?: number | null): void {
    // Never open an EventSource (with its listeners) after the store is
    // disposed — the provider is gone, so it would leak until GC.
    if (disposed) return;
    const sessionId = state.sessionId;
    if (!sessionId) return;
    clearClosedStreamReconnectTimer();
    // Close any stale connection before creating a new one.
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    suspendedWhileHidden = false;
    liveSessionLostWhileHidden = false;
    if (
      lastEventId != null
      && (lastSeenEventId === null || lastEventId > lastSeenEventId)
    ) {
      lastSeenEventId = lastEventId;
    }

    const encodedSessionId = encodeURIComponent(sessionId);
    const params = new URLSearchParams();
    if (lastEventId != null) {
      params.set('last_event_id', String(lastEventId));
    }
    eventSource = new EventSource(
      `/api/sessions/${encodedSessionId}/events${params.size ? `?${params.toString()}` : ''}`,
      { withCredentials: true },
    );

    // Every internal listener records the delivered event id so a
    // hidden-tab suspension can resume exactly where the stream left off.
    const source = eventSource;
    const addListener = (
      eventName: string,
      handler: (event: Event) => void,
    ): void => {
      source.addEventListener(eventName, (event: Event) => {
        // Any delivered frame — including heartbeats and overflow notices —
        // proves the stream is alive, so refresh the liveness timestamp.
        markStreamActivity();
        // A buffer_overflow event has the id of the dropped event. Advancing
        // the replay cursor to that id would skip the event we are reconnecting
        // to recover.
        if (eventName !== 'buffer_overflow') {
          recordLastSeenEventId(event);
        }
        handler(event);
        // One snapshot per delivered event: handlers mutate `state` in place,
        // then emit once at this subscription boundary.
        emit();
      });
    };

    // Heartbeats carry no payload; they exist purely to keep the connection
    // warm, so the noop handler just lets the wrapper refresh liveness.
    addListener('heartbeat', () => {});
    addListener('stream_start', handleStreamStart);
    addListener('stream_delta', handleStreamDelta);
    addListener('chat', handleChat);
    addListener('message_delivery', handleMessageDelivery);
    addListener('tool_call', handleToolCall);
    addListener('tool_result', handleToolResult);
    addListener('agent_status', handleAgentStatus);
    addListener('prover_batch_status', handleProverBatchStatus);
    addListener('work_group_status', handleWorkGroupStatus);
    addListener('subagent_stream_delta', handleSubagentStreamDelta);
    addListener('subagent_message', handleSubagentMessage);
    addListener('subagent_text', handleSubagentText);
    addListener('session_status', handleSessionStatus);
    addListener('turn_status', handleTurnStatus);
    addListener('session_result', handleSessionResult);
    addListener('error', handleErrorEvent);
    addListener('permission_request', handlePermissionRequest);
    addListener('permission_resolved', handlePermissionResolved);
    addListener('build_snapshot', handleBuildSnapshot);
    addListener('session_end', handleSessionEnd);
    addListener('build_status', handleBuildStatus);
    addListener('buffer_overflow', handleBufferOverflow);

    // Apply any externally registered listeners to the new EventSource.
    for (const { event, handler } of externalListeners) {
      eventSource.addEventListener(event, handler);
    }

    eventSource.onopen = handleStreamOpen;
    eventSource.onerror = handleStreamError;

    // A resubscribe can race a tab going hidden (e.g. a buffer-overflow
    // reconnect); re-arm the suspension so the stream is still released.
    if (typeof document !== 'undefined' && document.hidden) {
      scheduleHiddenSuspend();
    }

    // Begin (or continue) policing this session's stream liveness. Idempotent.
    // Seed the timestamp so the fresh connection gets a full stall window to
    // open and deliver its first frame before being considered dead.
    markStreamActivity();
    startLivenessPoll();
  }

  /**
   * Creates a new backend session with an initial message.
   */
  async function createSession(
    initialMessage: string,
    resumeFromJobId?: string | null,
    contextAttachments: ChatContextAttachment[] = [],
  ): Promise<void> {
    sessionCreationGeneration += 1;
    const creationGeneration = sessionCreationGeneration;
    invalidateHistoryLoads();
    clearHistoryView();
    // Fresh session: drop any dedup ids carried over from a previously viewed
    // transcript so the sets only reflect this session's live events.
    appliedToolUseIds.clear();
    appliedAssistantTurnIds.clear();
    finalizedAssistantTurnIds.clear();
    appliedSubagentEventIds.clear();
    appliedSubagentMessageIds.clear();
    appliedErrorEventKeys.clear();
    assistantStreamState.resetStreamText();
    // Latch the running control before the request leaves the browser, so the
    // composer becomes that control during session startup rather than only
    // after the backend has created the session.
    state.autonomousRunActive = true;
    emit();
    let response: SessionCreateResponse;
    try {
      response = await createSessionRequest({
        repository_owner: repositoryOwner,
        repository_name: repositoryName,
        blueprint_name: blueprintName,
        initial_message: initialMessage,
        resume_from_conversation_id: resumeFromJobId || null,
        ...contextAttachmentPayload(contextAttachments),
      });
    } catch (createError) {
      if (creationGeneration !== sessionCreationGeneration) return;
      throw createError;
    }
    if (creationGeneration !== sessionCreationGeneration) {
      await cancelCreatedSession(response);
      return;
    }
    state.sessionId = response.session_id;
    state.conversationId = response.conversation_id;
    state.currentJobId = response.agent_job_id;
    state.status = response.status;
    state.autonomousRunActive = true;
    // Keep the turn busy until the authoritative turn_status=false event.
    // Clearing here creates an idle frame between the POST response and the
    // first SSE event, making autonomous controls flicker back to the composer.
    activeSessionEventCounter = null;
    lastSeenEventId = null;
    applyLiveSessionState(response);
    emit();
    notifySessionHistoryChanged(response.conversation_id);
    subscribe();
  }

  /**
   * Sends a user message. On the first message, creates a session.
   * On subsequent messages, forwards to the running session.
   */
  async function send(
    text: string,
    createScrollFunction?: () => () => void,
    contextAttachments: ChatContextAttachment[] = [],
  ): Promise<boolean> {
    return sendInternal(text, createScrollFunction, contextAttachments);
  }

  async function sendInternal(
    text: string,
    createScrollFunction?: () => () => void,
    contextAttachments: ChatContextAttachment[] = [],
  ): Promise<boolean> {
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (state.sessionId && shouldReconnectEventSource()) {
      await reconcileClosedStreamBeforeSend();
    }
    // A live running session accepts steering while its current turn is busy.
    // Only suppress duplicate creation attempts before a session id exists.
    if (state.sending && !state.sessionId) return false;

    state.suggestion = null;
    const wasLiveSend = !!state.sessionId;
    const sendingBeforeRequest = state.sending;
    const liveSessionBeforeRequest = state.liveSession;
    let replacementCreateAttempted = false;
    let optimisticMessage: ChatMessage | null = null;
    let scrollFunction: (() => void) | null = null;

    let resumeFromConversationId: string | null = null;
    if (state.viewingConversationId) {
      invalidateHistoryLoads();
      resumeFromConversationId = state.viewingConversationId;
      disconnect();
      state.activities = [];
      state.buildHistory = [];
      state.sessionId = null;
      state.currentJobId = null;
      clearHistoryView();
    }

    try {
      if (!state.sessionId) {
        // Capture the old turn before the optimistic row changes the rendered
        // latest id. The store owns this decision because it may have awaited
        // live-history reconciliation since the component rendered.
        scrollFunction = createScrollFunction?.() ?? null;
        optimisticMessage = createUserMessage(trimmed, contextAttachments);
        state.messages.push(optimisticMessage);
        state.sending = true;
        state.liveSession = {
          ...state.liveSession,
          canSend: false,
        };
        emit();
        if (scrollFunction) {
          pendingScrollCallback = scrollFunction;
          scrollFunction();
        }
        if (!resumeFromConversationId) {
          resumeFromConversationId = shouldResumeFromPriorConversation()
            ? state.conversationId
            : null;
        }
        await createSession(trimmed, resumeFromConversationId, contextAttachments);
      } else {
        const sessionId = state.sessionId;
        const steeringActiveWork = liveSessionBeforeRequest.turnActive
          || Boolean(liveSessionBeforeRequest.activeProverBatchId)
          || liveSessionBeforeRequest.activeWorkGroupCount > 0;
        try {
          const replayAfterEventId = lastSeenEventId ?? activeSessionEventCounter ?? 0;
          const shouldReconnectStream = shouldReconnectEventSource();
          optimisticMessage = createUserMessage(trimmed, contextAttachments);
          optimisticMessage.deliveryState = 'queued';
          if (!steeringActiveWork) {
            optimisticMessage.optimisticTurn = true;
            scrollFunction = createScrollFunction?.() ?? null;
          }
          state.messages.push(optimisticMessage);
          state.sending = true;
          state.liveSession = {
            ...state.liveSession,
            canSend: false,
            canCancel: !!state.sessionId,
            isActiveSession: !!state.sessionId,
          };
          emit();
          if (scrollFunction) {
            pendingScrollCallback = scrollFunction;
            scrollFunction();
          }
          const response = await sendSessionMessage(sessionId, {
            content: trimmed,
            ...contextAttachmentPayload(contextAttachments),
          });
          if (
            optimisticMessage
            && state.messages.includes(optimisticMessage)
            && typeof response.message_id === 'string'
          ) {
            assistantStreamState.setUserMessageIdentity(
              optimisticMessage,
              response.message_id,
              response.delivery_state,
            );
          }
          if (!steeringActiveWork) {
            state.autonomousRunActive = true;
          }
          const conversationId = state.conversationId;
          if (conversationId) {
            notifySessionHistoryChanged(conversationId);
          }
          emit();
          if (shouldReconnectStream) {
            const sessionState = await fetchSessionState(sessionId);
            activeSessionEventCounter = sessionState.event_counter;
            subscribe(replayAfterEventId);
          }
        } catch (messageError) {
          // 400 = session finished but still in the memory grace window.
          // 404 = session already evicted from memory after the grace window
          // (orphan cancel after SSE disconnect, idle timeout, or server restart).
          // In both cases we can resume the conversation in a new session.
          const conversationId = state.conversationId;
          const canResumeTerminatedSession = messageError instanceof ApiError
            && (messageError.status === 400 || messageError.status === 404)
            && !!conversationId;
          if (!canResumeTerminatedSession) throw messageError;

          state.sessionId = null;
          state.status = SESSION_STATUS.COMPLETED;
          state.autonomousRunActive = false;
          activeSessionEventCounter = null;
          lastSeenEventId = null;
          clearLiveSessionState();
          replacementCreateAttempted = true;
          // A stale live session can reject what looked like steering. Its
          // replacement is a genuine next turn, so promote both its routing
          // hint and scroll callback using the store's authoritative result.
          if (optimisticMessage) optimisticMessage.optimisticTurn = true;
          if (!scrollFunction) {
            scrollFunction = createScrollFunction?.() ?? null;
            emit();
            if (scrollFunction) {
              pendingScrollCallback = scrollFunction;
              scrollFunction();
            }
          }
          await createSession(trimmed, conversationId, contextAttachments);
        }
      }
    } catch (sendError) {
      const errorMessage = sendError instanceof Error
        ? sendError.message
        : String(sendError);
      state.messages.push({
        role: 'agent',
        text: `Failed to send: ${errorMessage}`,
        isError: true,
      });
      if (optimisticMessage) {
        state.messages = state.messages.filter(
          (message) => message !== optimisticMessage,
        );
      }
      // A live steering POST races the SSE stream by design. Do not restore
      // its pre-request snapshot here: turn/group/prover state may have moved
      // forward while the request was in flight. New-session creation has no
      // concurrent stream yet, so its local optimistic state is safe to undo.
      if (!wasLiveSend) {
        state.sending = sendingBeforeRequest;
        state.liveSession = liveSessionBeforeRequest;
      } else if (replacementCreateAttempted && !state.sessionId) {
        // The old session is gone and replacement creation failed. Never
        // restore its busy state: doing so leaves sending=true with no session
        // capable of emitting the turn-ended event that would clear it.
        state.sending = false;
        clearLiveSessionState();
      } else if (state.sessionId) {
        // A failed steering request may race newer SSE state. Derive the busy
        // bit from that current state instead of restoring a stale snapshot or
        // leaving the optimistic `sending=true` latched forever.
        const hasActiveWork = state.liveSession.turnActive
          || Boolean(state.liveSession.activeProverBatchId)
          || state.liveSession.activeWorkGroupCount > 0;
        state.sending = hasActiveWork;
        state.liveSession = {
          ...state.liveSession,
          canSend: !hasActiveWork,
          canCancel: true,
          isActiveSession: true,
        };
      }
      if (!state.sessionId) state.autonomousRunActive = false;
      emit();
      if (scrollFunction) scrollFunction();
      return false;
    }
    return true;
  }

  /**
   * Loads a persisted session transcript into the chat panel.
   */
  async function loadHistory(
    jobId: string,
    options: { replayFromLatest?: boolean } = {},
  ): Promise<SessionHistoryDetail> {
    if (isShowingStaticHistory(jobId)) {
      return state.historySession as SessionHistoryDetail;
    }

    const loadVersion = historyLoadVersion + 1;
    historyLoadVersion = loadVersion;
    disconnect();
    buildState.reset();
    let liveSession: ConversationLiveSessionResponse | null = null;
    let replayAfterEventId: number | null = null;
    try {
      const liveSessionResponse = await fetchLiveSessionForConversation(
        jobId,
      ) as ConversationLiveSessionResponse | undefined;
      if (liveSessionResponse) {
        liveSession = liveSessionResponse;
        // Replay from the persisted boundary, not the latest event_counter, so
        // the in-flight (not-yet-saved) turn streams in instead of the panel
        // staying silent. Fall back to event_counter for older backends.
        replayAfterEventId = liveSessionResponse.last_persisted_event_id
          ?? liveSessionResponse.event_counter;
      }
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) {
        throw error;
      }
    }
    const detail = liveSession
      ? await fetchHistoryDetailOnce(jobId)
      : getCachedHistoryDetail(jobId) ?? await fetchHistoryDetailOnce(jobId);
    const attachToLiveSession = Boolean(
      liveSession && shouldAttachLiveSession(liveSession),
    );
    // Even when a newer click supersedes this load, retain an immutable/static
    // response so returning to it does not repeat a multi-megabyte download.
    if (!attachToLiveSession) rememberHistoryDetail(detail);
    if (loadVersion !== historyLoadVersion) {
      return detail;
    }

    state.activities = [];
    state.subagents = [];
    state.sending = false;

    // Prefer the cursor read with the transcript snapshot over the
    // separately-fetched live-session cursor. The snapshot cursor cannot lead
    // the rows it returned; if it lags, stable replay ids dedupe overlap.
    const replayCursor = options.replayFromLatest
      ? liveSession?.event_counter ?? replayAfterEventId
      : detail.last_persisted_event_id ?? replayAfterEventId;

    // Only attach to sessions that are still active and doing live work.
    // Cancelled sessions can remain visible briefly through history/reconnect
    // races; rendering them as live leaves the Stop UI stuck on a dead run.
    if (liveSession && attachToLiveSession) {
      historyDetailCache.delete(jobId);
      attachLiveSession(detail, liveSession, replayCursor);
      return detail;
    }

    state.conversationId = detail.id;
    state.currentJobId = null;
    state.sessionId = null;
    state.status = historyStatusToSessionStatus(detail.status);
    state.autonomousRunActive = false;
    activeSessionEventCounter = null;
    lastSeenEventId = null;
    clearLiveSessionState();
    state.historySession = detail;
    state.buildHistory = reconstructHistoryBuilds(detail.messages);
    state.viewingConversationId = detail.id;
    // Static view of an ended/owned-elsewhere session: no live run, so an
    // un-terminated subagent reads as finished rather than running.
    applyPersistedHistory(detail, false);
    emit();
    return detail;
  }

  function getCachedHistoryDetail(
    conversationId: string,
  ): SessionHistoryDetail | null {
    const detail = historyDetailCache.get(conversationId);
    if (!detail) return null;
    historyDetailCache.delete(conversationId);
    historyDetailCache.set(conversationId, detail);
    return detail;
  }

  function rememberHistoryDetail(detail: SessionHistoryDetail): void {
    historyDetailCache.delete(detail.id);
    historyDetailCache.set(detail.id, detail);
    while (historyDetailCache.size > HISTORY_DETAIL_CACHE_LIMIT) {
      const oldestConversationId = historyDetailCache.keys().next().value;
      if (!oldestConversationId) break;
      historyDetailCache.delete(oldestConversationId);
    }
  }

  function fetchHistoryDetailOnce(
    conversationId: string,
  ): Promise<SessionHistoryDetail> {
    const pending = historyDetailRequests.get(conversationId);
    if (pending) return pending;
    const request = (fetchSessionHistoryDetail(
      conversationId,
    ) as Promise<SessionHistoryDetail>).finally(() => {
      if (historyDetailRequests.get(conversationId) === request) {
        historyDetailRequests.delete(conversationId);
      }
    });
    historyDetailRequests.set(conversationId, request);
    return request;
  }

  function mergeSubagentTimeline(
    parentToolUseId: string,
    detail: SubagentHistoryDetail,
    rootDetail: SessionHistoryDetail,
  ): void {
    state.subagents = mergePersistedSubagentTimeline(
      state.subagents,
      parentToolUseId,
      detail,
      rootDetail,
      state.sessionId !== null,
      collectOptimisticTurnMessageIds(state.messages),
    );
    emit();
  }

  /** Load and cache a persisted subagent timeline the first time it is opened. */
  async function loadSubagentHistory(parentToolUseId: string): Promise<void> {
    const requestGeneration = generation;
    const conversationId = state.viewingConversationId ?? state.conversationId;
    const target = state.subagents.find(
      (subagent) => subagent.parentToolUseId === parentToolUseId,
    );
    const rootDetail = state.historySession;
    if (
      !conversationId
      || !rootDetail
      || !target
      || target.historyLoaded !== false
      || target.historyLoading
    ) return;

    const cacheKey = `${conversationId}:${parentToolUseId}`;
    state.subagents = state.subagents.map((subagent) =>
      subagent.parentToolUseId === parentToolUseId
        ? { ...subagent, historyLoading: true, historyError: null }
        : subagent
    );
    emit();

    try {
      let detail = subagentHistoryCache.get(cacheKey);
      if (!detail) {
        let pending = subagentHistoryRequests.get(cacheKey);
        if (!pending) {
          pending = fetchSubagentHistory(
            conversationId,
            parentToolUseId,
          ) as Promise<SubagentHistoryDetail>;
          subagentHistoryRequests.set(cacheKey, pending);
        }
        try {
          detail = await pending;
        } finally {
          if (subagentHistoryRequests.get(cacheKey) === pending) {
            subagentHistoryRequests.delete(cacheKey);
          }
        }
        subagentHistoryCache.set(cacheKey, detail);
        while (subagentHistoryCache.size > SUBAGENT_HISTORY_CACHE_LIMIT) {
          const oldestKey = subagentHistoryCache.keys().next().value;
          if (!oldestKey) break;
          subagentHistoryCache.delete(oldestKey);
        }
      } else {
        subagentHistoryCache.delete(cacheKey);
        subagentHistoryCache.set(cacheKey, detail);
      }
      if (
        disposed
        || generation !== requestGeneration
        ||
        (state.viewingConversationId ?? state.conversationId) !== conversationId
      ) return;
      mergeSubagentTimeline(parentToolUseId, detail, rootDetail);
    } catch {
      if (
        disposed
        || generation !== requestGeneration
        ||
        (state.viewingConversationId ?? state.conversationId) !== conversationId
      ) return;
      state.subagents = state.subagents.map((subagent) =>
        subagent.parentToolUseId === parentToolUseId
          ? {
              ...subagent,
              historyLoading: false,
              historyError: 'Could not load this timeline. Close and retry.',
            }
          : subagent
      );
      emit();
    }
  }

  /**
   * Requests cancellation of the active session, if one exists.
   */
  async function stop(): Promise<void> {
    const sessionId = state.sessionId;
    if (!sessionId) {
      if (state.sending) {
        sessionCreationGeneration += 1;
        settleStoppedSession();
      }
      return;
    }

    const canSendBeforeStop = state.liveSession.canSend;
    const canCancelBeforeStop = state.liveSession.canCancel;
    const displayStatusBeforeStop = state.liveSession.displayStatus;
    const stoppingStatus = 'Stopping…';
    state.liveSession = {
      ...state.liveSession,
      canSend: false,
      canCancel: false,
      displayStatus: stoppingStatus,
    };
    emit();
    try {
      const response = await cancelSession(sessionId);
      for (const message of [...state.messages]) {
        if (!message.messageId) continue;
        const deliveryState = response.message_delivery_states?.[message.messageId];
        if (
          isDeliveryState(deliveryState)
          && message.deliveryState !== deliveryState
        ) {
          updateUserMessageDeliveryState(state.messages, message, deliveryState);
        }
      }
      settleStoppedSession();
    } catch (stopError) {
      // A 404 means the backend already evicted the session (it finished
      // or timed out) — nothing to cancel, so don't surface an error.
      if (stopError instanceof ApiError && stopError.status === 404) {
        settleStoppedSession();
        return;
      }
      const errorMessage = stopError instanceof Error
        ? stopError.message
        : String(stopError);
      if (
        state.sessionId === sessionId
        && state.liveSession.displayStatus === stoppingStatus
      ) {
        state.liveSession = {
          ...state.liveSession,
          canSend: canSendBeforeStop,
          canCancel: canCancelBeforeStop,
          displayStatus: displayStatusBeforeStop,
        };
      }
      state.messages.push({
        role: 'agent',
        text: `Failed to stop: ${errorMessage}`,
        isError: true,
      });
      emit();
    }
  }

  /**
   * Clears the current transcript/history view so the next message
   * starts a fresh agent session.
   */
  async function prepareNewAgentSession(): Promise<void> {
    invalidateHistoryLoads();
    // Starting a new chat only detaches this panel. The current session is
    // durable and may keep running autonomously in the background; cancelling
    // it here made a navigation action destructive.
    sessionCreationGeneration += 1;
    disconnect();
    buildState.reset();
    state.messages = [];
    state.suggestion = null;
    state.activities = [];
    state.subagents = [];
    state.buildHistory = [];
    appliedToolUseIds.clear();
    appliedAssistantTurnIds.clear();
    finalizedAssistantTurnIds.clear();
    appliedSubagentEventIds.clear();
    appliedSubagentMessageIds.clear();
    appliedErrorEventKeys.clear();
    assistantStreamState.reset();
    state.sending = false;
    state.conversationId = null;
    state.currentJobId = null;
    state.sessionId = null;
    state.status = null;
    state.autonomousRunActive = false;
    activeSessionEventCounter = null;
    lastSeenEventId = null;
    clearLiveSessionState();
    pendingScrollCallback = null;
    clearHistoryView();
    state.focusRequestToken += 1;
    emit();
  }

  // ── Hidden-tab stream suspension ──

  function recordLastSeenEventId(event: Event): void {
    const rawEventId = (event as MessageEvent).lastEventId;
    if (!rawEventId) return;
    const parsedEventId = Number.parseInt(rawEventId, 10);
    // Snapshot/overflow events are sent with no id line, so lastEventId keeps
    // the previous real id; guard against any non-positive value defensively so
    // the cursor only ever advances on genuine, id-bearing events.
    if (!Number.isFinite(parsedEventId) || parsedEventId <= 0) return;
    if (lastSeenEventId === null || parsedEventId > lastSeenEventId) {
      lastSeenEventId = parsedEventId;
    }
  }

  function handleDocumentVisibilityChange(): void {
    if (document.hidden) {
      scheduleHiddenSuspend();
    } else {
      resumeAfterHidden();
    }
  }

  function scheduleHiddenSuspend(): void {
    if (disposed || hiddenSuspendTimer !== null || !eventSource) return;
    hiddenSuspendTimer = setTimeout(() => {
      hiddenSuspendTimer = null;
      if (disposed) return;
      suspendStreamWhileHidden();
    }, HIDDEN_STREAM_DISCONNECT_DELAY_MS);
  }

  function clearHiddenSuspendTimer(): void {
    if (hiddenSuspendTimer !== null) {
      clearTimeout(hiddenSuspendTimer);
      hiddenSuspendTimer = null;
    }
  }

  function suspendStreamWhileHidden(): void {
    if (!eventSource) return;
    disconnect({ preserveStreamState: true });
    suspendedWhileHidden = true;
    startHiddenKeepalive();
  }

  function startHiddenKeepalive(): void {
    if (disposed || hiddenKeepaliveTimer !== null || !state.sessionId) return;
    // Ping immediately: hidden-tab timers are throttled (Chrome fires them
    // at most once a minute), so a later tick could land after the orphan
    // grace. The immediate ping claims the longer hidden-tab lease first.
    void sendSessionKeepalive();
    hiddenKeepaliveTimer = setInterval(() => {
      void sendSessionKeepalive();
    }, HIDDEN_SESSION_KEEPALIVE_INTERVAL_MS);
  }

  function stopHiddenKeepalive(): void {
    if (hiddenKeepaliveTimer !== null) {
      clearInterval(hiddenKeepaliveTimer);
      hiddenKeepaliveTimer = null;
    }
  }

  async function sendSessionKeepalive(): Promise<void> {
    if (disposed) return;
    const sessionId = state.sessionId;
    if (!sessionId) {
      stopHiddenKeepalive();
      return;
    }
    try {
      await keepaliveSession(sessionId);
    } catch (keepaliveError) {
      if (disposed) return;
      // 400/404 = the session finished or was evicted while hidden; the
      // resume path reloads the conversation instead of resubscribing.
      // Other failures (network blips) leave the interval to retry.
      if (
        keepaliveError instanceof ApiError
        && (keepaliveError.status === 400 || keepaliveError.status === 404)
      ) {
        liveSessionLostWhileHidden = true;
        stopHiddenKeepalive();
      }
    }
  }

  function resumeAfterHidden(): void {
    clearHiddenSuspendTimer();
    stopHiddenKeepalive();
    if (!suspendedWhileHidden) return;
    suspendedWhileHidden = false;
    if (liveSessionLostWhileHidden) {
      liveSessionLostWhileHidden = false;
      // The live session ended while the stream was down; reload the
      // conversation so the final messages and settled status appear.
      const conversationId = state.conversationId;
      if (conversationId) {
        void loadHistory(conversationId);
      }
      return;
    }
    if (state.sessionId) {
      subscribe(lastSeenEventId ?? activeSessionEventCounter);
    }
  }

  // ── Stream liveness safety net ──

  function markStreamActivity(): void {
    lastStreamActivityMs = Date.now();
  }

  function startLivenessPoll(): void {
    if (
      disposed
      || livenessPollTimer !== null
      || typeof window === 'undefined'
      || !ownsScopeCleanup
    ) {
      return;
    }
    livenessPollTimer = setInterval(
      checkStreamLiveness,
      STREAM_LIVENESS_POLL_INTERVAL_MS,
    );
  }

  function stopLivenessPoll(): void {
    if (livenessPollTimer !== null) {
      clearInterval(livenessPollTimer);
      livenessPollTimer = null;
    }
    lastStreamActivityMs = null;
  }

  function checkStreamLiveness(): void {
    if (disposed) {
      stopLivenessPoll();
      return;
    }
    // Nothing live to watch: stop the poller.
    if (!state.sessionId || isTerminalSessionStatus(state.status)) {
      stopLivenessPoll();
      return;
    }
    // Hidden tabs deliberately release the stream; the suspend/keepalive path
    // owns recovery there, so leave them alone (and don't count the gap as a
    // stall — the resume reseeds activity).
    if (
      (typeof document !== 'undefined' && document.hidden)
      || suspendedWhileHidden
    ) {
      return;
    }
    // No live connection at all (suspend torn it down, or it was never rebuilt):
    // revive it from our cursor.
    if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
      scheduleClosedStreamReconnect();
      return;
    }
    // Connection object exists (OPEN or CONNECTING) but has gone silent past the
    // stall window — no deltas and, crucially, no heartbeats. That means a dead
    // socket the browser hasn't surfaced, or a proxy buffering the response.
    // Rebuild from our cursor; the backoff guard in scheduleClosedStreamReconnect
    // coalesces overlapping attempts.
    if (
      lastStreamActivityMs !== null
      && Date.now() - lastStreamActivityMs >= STREAM_STALL_MS
    ) {
      scheduleClosedStreamReconnect();
    }
  }

  function handleWindowFocusOrPageshow(): void {
    // Focus and bfcache restore can occur without a visibilitychange (the only
    // event resumeAfterHidden was wired to). Resume a suspended stream and run
    // an immediate liveness check so output is not stranded until the next send.
    if (typeof document !== 'undefined' && document.hidden) return;
    resumeAfterHidden();
    checkStreamLiveness();
  }

  /** Closes the SSE connection and resets connection state. */
  function disconnect(
    options: { preserveStreamState?: boolean } = {},
  ): void {
    clearReconnectErrorTimer();
    clearClosedStreamReconnectTimer();
    clearHiddenSuspendTimer();
    stopHiddenKeepalive();
    suspendedWhileHidden = false;
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    if (!options.preserveStreamState) {
      // A genuine teardown (not a hidden-tab suspend): stop policing liveness.
      stopLivenessPoll();
      assistantStreamState.resetStreamText();
    }
    state.connected = false;
    emit();
  }

  // ── Provider-owned lifecycle ──

  /**
   * Arms the document/window listeners and the liveness poller ownership.
   * Idempotent; safe under React 19 StrictMode's mount → dispose → mount.
   */
  function mount(): void {
    if (mounted) return;
    mounted = true;
    disposed = false;
    // Only now is it safe to arm listeners and pollers because dispose() owns
    // their teardown.
    ownsScopeCleanup = true;
    if (typeof document !== 'undefined') {
      document.addEventListener(
        'visibilitychange',
        handleDocumentVisibilityChange,
      );
    }
    // focus/pageshow cover resume cases visibilitychange can miss (window
    // refocus, back/forward bfcache restore).
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleWindowFocusOrPageshow);
      window.addEventListener('pageshow', handleWindowFocusOrPageshow);
    }
  }

  function dispose(): void {
    disconnect();
    clearReconnectErrorTimer();
    clearClosedStreamReconnectTimer();
    stopLivenessPoll();
    pendingScrollCallback = null;
    buildState.reset();
    historyDetailCache.clear();
    historyDetailRequests.clear();
    subagentHistoryCache.clear();
    subagentHistoryRequests.clear();
    if (typeof document !== 'undefined') {
      document.removeEventListener(
        'visibilitychange',
        handleDocumentVisibilityChange,
      );
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', handleWindowFocusOrPageshow);
      window.removeEventListener('pageshow', handleWindowFocusOrPageshow);
    }
    ownsScopeCleanup = false;
    mounted = false;
    // Block any in-flight async continuation (loadHistory, recover, keepalive)
    // from mutating + notifying after teardown; a later mount() re-enables it.
    disposed = true;
    // Bump the lifecycle token and invalidate the load/session-creation version
    // counters so any in-flight createSession / loadHistory / recover response
    // that resolves after teardown (even across a StrictMode re-mount that flips
    // `disposed` back to false) is recognized as stale and ignored — it must not
    // subscribe a dead stream or mutate state.
    generation += 1;
    historyLoadVersion += 1;
    sessionCreationGeneration += 1;
  }

  /**
   * Registers an event listener on the shared SSE connection.
   */
  function on(eventName: string, handler: (event: Event) => void): void {
    externalListeners.push({ event: eventName, handler });
    if (eventSource) {
      eventSource.addEventListener(eventName, handler);
    }
  }

  /**
   * Removes a previously registered event listener.
   */
  function off(eventName: string, handler: (event: Event) => void): void {
    const index = externalListeners.findIndex(
      (listener) => listener.event === eventName && listener.handler === handler,
    );
    if (index !== -1) externalListeners.splice(index, 1);
    if (eventSource) {
      eventSource.removeEventListener(eventName, handler);
    }
  }

  return {
    getSnapshot,
    subscribeStore,
    mount,
    dispose,
    send,
    stop,
    respondPermission,
    disconnect,
    loadHistory,
    loadSubagentHistory,
    prepareNewAgentSession,
    on,
    off,
  };
}

export type ChatStore = ReturnType<typeof createChatStore>;

/** The value `useChat()` returns: the reactive snapshot plus the actions. */
export interface ChatApi {
  state: ChatState;
  send: ChatStore['send'];
  stop: ChatStore['stop'];
  /** Answer a pending CLI permission prompt (allow / deny / a suggestion). */
  respondPermission: ChatStore['respondPermission'];
  disconnect: ChatStore['disconnect'];
  loadHistory: ChatStore['loadHistory'];
  loadSubagentHistory: ChatStore['loadSubagentHistory'];
  prepareNewAgentSession: ChatStore['prepareNewAgentSession'];
  on: ChatStore['on'];
  off: ChatStore['off'];
}

// ── Context and hook integration ──

const ChatContext = createContext<ChatStore | null>(null);

/**
 * Owns one chat store per blueprint and drives its mount/dispose lifecycle.
 *
 * The store is created with `useMemo` keyed on the blueprint identity, so
 * navigating between blueprints without unmounting swaps in a fresh store; the
 * mount effect disposes the previous one. Store creation is side-effect free,
 * so React 19 StrictMode's double-invocation is harmless — only the mounted
 * copy opens the EventSource / attaches listeners.
 */
export function ChatProvider({
  options,
  children,
}: {
  options: ChatOptions;
  children: ReactNode;
}) {
  const { repositoryOwner, repositoryName, blueprintName } = options;
  const optionsKey = JSON.stringify([repositoryOwner, repositoryName, blueprintName]);
  const store = useMemo(
    () => createChatStore({ repositoryOwner, repositoryName, blueprintName }),
    // Recreate only when the blueprint identity changes, not on every new
    // `options` object reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [optionsKey],
  );

  useEffect(() => {
    store.mount();
    return () => {
      store.dispose();
    };
  }, [store]);

  return <ChatContext.Provider value={store}>{children}</ChatContext.Provider>;
}

/**
 * Reads the blueprint's chat store. Must be called inside a `ChatProvider`.
 *
 * Returns the reactive `state` snapshot (via `useSyncExternalStore`) plus the
 * store's imperative actions (`send`, `stop`, `loadHistory`,
 * `prepareNewAgentSession`, `disconnect`) and the SSE
 * listener registry (`on`/`off`) the blueprint event stream piggybacks on.
 */
export function useChat(): ChatApi {
  const store = useContext(ChatContext);
  if (!store) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  const state = useSyncExternalStore(
    store.subscribeStore,
    store.getSnapshot,
    store.getSnapshot,
  );
  return {
    state,
    send: store.send,
    stop: store.stop,
    respondPermission: store.respondPermission,
    disconnect: store.disconnect,
    loadHistory: store.loadHistory,
    loadSubagentHistory: store.loadSubagentHistory,
    prepareNewAgentSession: store.prepareNewAgentSession,
    on: store.on,
    off: store.off,
  };
}
