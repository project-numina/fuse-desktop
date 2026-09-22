import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Context } from 'hono';
import type { AgentEvent, PermissionDecision, ProviderId } from '@shared/agent-events';
import type {
  ActiveSessionList, ActiveSessionSummary, BuildSnapshotEvent, BuildStatus,
  ChatContextAttachmentPayload, ConversationLiveSession, SessionCancelResponse,
  SessionChatMessage, SessionResponse, SessionState,
} from '@shared/api-types';
import type { SessionAttention } from '@shared/session-attention';
import { ClaudeCodeThread } from '../../../agents/claude-code';
import { CodexThread } from '../../../agents/codex';
import type { EventSink, ProviderThread, ThreadLaunch } from '../../../agents/types';
import type { AppContext } from '../../../server/context';
import { HttpError } from '../../../server/errors';
import { SseRooms, type SseFrame } from '../../../server/sse';
import { nowIso } from '../../../store/registry';
import type { RepositoryRow } from '../../../store/rows';
import { roomKeyFor, type OpenProject } from '../../types';
import type { AttachmentPromptContext } from '../attachments';
import { defaultMcpServerPath } from '../launch';
import { providerStateExists } from '../provider-state';
import { ProviderNativeHistory, type NativeHistory } from '../native-history';
import type { LeanEnvironmentState } from '../prompts';
import { LocalSession } from '../session';
import {
  ConversationStore, MAX_DISPLAYED_PROGRESS_ENTRIES, historySummary,
  type LiveSessionInfo,
} from '../transcript';

const SHUTDOWN_REGISTERED = Symbol.for('fuse.sessions.shutdownRegistered');

export const SESSION_WAIT_DEFAULT_SECONDS = 60;
export const SESSION_WAIT_MAX_SECONDS = 300;

export interface SessionServiceOptions {
  nativeHistory?: NativeHistory | null;
  createThread?: (launch: ThreadLaunch, sink: EventSink) => ProviderThread;
  mcpServerPath?: string;
  idleTimeoutMs?: number;
  activityTimeoutMs?: number;
  stopWaitMs?: number;
  interruptGraceMs?: number;
  endedRetentionMs?: number;
  now?: () => number;
  providerStateExists?: (provider: ProviderId, threadId: string) => boolean;
}

interface LeanServiceLike {
  buildStatus(project: OpenProject): { status: 'done' | 'not_built' };
  buildSnapshot(project: OpenProject): BuildSnapshotEvent | null;
}

interface BlueprintServiceLike {
  openProject(owner: string, repo: string, blueprintId: string): OpenProject;
}

interface AttentionLike {
  observe(conversationId: string, event: AgentEvent): void;
  setUnread?(conversationIds: string[]): void;
}

export interface SessionTimers {
  idle: NodeJS.Timeout | null;
  activity: NodeJS.Timeout | null;
  force: NodeJS.Timeout | null;
  retention: NodeJS.Timeout | null;
}

export interface ResumeContext {
  messages: SessionChatMessage[];
  retainedMessageIds: string[];
  providerThreadId: string | null;
}

export interface InitialTurn {
  chat: SessionChatMessage;
  attachments: ChatContextAttachmentPayload[];
  resume: ResumeContext | null;
  resumeRetryAvailable: boolean;
}

function clampWaitTimeout(requested: unknown): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return SESSION_WAIT_DEFAULT_SECONDS;
  return Math.min(SESSION_WAIT_MAX_SECONDS, Math.max(1, Math.floor(requested)));
}

/** Shared state and invariant-preserving reads for session service layers. */
export abstract class SessionServiceCore {
  readonly store: ConversationStore;
  protected readonly rooms: SseRooms;
  protected readonly sessions = new Map<string, LocalSession>();
  protected readonly liveByConversation = new Map<string, LocalSession>();
  protected readonly threads = new Map<string, ProviderThread>();
  protected readonly timers = new Map<string, SessionTimers>();
  protected readonly activityTimedOut = new Set<string>();
  protected readonly postTurnInProgress = new Set<string>();
  protected readonly initialTurns = new Map<string, InitialTurn>();
  protected readonly options: Required<Pick<SessionServiceOptions, 'idleTimeoutMs' | 'activityTimeoutMs' | 'stopWaitMs' | 'interruptGraceMs' | 'endedRetentionMs'>>;
  protected readonly createThread: (launch: ThreadLaunch, sink: EventSink) => ProviderThread;
  protected readonly providerStateExists: (provider: ProviderId, threadId: string) => boolean;
  protected readonly mcpServerPath: string;
  protected readonly clock: () => number;
  protected readonly nativeHistory: NativeHistory | null;
  protected readonly nativeDiscovery = new Map<string, Promise<void>>();
  protected readonly historyWarnings = new Map<string, string[]>();
  protected shuttingDown = false;

