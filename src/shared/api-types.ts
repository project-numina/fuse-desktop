// api-types.ts — response/request shapes exactly as the frontend reads them (snake_case).
// Derived from src/numina/fuse/schemas/*.py and the route return values.

// ---------- enums ----------
export type SessionStatus = 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ExecutionMode = 'foreground' | 'background';
export type MessageRole = 'user' | 'agent' | 'tool';
export type MessageDeliveryState = 'queued' | 'steered' | 'delivered' | 'retained' | 'superseded';
export type UserGroup = 'numina' | 'internal_tester' | 'public_tester';
export type RepositoryVisibility = 'public' | 'private';
export type PullRequestMode = 'off' | 'draft' | 'ready';
export type PullRequestStatus = 'open' | 'merged' | 'draft' | 'closed';
export type RepositorySourceStatus = 'ready' | 'ocr_running' | 'failed' | 'archived' | 'deleting' | 'deleted';
export type RepositorySourceType = 'pdf' | 'latex' | 'markdown' | 'mixed';
export type BuildStatus = 'not_started' | 'running' | 'done' | 'failed';
export type HistoryTier = 'active' | 'waiting_for_review' | 'completed';
export type SourceArtifactKind = 'original' | 'latex' | 'ocr';
export type AttachmentKind = 'backend_source' | 'repo_file';

// ---------- error envelope ----------
export interface ApiErrorEnvelope { detail: string; code: string; request_id: string }

// ---------- auth (LOCAL stub) ----------
export interface AuthUserResponse {
  github_username: string; name: string | null; github_avatar_url: string | null;
  is_admin: boolean; can_use_oauth_token: boolean; user_group: UserGroup;
  can_configure_orchestrator_concurrency: boolean; orchestrator_concurrency_max: number;
}
export interface ClaudeOAuthAccountResponse { id: string; label: string; enabled: boolean; exhausted_until: string | null; last_used_at: string | null; created_at: string }
export interface ClaudeOAuthFallbackSettings { automatic_api_key_fallback: boolean }
export interface PushConfigResponse { enabled: boolean; vapid_public_key: string | null }
export interface AccessRequestStatusResponse { status: 'pending' | 'approved' }

// ---------- tokens (DROP) ----------
export type ApiTokenScope = 'repos:read' | 'repos:write' | 'blueprints:write' | 'sessions:run' | 'usage:read';
export interface ApiTokenMetadata { id: string; name: string; scopes: string[]; repository_allow: string[] | null; prefix_preview: string; expires_at: string | null; last_used_at: string | null; created_at: string; revoked_at: string | null }
export interface ApiTokenCreatedResponse extends ApiTokenMetadata { token: string }
export interface CreateApiTokenBody { name: string; scopes: ApiTokenScope[]; repository_allow?: string[] | null; expires_in_days?: number | null }

// ---------- system ----------
export type DeploymentPhase = 'idle' | 'pending_idle' | 'pending_waiting_for_idle' | 'scheduled_force_window_soon' | 'maintenance_window' | 'deploy_failed';
export interface DeploymentStatus { phase: DeploymentPhase; show_banner: boolean; pending_ref: string | null; active_agent_jobs: number; stale_after_minutes: number; next_force_window_at: string | null; force_window_ends_at: string | null; force_restart_policy: string | null; message: string | null }
export interface Lean4Tag { name: string }

