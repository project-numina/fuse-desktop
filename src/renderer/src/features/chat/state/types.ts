/**
 * Shared types and session-status helpers for the chat store.
 *
 * These are split out of `state/chat/store.tsx` so the store, the SSE helpers, the
 * activity formatters, and history reconstruction can all share one definition
 * without circular imports.
 *
 * This module is the CANONICAL home for the chat/session value types
 * (`ExecutionMode`, `SessionStatus`, `LiveBuildStatus`, `SessionStateResponse`,
 * etc.). `lib/api/sessions.ts` currently carries structurally-identical copies
 * for its own self-containment; a later cleanup can dedupe them against these.
 */

export interface ActivityItem {
  tool: string;
  summary: string;
  toolUseId?: string;
  parentToolUseId?: string;
  anchorTurnId?: string | null;
  anchorAfterMessageCount?: number;
  rawInput?: Record<string, unknown>;
  isError?: boolean;
  result?: string | null;
  /** Hide from display (e.g. metadata-only file operations). */
  hidden?: boolean;
  /**
   * Monotonic chronological position shared with SubagentStream, used to
   * interleave parent tool calls and subagent cards within an anchor bucket.
   */
  order?: number;
}

export interface PersistedChatMessage {
  id: string;
  role: 'user' | 'agent' | 'tool';
  content: string;
  created_at: string;
  delivery_state?: MessageDeliveryState | null;
  context_attachments?: ChatContextAttachment[];
}

export type ChatAttachmentKind = 'backend_source' | 'repo_file';

export interface ChatAttachmentSelection {
  kind: string;
  start_page?: number;
  end_page?: number;
  start_line?: number;
  end_line?: number;
  [key: string]: unknown;
}

export interface ChatContextAttachment {
  id?: string;
  attachment_kind: ChatAttachmentKind;
  source_id?: string | null;
  artifact_kind?: string | null;
  repo_path?: string | null;
  display_name?: string;
  selection?: ChatAttachmentSelection;
  created_at?: string;
}

export interface ToolHistoryEvent {
  kind?: string;
  tool_use_id?: string;
  parent_tool_use_id?: string | null;
  tool?: string | null;
  input?: Record<string, unknown> | null;
  result?: string | null;
  is_error?: boolean | null;
  is_subagent?: boolean;
  model?: string | null;
  phase?: string | null;
  message?: string | null;
  /** Persisted subagent lifecycle status (kind === 'agent_status'). */
  status?: string | null;
  agent?: string | null;
  /** Persisted subagent message/final text. */
  text?: string | null;
  /** Stable identity for replay-deduping persisted subagent prose. */
  message_id?: string | null;
}

export type SessionStatus =
  | 'starting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Persisted jobs use `queued` where live sessions use `starting`. */
export type SessionHistoryStatus = Exclude<SessionStatus, 'starting'> | 'queued';