  constructor(protected readonly ctx: AppContext, options: SessionServiceOptions = {}) {
    this.store = new ConversationStore(ctx.paths, ctx.registry);
    this.options = {
      idleTimeoutMs: options.idleTimeoutMs ?? 2 * 60 * 60 * 1000,
      activityTimeoutMs: options.activityTimeoutMs ?? 60 * 60 * 1000,
      stopWaitMs: options.stopWaitMs ?? 2000,
      interruptGraceMs: options.interruptGraceMs ?? 15_000,
      endedRetentionMs: options.endedRetentionMs ?? 60_000,
    };
    this.createThread = options.createThread
      ?? ((launch, sink) => launch.config.provider === 'codex' ? new CodexThread(launch, sink) : new ClaudeCodeThread(launch, sink));
    this.providerStateExists = options.providerStateExists ?? ((provider, threadId) => providerStateExists(provider, threadId));
    this.mcpServerPath = options.mcpServerPath ?? defaultMcpServerPath();
    this.clock = options.now ?? (() => Date.now());
    this.nativeHistory = options.nativeHistory !== undefined ? options.nativeHistory
      : options.createThread ? null : new ProviderNativeHistory(() => ctx.settings.get().codexPath);
    this.rooms = new SseRooms((sessionId) => ({
      overflowMessage: 'Session event stream fell behind. Reconnect to refresh.',
      snapshot: () => this.snapshotFrames(sessionId),
    }));
    ctx.sessionRooms = this.rooms;
    ctx.services.sessions = this;
    this.reconcileOrphanedConversations();
    this.syncAttention();
    const marker = ctx.services as Record<symbol, unknown>;
    if (!marker[SHUTDOWN_REGISTERED]) {
      marker[SHUTDOWN_REGISTERED] = true;
      const previous = ctx.services.shutdown as (() => Promise<void>) | undefined;
      ctx.services.shutdown = async () => {
        const current = ctx.services.sessions as { shutdown(): Promise<void> } | undefined;
        await current?.shutdown();
        await previous?.();
      };
    }
  }

  abstract attentionState(): SessionAttention[];
  abstract cancel(sessionId: string): Promise<SessionCancelResponse>;
  abstract deleteHistory(conversationId: string): Promise<void>;
  abstract shutdown(): Promise<void>;
  protected abstract endSession(session: LocalSession, status: 'completed' | 'failed' | 'cancelled'): Promise<void>;
  protected abstract checkpointNative(id: string): Promise<void>;

  private reconcileOrphanedConversations(): void {
    let reconciled = 0;
    for (const row of this.ctx.registry.listConversations()) {
      if (row.status !== 'queued' && row.status !== 'running') continue;
      if (this.liveByConversation.has(row.id)) continue;
      const at = nowIso();
      if (!this.store.has(row.id)) {
        this.ctx.registry.upsertConversation({ ...row, status: 'failed', completed_at: at, updated_at: at, tier: 'waiting_for_review' });
        reconciled += 1;
        continue;
      }
      const doc = this.store.update(row.id, (draft) => {
        draft.attentionRevision = `error:${at}`;
        draft.row.status = 'failed';
        draft.row.completed_at = at;
        draft.row.updated_at = at;
        for (const message of draft.messages) {
          if (message.role === 'user' && message.delivery_state === 'queued') {
            message.delivery_state = 'superseded';
            message.delivered_at = null;
          }
        }
      });
      const summary = historySummary(doc, null);
      this.store.update(row.id, (draft) => {
        draft.row.tier = summary.tier;
        draft.row.background_updates = summary.background_updates.slice(0, MAX_DISPLAYED_PROGRESS_ENTRIES);
        draft.row.roadblocks = summary.roadblocks.slice(0, MAX_DISPLAYED_PROGRESS_ENTRIES);
      });
      reconciled += 1;
    }
    if (reconciled > 0) console.warn(`[sessions] closed ${reconciled} conversation(s) left running by a previous run`);
  }