// ---------- repositories ----------
export interface RepositoryBackgroundSessionResponse { id: string; blueprint_name: string; title: string | null; tier: HistoryTier; updated_at: string | null; background_updates: string[]; roadblocks: string[] }
export interface RepositoryResponse { id: number; owner: string; name: string; description: string | null; updated_at: string | null; visibility: RepositoryVisibility; weekly_commits: number[]; background_sessions: RepositoryBackgroundSessionResponse[] }
export interface RepositoryNeedsSetupResponse { id: number; owner: string; name: string; description: string | null; visibility: RepositoryVisibility }
export interface RepositoryListResponse { repositories: RepositoryResponse[]; repositories_needing_setup: RepositoryNeedsSetupResponse[]; hidden_count: number }
export type RepositoryBackgroundSessionsResponse = Record<string /* "owner/repo" */, RepositoryBackgroundSessionResponse[]>;
export interface RepositoryBranches { default_branch: string; branches: string[] }
export interface LakefileEntry { directory: string; lakefile: 'lakefile.toml' | 'lakefile.lean' | string; path: string }
export interface RepositoryLakefiles { lakefiles: LakefileEntry[]; truncated: boolean }
export interface RepositorySetupRequest { module_name: string; lean_version?: string | null; target_subdir?: string | null; base_branch?: string | null }
export interface RepositorySetupResult { default_branch: string; module_name: string; project_subdir: string; pull_request_url: string | null; pull_request_number: number | null }
export interface PullRequestStatusResponse { number: number; state: string; merged: boolean }
export interface PullRequestResponse { number: number; node_id: string; title: string; status: PullRequestStatus; branch: string; base_branch: string; head_repository: string; description: string; created_at: string; updated_at: string; merged_at: string | null }
export interface RepositoryFileEntry { path: string; name: string; size: number }
export interface RepositoryFilesResponse { files: RepositoryFileEntry[]; truncated: boolean; clone_ready: boolean }
export interface FileContentResponse { name: string; path: string; sha: string; size: number; content: string }

// ---------- repository sources ----------
export interface RepositorySourceMetadata {
  project_scoped?: boolean; scoped_blueprint_id?: string | null; blueprint_id?: string | null; blueprint_title?: string;
  created_from?: 'blueprint_create' | string; repository_path?: string; repository_content_sha256?: string;
  ocr_page_starts?: number[]; legacy?: boolean; [key: string]: unknown;
}
export interface RepositorySourceResponse { id: string; github_repo_id: number; owner: string; repo_name: string; display_name: string; source_type: RepositorySourceType; status: RepositorySourceStatus; artifacts: SourceArtifactKind[]; metadata: RepositorySourceMetadata; created_at: string; updated_at: string }
export interface RepositorySourceListResponse { sources: RepositorySourceResponse[] }
export interface RepositorySourceImportRequest { blueprint_id: string; repo_path: string }
export interface UploadSourceFields { display_name?: string; project_scoped?: 'true'; blueprint_id?: string }  // multipart + file

