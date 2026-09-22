/**
 * Row types for the local registries. They stand in for the web backend's
 * repositories / workspaces / blueprints / conversations tables. Field names
 * follow the API shapes where the row is served directly.
 */

import type { HistoryTier, JobStatus, MessageDeliveryState, PullRequestMode, RepositorySourceStatus, RepositorySourceType, SourceArtifactKind } from '@shared/api-types';
import type { ClaudePermissionMode, CodexSandboxMode, EffortLevel, ProviderId } from '@shared/agent-events';

export interface RepositoryRow {
  /** Stable integer id, assigned on registration (stands in for the GitHub id). */
  id: number;
  /** Route owner segment: a slug of the parent folder name, made unique. */
  owner: string;
  /** Route repo segment: a slug of the folder name, made unique per owner. */
  name: string;
  /** Absolute path of the folder on disk. */
  path: string;
  description: string | null;
  created_at: string;
  /** Bumped by conversations, blueprint edits, commits; drives dashboard order. */
  last_activity_at: string | null;
  lean_setup_dismissed?: boolean;
}

/** Agent configuration attached to a workspace (desktop-only settings). */
export interface AgentConfig {
  provider: ProviderId;
  /** '' means the CLI's own default model. */
  model: string;
  effort: EffortLevel | null;
  claude_permission_mode: ClaudePermissionMode;
  codex_sandbox: CodexSandboxMode;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  provider: 'claude',
  model: '',
  effort: null,
  claude_permission_mode: 'acceptEdits',
  codex_sandbox: 'workspace-write',
};

/** One workspace = one blueprint in a repository (the web's Workspace+Blueprint rows). */
export interface BlueprintRow {
  /** Slug id, also the route `:blueprintId` and the `name` field of API payloads. */
  id: string;
  repository_id: number;
  title: string;
  description: string;
  area: string;
  /** Repo-relative path of the entrypoint .tex, or null when not yet chosen. */
  blueprint_file: string | null;
  /** Repo-relative Lean project directory ('' = repository root). */
  project_subdir: string;
  source_type: 'none' | 'tex' | 'pdf' | 'markdown' | string;
  /** Id of the RepositorySourceRow attached at creation, if any. */
  source_id: string | null;
  pr_mode: PullRequestMode;
  auto_commit: boolean;
  orchestrator_child_concurrency: number;
  agent: AgentConfig;
  created_at: string;
  updated_at: string;
}

export interface RepositorySourceRow {
  id: string;
  repository_id: number;
  display_name: string;
  source_type: RepositorySourceType;
  status: RepositorySourceStatus;
  /** Artifact kind → file name inside sources/<id>/ */
  artifacts: Partial<Record<SourceArtifactKind, string>>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ConversationRow {
  id: string;
  repository_id: number;
  blueprint_id: string | null;
  title: string | null;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_cost_usd: number | null;
  /** Provider conversation id used to resume (Claude session id / Codex thread id). */
  provider_thread_id: string | null;
  provider: ProviderId;
  tier: HistoryTier;
  background_updates: string[];
  roadblocks: string[];
}

/** Persisted transcript row, served as ChatMessageResponse. */
export interface TranscriptRow {
  id: string;
  role: 'user' | 'agent' | 'tool';
  /** Prose for user/agent rows; JSON-encoded PersistedToolRowContent for tool rows. */
  content: string;
  created_at: string;
  delivered_at: string | null;
  delivery_state: MessageDeliveryState | null;
  context_attachments: Array<Record<string, unknown>>;
  /** Denormalised for history queries. */
  event_kind: string | null;
  tool_name: string | null;
  tool_use_id: string | null;
  parent_tool_use_id: string | null;
  is_subagent: boolean;
}

export interface ConversationFile {
  row: ConversationRow;
  messages: TranscriptRow[];
  /** Highest SSE event id that has a persisted row (history.last_persisted_event_id). */
  last_persisted_event_id: number;
}