export const SESSION_STATUS = {
  STARTING: 'starting',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const satisfies Record<string, SessionStatus>;

export const TERMINAL_SESSION_STATUSES = new Set<SessionStatus>([
  SESSION_STATUS.COMPLETED,
  SESSION_STATUS.FAILED,
  SESSION_STATUS.CANCELLED,
]);

export function isTerminalSessionStatus(status: SessionStatus | null): boolean {
  return status !== null && TERMINAL_SESSION_STATUSES.has(status);
}

/** Translate the persisted job lifecycle into the live-session UI lifecycle. */
export function historyStatusToSessionStatus(
  status: SessionHistoryStatus,
): SessionStatus {
  return status === 'queued' ? SESSION_STATUS.STARTING : status;
}

export interface SessionHistoryDetail {
  attention_revision?: string;
  id: string;
  status: SessionHistoryStatus;
  blueprint_name: string | null;
  can_resume?: boolean;
  created_at: string;
  completed_at: string | null;
  background_started_at?: string | null;
  background_reviewed_at?: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_cost_usd: number | null;
  message_count: number;
  first_message: string | null;
  last_message: string | null;
  tier?: 'active' | 'waiting_for_review' | 'completed';
  background_updates?: string[];
  roadblocks?: string[];
  messages: PersistedChatMessage[];
  subagents?: PersistedSubagentSummary[];
  subagent_history_lazy?: boolean;
  // Replay cursor read with this transcript snapshot, when a live session
  // exists. Preferred over the live-session cursor for reconnect replay because
  // it cannot lead the loaded transcript; if it lags, assistant/tool replay is
  // applied idempotently by stable event ids.
  last_persisted_event_id?: number | null;
}

export interface PersistedSubagentSummary {
  parent_tool_use_id: string;
  tool_call_count: number;
  recent_tool_calls?: PersistedSubagentToolCall[];
  /** When the run's spawn was persisted, derived from that row's created_at. */
  started_at?: string | null;
  /** When the run first reached a terminal status; null if it never did. */
  ended_at?: string | null;
}

export interface PersistedSubagentToolCall {
  tool_use_id: string;
  tool: string;
  input?: Record<string, unknown>;
  created_at: string;
}

export interface SubagentHistoryDetail {
  parent_tool_use_id: string;
  messages: PersistedChatMessage[];
  started_at?: string | null;
  ended_at?: string | null;
}

export type ExecutionMode = 'foreground' | 'background';
export type LiveBuildStatus = 'not_started' | 'running' | 'done' | 'failed';

// ── Subagent stream state ──

/**
 * One assistant prose segment produced by a child agent.
 *
 * Only the child's *prose* reaches this list. `subagent_stream_delta` carries a
 * `delta_kind` discriminator and the store drops `thinking` deltas outright, so
 * a segment never holds raw chain of thought.
 */
export interface SubagentMessage {
  text: string;
  order: number;
  messageId?: string;
  /**
   * True while this segment is still being streamed token by token and no
   * durable `subagent_message` / `subagent_text` has confirmed it yet. Cleared
   * (or the segment dropped) at every boundary that ends the streamed message:
   * the child's next tool call, its durable text, or a terminal status.
   */
  streaming?: boolean;
}

export interface SubagentStream {
  parentToolUseId: string;
  anchorTurnId: string | null;
  anchorAfterMessageCount: number;
  description: string;
  /** Optional secondary label (e.g. "Pass 1") rendered as a chip on the card. */
  passLabel?: string;
  model: string | null;
  text: string;
  /** Ordered assistant prose segments interleaved with this agent's tool calls. */
  messages?: SubagentMessage[];
  toolCalls: ActivityItem[];
  /** Persisted count available before this subagent's timeline is downloaded. */
  toolCallCount?: number;
  /** False only for a persisted timeline that is still available on demand. */
  historyLoaded?: boolean;
  historyLoading?: boolean;
  historyError?: string | null;
  /**
   * Lifecycle of a synthetic child run. `queued` (waiting for a concurrency
   * slot) and `running` are live; `proved`/`failed` are prover outcomes;
   * `cancelled` is a user-stopped run; `done` is the neutral finished state for
   * non-prover children.
   */
  status: 'queued' | 'running' | 'done' | 'proved' | 'failed' | 'cancelled';
  /**
   * The spawning helper's `synthetic_for` tag (e.g. `prover`, `authoring`,
   * `explore`), used to render batch-specific chrome like the prover progress
   * header or the explore summary card.
   */
  synthetic?: string;
  /**
   * Stable id shared by every child produced by one authoring/prover tool
   * invocation. Unlike chronological launcher pairing, this remains correct
   * when two workflow calls overlap and their child events interleave.
   */
  batchId?: string;
  /** Structured MCP workflow call that launched this child. */
  launcherTool?: 'authoring-tools' | 'prover-tools';
  /**
   * The artifact a standing specialist is working (ADR 051): the Lean file for
   * a formalize pair, the source path for a draft_blueprint pair. Published on
   * both halves of a pair, and omitted when the work has no nameable artifact,
   * so it narrows a specialist's identity but never establishes it alone.
   */
  specialistTarget?: string;
  /**
   * Run id of the subagent that launched this one, when it was spawned by
   * another subagent rather than the orchestrator (a subagent-initiated explore,
   * ADR 037). Such cards render nested in the caller's timeline, not the main
   * transcript.
   */
  parentSubagentId?: string;
  /**
   * Monotonic chronological position shared with ActivityItem (set when the
   * subagent is spawned), used to interleave subagent cards with parent tool
   * calls within an anchor bucket.
   */
  order?: number;
  /**
   * Epoch milliseconds this run started: stamped when the client first sees
   * the run live, or read from the persisted spawn row on a reload. Absent
   * only for a run neither path could date.
   */
  startedAt?: number;
  /**
   * Epoch milliseconds this run reached a terminal status. Absent while it is
   * still going, and also for a run whose session ended without recording an
   * outcome. Those two are told apart by `status`, not by this field.
   */
  endedAt?: number;
}

export type SubagentWithSpawnIndex = SubagentStream & { spawnMessageIndex: number };

export interface BuildStep {
  label: string;
  status: 'running' | 'done' | 'pending';
}

export interface BuildActivity {
  title: string;
  status: 'running' | 'done' | 'failed';
  turnId: string | null;
  steps: BuildStep[];
}

export interface LiveSessionState {
  isActiveSession: boolean;
  canSend: boolean;
  canCancel: boolean;
  buildStatus: LiveBuildStatus;
  displayStatus: string | null;
  // Backend-authoritative "agent is currently working" flag. Derived from
  // session.turn_active on the backend and pushed via the turn_status SSE
  // event so the frontend can gate the chat input on a real signal instead
  // of inferring readiness from local sending state or build progress.
  turnActive: boolean;
  activeProverBatchId: string | null;
  activeProverBatchTotal: number;
  activeProverBatchCompleted: number;
  activeWorkGroupCount: number;
}

/** One option a permission prompt offers besides a plain allow/deny. */
export interface PermissionSuggestion {
  /** Human-readable label, e.g. "Always allow Bash(npm test:*)". */
  label: string;
  /** Opaque provider payload echoed back verbatim when the user picks it. */
  payload: unknown;
}

/**
 * A tool call the CLI paused on, waiting for the user's approval. Arrives over
 * the session stream as `permission_request` (the tool row itself has already
 * arrived as `tool_call`, so `tool_use_id` links the two) and disappears on
 * `permission_resolved`. Anchored like an activity so the transcript can place
 * the card beside its tool row.
 */
export interface PermissionPrompt {
  request_id: string;
  tool: string;
  input: Record<string, unknown>;
  description: string | null;
  reason: string | null;
  suggestions: PermissionSuggestion[];
  /** Id of the paused `tool_call`, when the provider reports one. */
  tool_use_id: string | null;
  /** Assistant turn the prompt belongs to (`turn-N:assistant-K`), if known. */
  assistant_turn_id: string | null;
  anchorTurnId: string | null;
  anchorAfterMessageCount: number;
  order: number;
}

// ── Internal types ──

/**
 * How far a user message has travelled toward the running agent (ADR 044).
 *
 * `queued` is still waiting for a turn. The other values are terminal routing
 * outcomes: `steered` reached the running turn, `delivered` reached a new turn,
 * `retained` was kept as context by Stop, and `superseded` was retired when its
 * session ended for another reason.
 */
export type MessageDeliveryState =
  | 'queued'
  | 'steered'
  | 'delivered'
  | 'retained'
  | 'superseded';

const MESSAGE_DELIVERY_STATES: readonly MessageDeliveryState[] = [
  'queued',
  'steered',
  'delivered',
  'retained',
  'superseded',
];

/** Narrow an untrusted SSE payload field to a delivery state. */
export function isDeliveryState(value: unknown): value is MessageDeliveryState {
  return MESSAGE_DELIVERY_STATES.includes(value as MessageDeliveryState);
}

/** Return whether a message is accepted but still waiting for the agent. */
export function isAwaitingDelivery(
  state: MessageDeliveryState | undefined,
): boolean {
  return state === 'queued';
}

/** Return whether a message never entered an agent turn. */
export function isUndeliveredDeliveryState(
  state: MessageDeliveryState | undefined,
): boolean {
  return state === 'queued' || state === 'superseded';
}

export interface ChatMessage {
  role: 'user' | 'agent';
  text: string;
  contextAttachments?: ChatContextAttachment[];
  // Persisted id, present on user messages accepted while a session was live
  // so delivery-state updates can find their row again.
  messageId?: string;
  deliveryState?: MessageDeliveryState;
  // Local-only routing hint for a follow-up submitted while the client saw an
  // idle session. The backend persists every accepted message as `queued`
  // before its runner consumes it; this keeps that acceptance handshake from
  // briefly presenting an ordinary next turn as mid-turn steering.
  optimisticTurn?: boolean;
  assistantTurnId?: string;
  streaming?: boolean;
  fromStream?: boolean;
  finalized?: boolean;
  activities?: ActivityItem[];
  // Marks a system-generated error notice (e.g. SSE error, send/stop
  // failures) so the chat panel can style it distinctly from regular
  // agent output instead of letting it masquerade as a model reply.
  isError?: boolean;
  // Stable identity for a streamed error notice. Kept on the visible row so
  // history reconstruction can rebuild replay-dedup state from what remains.
  errorEventKey?: string;
  // Marks an empty agent row inserted only to host a turn's activities when
  // that turn had no real agent message. Placeholders are excluded from the
  // turn-id ordinal so rendered turn ids stay aligned with the ids that
  // history reconstruction anchored activities/subagents to.
  placeholder?: boolean;
}

/** Return whether a user message belongs outside the transcript's turn flow. */
export function isOutsideTranscriptTurn(
  message: Pick<ChatMessage, 'deliveryState' | 'optimisticTurn'>,
): boolean {
  return isUndeliveredDeliveryState(message.deliveryState)
    && message.optimisticTurn !== true;
}

export interface ChatState {
  messages: ChatMessage[];
  suggestion: string | null;
  activities: ActivityItem[];
  subagents: SubagentStream[];
  buildHistory: BuildActivity[];
  /**
   * Whether a run is live for this conversation.
   *
   * Drives the composer's running treatment and its "Running autonomously"
   * status line. It replaces the single-member `activeEffortLevel` ADR 049
   * left behind: what the composer ever asked of that field was whether
   * there was a run at all.
   */
  autonomousRunActive: boolean;
  sending: boolean;
  conversationId: string | null;
  currentJobId: string | null;
  sessionId: string | null;
  status: SessionStatus | null;
  connected: boolean;
  viewingConversationId: string | null;
  historySession: SessionHistoryDetail | null;
  historyTools: ToolHistoryEvent[];
  liveSession: LiveSessionState;
  /** Permission prompts the CLI is currently paused on, oldest first. */
  permissions: PermissionPrompt[];
  focusRequestToken: number;
}

export interface ChatOptions {
  repositoryOwner: string;
  repositoryName: string;
  blueprintName: string;
}

export interface SessionCreateResponse {
  session_id: string;
  conversation_id: string;
  agent_job_id: string;
  status: SessionStatus;
  is_active_session: boolean;
  can_send: boolean;
  can_cancel: boolean;
  build_status: LiveBuildStatus;
  display_status: string;
  active_work_group_count?: number;
}

export interface ConversationLiveSessionResponse {
  session_id: string;
  conversation_id: string;
  agent_job_id: string | null;
  status: SessionStatus;
  execution_mode: ExecutionMode;
  turn_active: boolean;
  user_stop_requested?: boolean;
  active_prover_batch_id?: string | null;
  active_prover_batch_total?: number;
  active_prover_batch_completed?: number;
  active_work_group_count?: number;
  event_counter: number;
  last_persisted_event_id?: number;
  is_active_session: boolean;
  can_send: boolean;
  can_cancel: boolean;
  build_status: LiveBuildStatus;
  display_status: string;
}

export interface SessionStateResponse {
  session_id: string;
  status: SessionStatus;
  execution_mode: ExecutionMode;
  turn_active: boolean;
  active_prover_batch_id?: string | null;
  active_prover_batch_total?: number;
  active_prover_batch_completed?: number;
  active_work_group_count?: number;
  event_counter: number;
  messages: Array<{
    role: string;
    content: string;
    message_id?: string;
    delivery_state?: MessageDeliveryState;
    context_attachments?: ChatContextAttachment[];
  }>;
  is_active_session: boolean;
  can_send: boolean;
  can_cancel: boolean;
  build_status: LiveBuildStatus;
  display_status: string;
}