// ---------- blueprints ----------
export interface FileDiffStats { added: number; deleted: number }
export interface BranchFreshness { default_branch: string; base_sha: string | null; current_default_sha: string | null; commits_behind: number; is_stale: boolean }
export interface BlueprintBranchStatus { branch: string; is_dirty: boolean; commits_ahead: number; commits_behind: number; is_diverged: boolean; needs_reconcile: boolean }
export interface BlueprintEntry { kind: string; label: string; title: string; lean_name: string; lean_file: string; lean_line: number; uses: string[]; statement: string; proof: string | null; issues: string[]; status: '' | 'not_started' | 'in_progress' | 'proved'; source_file: string }
export interface BlueprintSummary { id: string; name: string; description: string; area: string; entry_count: number; updated_at: string | null; workspace_id: string | null; can_edit: boolean }
export interface BlueprintResponse extends BlueprintSummary {
  runtime_route_tag: string | null; project_subdir: string; blueprint_file: string; blueprint_content: string;
  source_content: string; source_type: string; source_pdf_path: string; source_file_url: string; source_pdf_url: string; ocr_phase: string;
  lean_files: string[]; all_lean_files: string[]; file_diff_stats: Record<string, FileDiffStats>; entries: BlueprintEntry[];
  included_files: string[]; latex_macros: Record<string, string>; chapter_titles: Record<string, string>; chapter_references: Record<string, string>; chapter_contents: Record<string, string>;
  pr_mode: PullRequestMode; auto_commit: boolean; orchestrator_child_concurrency: number; open_pr_number: number | null;
  branch_freshness: BranchFreshness | null; branch_status: BlueprintBranchStatus | null; is_merged: boolean;
}
export interface BlueprintPullRequestStatus { open_pr_number: number | null }
export interface BlueprintBuildStatus { status: 'done' | 'not_built'; head: string | null; toolchain_hash: string | null; manifest_hash: string | null }
export interface BlueprintEditRequest { latex_source: string }
export interface BlueprintChapterContent { path: string; content: string }
export interface BlueprintChapterUpdate { content: string }
export interface BlueprintCommitRequest { message?: string | null }
export type BlueprintCommitStatus = 'build_failed' | 'committed' | 'content_blocked' | 'no_changes' | 'push_failed' | 'verification_unavailable';
export interface BlueprintCommitResult { status: BlueprintCommitStatus; commit_sha: string | null; message: string | null }
export interface BlueprintSyncResult { status: 'updated' | 'up_to_date'; before_sha: string | null; after_sha: string | null }
export interface BlueprintMainSyncRequest { branch?: string | null }
export interface BlueprintMainSyncResult extends BlueprintSyncResult { freshness: BranchFreshness | null }
export interface BlueprintCommit { sha: string; message: string; author_name: string | null; author_login: string | null; author_avatar_url: string | null; authored_at: string | null; html_url: string | null }
export interface BlueprintCommitListResponse { commits: BlueprintCommit[] }
export interface BlueprintCommitDetailFile { path: string; status: 'modified' | 'added' | 'deleted' | 'renamed' | string; old_path: string | null; additions: number; deletions: number; patch: string | null }
export interface BlueprintCommitDetail extends BlueprintCommit { files: BlueprintCommitDetailFile[] }
export type BlueprintDiffStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
export interface BlueprintDiffFile { path: string; status: BlueprintDiffStatus; old_path: string | null; additions: number; deletions: number; diff: string | null; truncated: boolean; binary: boolean }
export interface BlueprintDiffResponse { files: BlueprintDiffFile[] }
export interface BlueprintSettingsUpdate { title?: string; description?: string; pr_mode?: PullRequestMode; auto_commit?: boolean; orchestrator_child_concurrency?: number }
export interface BlueprintSettingsResponse { name: string; description: string; pr_mode: PullRequestMode; auto_commit: boolean; orchestrator_child_concurrency: number; pr_number: number | null; pr_error: string | null; pushed: boolean }
export interface BlueprintSourceFileUpdate { blueprint_file: string }
export interface BlueprintSourceFileResponse { blueprint_file: string; included_files: string[]; entry_count: number }
export interface RepositoryBlueprintFile { path: string; name: string; size: number }
export interface RepositoryBlueprintFilesResponse { files: RepositoryBlueprintFile[] }
export interface CreateWorkspaceFields { title: string; latex_content?: string; existing_blueprint_path?: string; page_start?: string; page_end?: string; base_branch?: string; project_subdir?: string }  // multipart + optional file
export interface CreateWorkspaceResponse { blueprint_id: string; message: string }
export interface PdfInfoResponse { page_count: number }

// ---------- lean infoview ----------
export interface GoalRequest { file_path: string; line: number; column?: number | null }
export interface GoalResponse { line_context: string | null; goals: string[] | null; goals_before: string[] | null; goals_after: string[] | null; expected_type: string | null }
export interface HoverRequest { file_path: string; line: number; column: number }
export interface HoverResponse { contents: string | null; start_line: number | null; start_column: number | null; end_line: number | null; end_column: number | null }
export interface DiagnosticRequest { file_path: string; start_line?: number | null; end_line?: number | null }
export interface DiagnosticItem { severity: string; message: string; line: number; column: number; end_line: number | null; end_column: number | null }
export interface DiagnosticResponse { items: DiagnosticItem[]; complete: boolean; failed_dependencies: string[] }
export interface ReloadFileRequest { file_path: string }
export interface FileSaveRequest { file_path: string; content: string }
export interface OkResponse { ok: true }
export interface BuildErrorCounts { [repoRelativePath: string]: { errors: number; warnings: number } }