  protected get lean(): LeanServiceLike | null {
    return (this.ctx.services.lean as LeanServiceLike | undefined) ?? null;
  }

  protected get attention(): AttentionLike | null {
    return (this.ctx.services.attention as AttentionLike | undefined) ?? null;
  }

  openProject(owner: string, repo: string, blueprintId: string): OpenProject {
    const blueprints = this.ctx.services.blueprints as BlueprintServiceLike | undefined;
    if (blueprints) return blueprints.openProject(owner, repo, blueprintId);
    const repository = this.ctx.registry.requireRepository(owner, repo);
    const blueprint = this.ctx.registry.requireBlueprint(repository.id, blueprintId);
    const projectSubdir = blueprint.project_subdir ?? '';
    return {
      repository, blueprint, clonePath: repository.path, projectSubdir,
      projectRoot: projectSubdir ? resolve(repository.path, projectSubdir) : repository.path,
      blueprintFile: blueprint.blueprint_file,
      roomKey: roomKeyFor(repository, blueprint.id),
    };
  }

  protected attachmentContext(repository: RepositoryRow): AttachmentPromptContext {
    return { paths: this.ctx.paths, registry: this.ctx.registry, repository };
  }

  protected buildStatusFor(project: OpenProject): BuildStatus {
    const lean = this.lean;
    if (!lean) return 'not_started';
    try {
      const snapshot = lean.buildSnapshot(project);
      if (snapshot && snapshot.steps.length > 0) {
        return snapshot.status === 'error' ? 'failed' : snapshot.status === 'done' ? 'done' : 'running';
      }
      return lean.buildStatus(project).status === 'done' ? 'done' : 'not_started';
    } catch {
      return 'not_started';
    }
  }

  protected leanEnvironment(project: OpenProject): LeanEnvironmentState {
    const status = this.buildStatusFor(project);
    if (status === 'running') return { kind: 'building' };
    if (status === 'failed') return { kind: 'failed', detail: 'the last Lean build failed' };
    if (status === 'done') return { kind: 'ready' };
    return existsSync(join(project.projectRoot, '.lake', 'packages')) ? { kind: 'ready' } : { kind: 'not_built' };
  }

  protected snapshotFrames(sessionId: string): SseFrame[] {
    const session = this.sessions.get(sessionId);
    if (!session || !this.lean) return [];
    try {
      const snapshot = this.lean.buildSnapshot(session.project);
      return snapshot && snapshot.steps.length > 0 ? [{ event: 'build_snapshot', data: snapshot }] : [];
    } catch {
      return [];
    }
  }

