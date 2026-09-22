/**
 * Agent session API helpers: session and conversation history, live
 * session lookup, the active-session list, and cancellation.
 */

import { request } from '@/lib/api/core';

export interface ChatContextAttachmentBody {
  attachment_kind: 'backend_source' | 'repo_file';
  source_id?: string | null;
  artifact_kind?: string | null;
  repo_path?: string | null;
  selection?: { kind: string; [key: string]: unknown };
}

/**
 * Session/response value types used by the session endpoints.
 *
 * the request/response shapes the API client depends on are declared here
 * (verbatim copies) to keep this module self-contained. When the chat store
 */
export type ExecutionMode = 'foreground' | 'background';
export type SessionStatus =
  | 'starting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type LiveBuildStatus = 'not_started' | 'running' | 'done' | 'failed';

export interface SessionMessageResponse {
  status: string;
  message_id?: string;
  delivery_state?: string;
}

export interface SessionCancelResponse {
  status: string;
  message_delivery_states?: Record<
    string,
    'queued' | 'steered' | 'delivered' | 'retained' | 'superseded'
  >;
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
    delivery_state?: 'queued' | 'steered' | 'delivered' | 'retained' | 'superseded';
    context_attachments?: ChatContextAttachmentBody[];
  }>;
  is_active_session: boolean;
  can_send: boolean;
  can_cancel: boolean;
  build_status: LiveBuildStatus;
  display_status: string;
}

/**
 * @param {string} owner Repository owner.
 * @param {string} repo Repository name.
 * @param {string} blueprintName Blueprint identifier.
 * @param {number} [limit] Maximum number of sessions to return.
 * @return {Promise<Object[]>} Recent agent session history.
 */
export function fetchSessionHistory(owner: string, repo: string, blueprintName: string, limit = 20, offset = 0, refreshNative = true): Promise<unknown> {
  const params = new URLSearchParams({
    repository_owner: owner,
    repository_name: repo,
    blueprint_name: blueprintName,
    limit: String(limit),
    offset: String(offset),
    refresh_native: String(refreshNative),
  });
  return request(`/sessions/history?${params.toString()}`);
}

/**
 * @param {number} [limit] Maximum number of conversations to return.
 * @param {number} [offset] Pagination offset.
 * @return {Promise<Object[]>} The user's recent conversations across all repos.
 */
export function fetchRecentConversations(limit = 20, offset = 0): Promise<unknown> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  return request(`/sessions/history/recent?${params.toString()}`);
}

export function fetchNativeHistoryStatus(owner: string, repo: string, blueprintName: string): Promise<{ warnings: string[]; refreshing?: boolean }> {
  const params = new URLSearchParams({ repository_owner: owner, repository_name: repo, blueprint_name: blueprintName });
  return request(`/sessions/history/native-status?${params.toString()}`);
}

/**
 * @param {string} jobId Agent job identifier.
 * @return {Promise<Object>} Persisted agent session transcript and tool events.
 */
export function fetchSessionHistoryDetail(jobId: string): Promise<unknown> {
  return request(`/sessions/history/${encodeURIComponent(jobId)}`);
}

/** Fetch one subagent's persisted timeline when its card is expanded. */
export function fetchSubagentHistory(
  conversationId: string,
  parentToolUseId: string,
): Promise<unknown> {
  return request(
    `/sessions/history/${encodeURIComponent(conversationId)}`
    + `/subagents/${encodeURIComponent(parentToolUseId)}`,
  );
}

/**
 * @param {string} conversationId Persisted conversation identifier.
 * @return {Promise<Object>} Active live session bound to that conversation.
 */
export function fetchLiveSessionForConversation(conversationId: string): Promise<unknown> {
  return request(`/sessions/history/${encodeURIComponent(conversationId)}/live`);
}

export interface ActiveSessionSummary {
  session_id: string;
  conversation_id: string | null;
  agent_job_id: string | null;
  repository_owner: string;
  repository_name: string;
  blueprint_name: string | null;
  workspace_label: string;
  status: 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';
  execution_mode: 'foreground' | 'background';
  turn_active: boolean;
  active_prover_batch_id?: string | null;
  active_prover_batch_total?: number;
  active_prover_batch_completed?: number;
  active_work_group_count?: number;
  created_at: string;
  can_send: boolean;
  can_cancel: boolean;
  display_status: string;
}