// ---------- sessions: live ----------
export interface ChatAttachmentSelection { kind: 'entire_file' | 'line_range' | 'page_range' | string; start_line?: number; end_line?: number; start_page?: number; end_page?: number; [key: string]: unknown }
export interface ChatContextAttachmentBody { attachment_kind: AttachmentKind; source_id?: string | null; artifact_kind?: SourceArtifactKind | null; repo_path?: string | null; selection?: ChatAttachmentSelection }
export interface ChatContextAttachmentPayload { id: string; attachment_kind: AttachmentKind; source_id: string | null; artifact_kind: string | null; repo_path: string | null; display_name: string; selection: ChatAttachmentSelection; created_at: string }
export interface ApiKeyFallbackPromptState { message: string; replay_message_count: number; replay_input_tokens: number; restarts_child: boolean }
export interface LiveSessionCapabilities { is_active_session: boolean; can_send: boolean; can_cancel: boolean; build_status: BuildStatus; display_status: string; active_work_group_count: number; effort_level: 'autonomous'; api_key_fallback_pending: boolean; api_key_fallback: ApiKeyFallbackPromptState | null }
export interface ProverBatchProgress { active_prover_batch_id: string | null; active_prover_batch_total: number; active_prover_batch_completed: number }
export interface SessionCreate { repository_owner: string; repository_name: string; blueprint_name?: string | null; workspace_id?: string | null; initial_message: string; effort_level?: string | null; execution_mode?: ExecutionMode | null; resume_from_conversation_id?: string | null; context_attachments?: ChatContextAttachmentBody[] }
export interface SessionResponse extends LiveSessionCapabilities { session_id: string; conversation_id: string; agent_job_id: string; status: SessionStatus }
export interface SessionChatMessage { role: 'user' | 'agent'; content: string; assistant_turn_id?: string; context_attachments?: ChatContextAttachmentPayload[]; message_id?: string; delivery_state?: MessageDeliveryState }
export interface SessionState extends LiveSessionCapabilities, ProverBatchProgress { session_id: string; status: SessionStatus; created_at: string; total_cost_usd: number; input_tokens: number; output_tokens: number; execution_mode: ExecutionMode; turn_active: boolean; event_counter: number; messages: SessionChatMessage[] }
export interface MessageCreate { content: string; effort_level?: string | null; execution_mode?: ExecutionMode | null; context_attachments?: ChatContextAttachmentBody[] }
export interface SessionMessageResponse { status: 'accepted'; message_id?: string; delivery_state?: 'queued' }
export interface SessionCancelResponse { status: 'stop_requested'; message_delivery_states: Record<string, MessageDeliveryState> }
export interface ApiKeyFallbackDecision { approved: boolean }
export interface ApiKeyFallbackDecisionResponse { status: 'approved' | 'declined' }
export interface SessionWaitRequest { timeout_seconds?: number | null }
export interface ConversationLiveSession extends LiveSessionCapabilities, ProverBatchProgress { session_id: string; conversation_id: string; agent_job_id: string | null; status: SessionStatus; execution_mode: ExecutionMode; turn_active: boolean; user_stop_requested: boolean; event_counter: number; last_persisted_event_id: number }
export interface ActiveSessionSummary extends ProverBatchProgress { session_id: string; conversation_id: string | null; agent_job_id: string | null; repository_owner: string; repository_name: string; blueprint_name: string | null; workspace_label: string; status: SessionStatus; execution_mode: ExecutionMode; effort_level: 'autonomous'; turn_active: boolean; active_work_group_count: number; created_at: string; can_send: boolean; can_cancel: boolean; display_status: string }
export interface ActiveSessionList { sessions: ActiveSessionSummary[]; active_count: number; max_active_sessions: number }
export interface PendingResumeDiscardResponse { status: 'discarded'; discarded: number }