  protected requireSession(sessionId: string): LocalSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new HttpError(404, 'Session not found', 'http_404');
    return session;
  }

  protected liveInfo(session: LocalSession | undefined): LiveSessionInfo | null {
    if (!session || session.isTerminal) return null;
    return {
      status: session.status, turnActive: session.turnActive,
      hasPendingWork: session.pendingCount > 0,
      lastPersistedEventId: session.lastPersistedEventId,
    };
  }

  protected timersFor(sessionId: string): SessionTimers {
    let timers = this.timers.get(sessionId);
    if (!timers) {
      timers = { idle: null, activity: null, force: null, retention: null };
      this.timers.set(sessionId, timers);
    }
    return timers;
  }

  protected clearTimer(sessionId: string, key: keyof SessionTimers): void {
    const timers = this.timers.get(sessionId);
    if (!timers || !timers[key]) return;
    clearTimeout(timers[key] as NodeJS.Timeout);
    timers[key] = null;
  }

  protected log(session: LocalSession, message: string): void {
    console.warn(`[sessions] ${session.sessionId}: ${message}`);
  }

  protected syncAttention(): void {
    this.attention?.setUnread?.(this.attentionState().filter((entry) => entry.unread).map((entry) => entry.id));
  }

  sessionResponse(session: LocalSession): SessionResponse {
    return {
      session_id: session.sessionId, conversation_id: session.conversationId,
      agent_job_id: session.agentJobId, status: session.status, ...session.liveState(),
    };
  }

  sessionState(session: LocalSession): SessionState {
    return {
      session_id: session.sessionId, status: session.status, created_at: session.createdAt,
      total_cost_usd: session.totalCostUsd, input_tokens: session.inputTokens, output_tokens: session.outputTokens,
      execution_mode: 'background', turn_active: session.turnActive,
      active_prover_batch_id: null, active_prover_batch_total: 0, active_prover_batch_completed: 0,
      event_counter: session.eventCounter, messages: session.messages.map((message) => ({ ...message })),
      ...session.liveState(),
    };
  }

  protected activeSummary(session: LocalSession): ActiveSessionSummary {
    const state = session.liveState();
    const { repository, blueprint } = session.project;
    return {
      session_id: session.sessionId, conversation_id: session.conversationId, agent_job_id: session.agentJobId,
      repository_owner: repository.owner, repository_name: repository.name, blueprint_name: blueprint.id,
      workspace_label: blueprint.id || repository.name, status: session.status, execution_mode: 'background',
      effort_level: 'autonomous', turn_active: session.turnActive, active_prover_batch_id: null,
      active_prover_batch_total: 0, active_prover_batch_completed: 0, active_work_group_count: 0,
      created_at: session.createdAt, can_send: state.can_send, can_cancel: state.can_cancel,
      display_status: state.display_status,
    };
  }

  state(sessionId: string): SessionState {
    return this.sessionState(this.requireSession(sessionId));
  }

  async wait(sessionId: string, timeoutSeconds: unknown): Promise<SessionState> {
    const session = this.requireSession(sessionId);
    if (!session.isTerminal) {
      const timeout = clampWaitTimeout(timeoutSeconds) * 1000;
      await Promise.race([session.terminal, new Promise((resolveWait) => setTimeout(resolveWait, timeout))]);
    }
    return this.sessionState(session);
  }

  eventsResponse(c: Context, sessionId: string): Response {
    const session = this.requireSession(sessionId);
    const hasSnapshot = this.snapshotFrames(sessionId).length > 0;
    return session.room.respond(c, hasSnapshot ? (frame) => frame.event !== 'build_status' : undefined);
  }

  keepalive(sessionId: string): void {
    this.requireSession(sessionId);
  }

  liveForConversation(conversationId: string): ConversationLiveSession {
    const session = this.liveByConversation.get(conversationId);
    if (!session || session.isTerminal) throw new HttpError(404, 'Live session not found', 'http_404');
    return {
      session_id: session.sessionId, conversation_id: conversationId, agent_job_id: session.agentJobId,
      status: session.status, execution_mode: 'background', turn_active: session.turnActive,
      user_stop_requested: session.userStopRequested, active_prover_batch_id: null,
      active_prover_batch_total: 0, active_prover_batch_completed: 0,
      event_counter: session.eventCounter, last_persisted_event_id: session.lastPersistedEventId,
      ...session.liveState(),
    };
  }

  activeSessions(): ActiveSessionList {
    const sessions = [...this.sessions.values()]
      .filter((session) => !session.isTerminal)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((session) => this.activeSummary(session));
    return { sessions, active_count: sessions.length, max_active_sessions: 0 };
  }

  liveSession(conversationId: string): LocalSession | null {
    const session = this.liveByConversation.get(conversationId);
    return session && !session.isTerminal ? session : null;
  }

  private liveSessionsFor(repositoryId: number, blueprintId: string | null): LocalSession[] {
    return [...this.liveByConversation.values()].filter((session) =>
      !session.isTerminal && session.project.repository.id === repositoryId
      && (blueprintId === null || session.project.blueprint.id === blueprintId));
  }

  isBlueprintBusy(target: number | OpenProject, blueprintId?: string): boolean {
    const repositoryId = typeof target === 'number' ? target : target.repository.id;
    const blueprint = typeof target === 'number' ? (blueprintId ?? null) : target.blueprint.id;
    return this.liveSessionsFor(repositoryId, blueprint).some((session) =>
      session.currentTurn !== null || session.turnActive || session.pendingCount > 0);
  }

  hasActiveSession(repositoryId: number, blueprintId: string | null): boolean {
    return this.liveSessionsFor(repositoryId, blueprintId).length > 0;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    if (!this.store.has(conversationId)) {
      this.ctx.registry.deleteConversation(conversationId);
      return;
    }
    await this.deleteHistory(conversationId);
  }

  abstract respondPermission(sessionId: string, requestId: string, decision: PermissionDecision): Promise<void>;
}