export interface ActiveSessionList {
  sessions: ActiveSessionSummary[];
  active_count: number;
  max_active_sessions: number;
}

/**
 * @return {Promise<ActiveSessionList>} The current user's live sessions and the cap.
 */
export function fetchActiveSessions(): Promise<ActiveSessionList> {
  return request<ActiveSessionList>('/sessions/active');
}

export interface CreateSessionBody {
  repository_owner: string;
  repository_name: string;
  blueprint_name: string;
  initial_message: string;
  resume_from_conversation_id?: string | null;
  context_attachments?: ChatContextAttachmentBody[];
}

/**
 * Create a new agent session with an initial user message.
 * @param {CreateSessionBody} body Session parameters.
 * @return {Promise<SessionCreateResponse>} The created session descriptor.
 */
export function createSession(
  body: CreateSessionBody,
): Promise<SessionCreateResponse> {
  return request<SessionCreateResponse>('/sessions', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Forward a follow-up message to a running session.
 * @param {string} sessionId Live session UUID.
 * @param {Object} body Message content and any attached source context.
 * @return {Promise<SessionMessageResponse>} Accepted message identity and state.
 */
export function sendSessionMessage(
  sessionId: string,
  body: {
    content: string;
    context_attachments?: ChatContextAttachmentBody[];
  },
): Promise<SessionMessageResponse> {
  return request<SessionMessageResponse>(
    `/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: 'POST',
    body: JSON.stringify(body),
    },
  );
}

/**
 * Fetch the current live state of a session (status, turn, build, cursor).
 * @param {string} sessionId Live session UUID.
 * @return {Promise<SessionStateResponse>} The session's current state.
 */
export function fetchSessionState(
  sessionId: string,
): Promise<SessionStateResponse> {
  return request<SessionStateResponse>(
    `/sessions/${encodeURIComponent(sessionId)}/state`,
  );
}

/**
 * Refresh the hidden-tab keepalive lease for a session.
 * @param {string} sessionId Live session UUID.
 * @return {Promise<unknown>} Resolves when the lease is renewed.
 */
export function keepaliveSession(sessionId: string): Promise<unknown> {
  return request(`/sessions/${encodeURIComponent(sessionId)}/keepalive`, {
    method: 'POST',
  });
}

/**
 * Mark a finished background ("auto") run as reviewed so its badge clears.
 * @param {string} conversationId Persisted conversation identifier.
 * @return {Promise<unknown>} Resolves when the run is marked reviewed.
 */
export function reviewBackgroundSession(
  conversationId: string,
): Promise<unknown> {
  return request(
    `/sessions/history/${encodeURIComponent(conversationId)}/review-background`,
    { method: 'POST' },
  );
}

/**
 * Request termination of a live session by ID.
 * @param {string} sessionId Live session UUID.
 * @return {Promise<SessionCancelResponse>} Stop and message-state acknowledgment.
 */
export function cancelSession(sessionId: string): Promise<SessionCancelResponse> {
  return request<SessionCancelResponse>(
    `/sessions/${encodeURIComponent(sessionId)}/cancel`,
    { method: 'POST' },
  );
}

/**
 * A decision for a CLI permission prompt (Claude Code `can_use_tool` control
 * request or a Codex approval). `suggestion` echoes one of the prompt's
 * `suggestions[].payload` values back verbatim (e.g. "always allow"); the
 * renderer never interprets it.
 */
export interface PermissionDecisionBody {
  behavior: 'allow' | 'deny';
  suggestion?: unknown;
  /** Optional note shown to the model when denying. */
  message?: string;
}

/**
 * Answer a pending permission prompt on a live session.
 * @param {string} sessionId Live session UUID.
 * @param {string} requestId The prompt's `request_id` from the SSE event.
 * @param {PermissionDecisionBody} decision The user's choice.
 * @return {Promise<{status: string}>} Acknowledgment from the server.
 */
export function respondPermissionRequest(
  sessionId: string,
  requestId: string,
  decision: PermissionDecisionBody,
): Promise<{ status: string }> {
  return request<{ status: string }>(
    `/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(requestId)}`,
    { method: 'POST', body: JSON.stringify(decision) },
  );
}

/**
 * @param {string} jobId Agent job identifier.
 * @return {Promise<null>} Resolves on success (204).
 */
export function deleteSessionHistory(jobId: string): Promise<unknown> {
  return request(`/sessions/history/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
}