// ---------- sessions: history ----------
export interface ChatContextAttachmentResponse { id: string; attachment_kind: AttachmentKind; source_id: string | null; artifact_kind: string | null; repo_path: string | null; display_name: string; selection: ChatAttachmentSelection; created_at: string }
export interface ChatMessageResponse { id: string; role: MessageRole; content: string; created_at: string; delivery_state: MessageDeliveryState | null; context_attachments: ChatContextAttachmentResponse[] }
export interface SessionHistorySummary { id: string; title: string | null; status: JobStatus; workspace_id: string | null; workspace_display_name: string | null; blueprint_name: string | null; created_at: string; completed_at: string | null; background_started_at: string | null; background_reviewed_at: string | null; input_tokens: number | null; output_tokens: number | null; total_cost_usd: number | null; message_count: number; first_message: string | null; last_message: string | null; last_message_at: string | null; tier: HistoryTier; background_updates: string[]; roadblocks: string[] }
export interface SessionHistorySummary { attention_revision?: string }
export interface RecentConversationSummary extends SessionHistorySummary { repository_owner: string; repository_name: string }
export interface PersistedSubagentToolCall { tool_use_id: string; tool: string; input: Record<string, unknown>; created_at: string }
export interface PersistedSubagentSummary { parent_tool_use_id: string; tool_call_count: number; recent_tool_calls: PersistedSubagentToolCall[]; started_at: string | null; ended_at: string | null }
export interface SessionHistoryDetail extends SessionHistorySummary { messages: ChatMessageResponse[]; subagents: PersistedSubagentSummary[]; subagent_history_lazy: boolean; can_resume: boolean; last_persisted_event_id: number | null }
export interface SubagentHistoryDetail { parent_tool_use_id: string; messages: ChatMessageResponse[]; started_at: string | null; ended_at: string | null }
export type PersistedToolRowContent =
  | { kind: 'tool_call'; tool_use_id: string; tool: string; input: Record<string, unknown>; is_subagent: boolean; parent_tool_use_id: string | null; model: string | null }
  | { kind: 'tool_result'; tool_use_id: string; result: string | null; is_error: boolean; is_subagent: boolean; parent_tool_use_id: string | null }
  | { kind: 'agent_status'; agent: string; status: string; tool_use_id: string; error_class?: string; error_message?: string; signal?: string }
  | { kind: 'subagent_text' | 'subagent_message'; parent_tool_use_id: string; text: string; message_id: string }
  | { kind: 'build_status'; phase: string; message: string };

// ---------- sessions: sharing (DROP) ----------
export interface ChatShareResponse { share_id: string; conversation_id: string; share_path: string; created_at: string }
export interface SharedBlueprintResponse extends BlueprintResponse { lean_file_contents: Record<string, string> }
export interface SharedChatDetail { share_id: string; repository_owner: string; repository_name: string; conversation: SessionHistoryDetail; blueprint: SharedBlueprintResponse | null }
export interface SharedLeanFileResponse { file_path: string; content: string }

// ---------- SSE ----------
export interface BuildStatusEvent { phase: string; message: string }
export interface BuildSnapshotEvent { status: 'running' | 'done' | 'error'; steps: BuildStatusEvent[] }
export interface BuildErrorsEvent { files: BuildErrorCounts }
export interface OcrStatusEvent { phase: string; message: string }
export interface BlueprintEditEvent { latex_source: string }
export interface BlueprintNamedEvent { blueprint: string }
export type BlueprintBranchStatusEvent = BlueprintNamedEvent & BlueprintBranchStatus;
export type BlueprintBranchFreshnessEvent = BlueprintNamedEvent & BranchFreshness;
export interface BufferOverflowEvent { message: string; recoverable?: boolean }
export interface StreamErrorEvent { message: string }
export type BlueprintSseEvent =
  | { event: 'build_snapshot'; data: BuildSnapshotEvent } | { event: 'build_status'; data: BuildStatusEvent }
  | { event: 'build_errors_snapshot' | 'build_errors_updated'; data: BuildErrorsEvent }
  | { event: 'ocr_snapshot' | 'ocr_status'; data: OcrStatusEvent } | { event: 'blueprint_edit'; data: BlueprintEditEvent }
  | { event: 'blueprint_sync' | 'blueprint_rebase'; data: BlueprintNamedEvent }
  | { event: 'blueprint_branch_status'; data: BlueprintBranchStatusEvent } | { event: 'blueprint_branch_freshness'; data: BlueprintBranchFreshnessEvent }
  | { event: 'buffer_overflow'; data: BufferOverflowEvent } | { event: 'error'; data: StreamErrorEvent } | { event: 'heartbeat'; data: '' };
export interface StatusEvent { status: string }
export interface TurnStatusEvent { turn_active: boolean }
export type ChatEvent = SessionChatMessage;
export interface MessageDeliveryEvent { message_id: string; state: MessageDeliveryState }
export interface StreamStartEvent { assistant_turn_id: string }
export interface StreamDeltaEvent { text: string; assistant_turn_id?: string }
export interface StreamEndEvent { assistant_turn_id?: string }
export interface ToolCallEvent { tool: string; input: Record<string, unknown>; model: string | null; tool_use_id: string; parent_tool_use_id?: string }
export interface ToolResultEvent { tool_use_id: string; result: string | null; is_error: boolean; parent_tool_use_id?: string }
export interface AgentStatusEvent { agent?: string; status: string; tool_use_id?: string; reason?: string; error_class?: string; error_message?: string; signal?: string }
export interface SubagentStreamDeltaEvent { parent_tool_use_id: string; text: string; delta_kind?: 'text' | 'thinking' }
export interface SubagentMessageEvent { parent_tool_use_id: string; text: string; message_id: string }
export interface SubagentTextEvent { parent_tool_use_id: string; text: string; message_id?: string }
export interface ProverBatchStatusEvent { batch_id: string | null; active: boolean; completed: number; total: number; can_send: boolean; [key: string]: unknown }
export interface WorkGroupStatusEvent { status: string; task_count: number; completed_count: number; active_group_count: number; integration_conflict_count?: number; resuming?: boolean }
export interface TokenUsageEvent { input_tokens: number; output_tokens: number }
export interface SessionResultEvent { total_cost_usd: number; num_turns: number; duration_ms: number; stop_reason: string | null }
export interface ApiKeyFallbackPromptEvent extends ApiKeyFallbackPromptState {}
export interface ApiKeyFallbackResolvedEvent { approved: boolean; restarts_child: boolean }
export interface SessionEndEvent { status: 'completed' | 'failed' | 'cancelled' }
export type SessionSseEvent =
  | { event: 'heartbeat'; data: '' } | { event: 'session_status'; data: StatusEvent } | { event: 'turn_status'; data: TurnStatusEvent }
  | { event: 'chat'; data: ChatEvent } | { event: 'message_delivery'; data: MessageDeliveryEvent }
  | { event: 'stream_start'; data: StreamStartEvent } | { event: 'stream_delta'; data: StreamDeltaEvent } | { event: 'stream_end'; data: StreamEndEvent }
  | { event: 'tool_call'; data: ToolCallEvent } | { event: 'tool_result'; data: ToolResultEvent } | { event: 'agent_status'; data: AgentStatusEvent }
  | { event: 'subagent_stream_delta'; data: SubagentStreamDeltaEvent } | { event: 'subagent_message'; data: SubagentMessageEvent } | { event: 'subagent_text'; data: SubagentTextEvent }
  | { event: 'prover_batch_status'; data: ProverBatchStatusEvent } | { event: 'work_group_status'; data: WorkGroupStatusEvent }
  | { event: 'token_usage'; data: TokenUsageEvent } | { event: 'session_result'; data: SessionResultEvent }
  | { event: 'build_status'; data: BuildStatusEvent } | { event: 'build_snapshot'; data: BuildSnapshotEvent }
  | { event: 'ocr_status' | 'ocr_snapshot'; data: OcrStatusEvent }
  | { event: 'api_key_fallback_prompt'; data: ApiKeyFallbackPromptEvent } | { event: 'api_key_fallback_resolved'; data: ApiKeyFallbackResolvedEvent }
  | { event: 'error'; data: StreamErrorEvent } | { event: 'session_end'; data: SessionEndEvent } | { event: 'buffer_overflow'; data: BufferOverflowEvent };

// ---------- usage (DROP; only fetchMyUsage kept for a possible local page) ----------
export interface UsagePeriod { total_cost_usd: number; input_tokens: number; output_tokens: number; session_count: number }
export interface UserUsageResponse { user_id: string; daily_usage: UsagePeriod; weekly_usage: UsagePeriod; daily_budget_usd: number; weekly_budget_usd: number; spending_cap_reached: boolean }
export interface BudgetIncreaseRequestCreate { reason: string }
export interface BudgetIncreaseRequestResponse { id: string; user_id: string; reason: string; resolved: boolean; created_at: string }
export interface FeedbackCreate { category: 'bug' | 'suggestion' | 'other'; title: string; body: string }

// ---------- admin models (DROP) — see lib/api/admin-models.ts for the declared shapes ----------
