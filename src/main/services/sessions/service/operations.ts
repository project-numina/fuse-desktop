import { randomUUID } from 'node:crypto';
import type { AgentEvent, PermissionDecision } from '@shared/agent-events';
import type {
  ChatContextAttachmentPayload, MessageCreate, SessionCancelResponse, SessionChatMessage,
  SessionCreate, SessionMessageResponse, SessionResponse,
} from '@shared/api-types';
import { HttpError } from '../../../server/errors';
import { nowIso } from '../../../store/registry';
import type { ConversationRow, TranscriptRow } from '../../../store/rows';
import type { OpenProject } from '../../types';
import { resolveContextAttachments } from '../attachments';
import { titleFromPrompt } from '../prompts';
import type { ResumeContext } from './core';
import { SessionProviderRuntime } from './provider-runtime';
import {
  LocalSession, MAX_PENDING_USER_MESSAGES,
  type LocalSessionInit, type QueuedUserMessage,
} from '../session';
import { MAX_DISPLAYED_PROGRESS_ENTRIES, historySummary, resumeTranscript, type StoredConversationFile } from '../transcript';

function validateCreate(body: SessionCreate): { initialMessage: string; owner: string; repo: string; blueprint: string } {
  const initialMessage = typeof body.initial_message === 'string' ? body.initial_message : '';
  if (!initialMessage.trim()) throw new HttpError(422, 'initial_message must not be empty', 'validation_error');
  if (typeof body.repository_owner !== 'string' || typeof body.repository_name !== 'string') {
    throw new HttpError(422, 'repository_owner and repository_name are required', 'validation_error');
  }
  if (!body.blueprint_name) throw new HttpError(404, 'Blueprint not found', 'http_404');
  return {
    initialMessage,
    owner: body.repository_owner,
    repo: body.repository_name,
    blueprint: body.blueprint_name,
  };
}

/** Conversation creation and live-session mutation operations. */
export abstract class SessionOperations extends SessionProviderRuntime {
  async createSession(body: SessionCreate): Promise<SessionResponse> {
    if (this.shuttingDown) throw new HttpError(503, 'The app is shutting down.', 'http_503');
    const { initialMessage, owner, repo, blueprint } = validateCreate(body);
    const repository = this.ctx.registry.requireRepository(owner, repo);
    let project = this.openProject(owner, repo, blueprint);
    const attachments = resolveContextAttachments(body.context_attachments, this.attachmentContext(repository));
    let resume: ResumeContext | null = null;
    let doc: StoredConversationFile;
    if (body.resume_from_conversation_id) {
      const existing = await this.historyDocument(body.resume_from_conversation_id);
      if (!existing) throw new HttpError(404, 'Resume conversation not found', 'http_404');
      if (existing.row.repository_id !== repository.id || existing.row.blueprint_id !== project.blueprint.id) {
        throw new HttpError(400, 'Resume conversation must match the current repository and workspace', 'http_400');
      }
      const live = this.liveByConversation.get(existing.row.id);
      if (live && !live.isTerminal) {
        await this.acceptMessage(live, initialMessage, attachments);
        return this.sessionResponse(live);
      }
      ({ doc, project, resume } = this.prepareResume(existing, project));
    } else {
      doc = this.createConversation(project, initialMessage);
    }
    const conversationId = doc.row.id;
    this.appendInitialMessage(conversationId, initialMessage, attachments);
    const sessionId = randomUUID();
    const initialChat: SessionChatMessage = { role: 'user', content: initialMessage };
    if (attachments.length > 0) initialChat.context_attachments = attachments;
    const session = new LocalSession(this.localSessionInit(sessionId, conversationId, project, initialChat, resume));
    this.registerSession(session, initialChat, attachments, resume);
    this.ctx.registry.touchRepository(repository.id);
    const response = this.sessionResponse(session);
    setImmediate(() => { void this.startSession(session); });
    return response;
  }

  private registerSession(session: LocalSession, chat: SessionChatMessage, attachments: ChatContextAttachmentPayload[], resume: ResumeContext | null): void {
    session.retainedMessageIds.push(...(resume?.retainedMessageIds ?? []));
    session.turnActive = true;
    this.sessions.set(session.sessionId, session);
    this.liveByConversation.set(session.conversationId, session);
    this.initialTurns.set(session.sessionId, {
      chat, attachments, resume,
      resumeRetryAvailable: resume !== null && resume.providerThreadId !== null,
    });
  }

  private prepareResume(existing: StoredConversationFile, initialProject: OpenProject): {
    doc: StoredConversationFile; project: OpenProject; resume: ResumeContext;
  } {
    const project = existing.nativeRef && existing.row.provider !== initialProject.blueprint.agent.provider
      ? {
          ...initialProject,
          blueprint: {
            ...initialProject.blueprint,
            agent: { ...initialProject.blueprint.agent, provider: existing.row.provider, model: '', effort: null },
          },
        }
      : initialProject;
    const transcript = resumeTranscript(existing);
    const retainedMessageIds = transcript.flatMap((entry) => entry.message_id ? [entry.message_id] : []);
    const resume: ResumeContext = {
      messages: transcript.map((entry) => ({
        role: entry.role, content: entry.content,
        ...(entry.delivery_state ? { delivery_state: entry.delivery_state } : {}),
        ...(entry.message_id ? { message_id: entry.message_id } : {}),
        ...(entry.context_attachments ? { context_attachments: entry.context_attachments as unknown as ChatContextAttachmentPayload[] } : {}),
      })),
      retainedMessageIds,
      providerThreadId: this.resumableProviderThread(existing.row, project, retainedMessageIds.length > 0),
    };
    const doc = this.store.update(existing.row.id, (draft) => {
      Object.assign(draft.row, {
        status: 'queued', completed_at: null, tier: 'active',
        provider: project.blueprint.agent.provider,
        provider_thread_id: resume.providerThreadId, updated_at: nowIso(),
      });
      draft.last_persisted_event_id = 0;
      draft.background_started_at = nowIso();
      draft.background_reviewed_at = null;
    });
    return { doc, project, resume };
  }

  private createConversation(project: OpenProject, initialMessage: string): StoredConversationFile {
    const createdAt = nowIso();
    const row: ConversationRow = {
      id: randomUUID(), repository_id: project.repository.id, blueprint_id: project.blueprint.id,
      title: titleFromPrompt(initialMessage), status: 'queued', created_at: createdAt,
      updated_at: createdAt, completed_at: null, input_tokens: null, output_tokens: null,
      total_cost_usd: null, provider_thread_id: null, provider: project.blueprint.agent.provider,
      tier: 'active', background_updates: [], roadblocks: [],
    };
    const doc = this.store.create(row, { background_started_at: createdAt });
    this.store.update(row.id, (draft) => {
      draft.nativeEligible = true;
      draft.attentionRevision = 'initial';
      draft.seenRevision = 'initial';
    });
    return doc;
  }

  private appendInitialMessage(conversationId: string, content: string, attachments: ChatContextAttachmentPayload[]): void {
    this.store.appendRow(conversationId, {
      id: randomUUID(), role: 'user', content, created_at: nowIso(), delivered_at: null,
      delivery_state: null, context_attachments: attachments as unknown as Array<Record<string, unknown>>,
      event_kind: null, tool_name: null, tool_use_id: null, parent_tool_use_id: null, is_subagent: false,
    }, null);
  }

  private localSessionInit(sessionId: string, conversationId: string, project: OpenProject, initialChat: SessionChatMessage, resume: ResumeContext | null): LocalSessionInit {
    return {
      sessionId, conversationId, agentJobId: randomUUID(), project, room: this.rooms.get(sessionId),
      transcript: {
        appendRow: (row: TranscriptRow, boundary: number | null) => this.store.appendRow(conversationId, row, boundary),
        setDeliveryState: (messageId, state, options) => this.store.setDeliveryState(conversationId, messageId, state, options),
        advanceBoundary: (eventId) => this.store.setLastPersistedEventId(conversationId, eventId),
      },
      hooks: {
        onTurnEnded: (target, event, turn) => this.onTurnEnded(target, event, turn),
        onThreadStarted: (target, providerThreadId) => this.store.updateRow(target.conversationId, { provider_thread_id: providerThreadId }),
        onEvent: (target, event) => this.onSessionEvent(target.conversationId, event),
      },
      attachmentContext: this.attachmentContext(project.repository),
      initialMessages: [...(resume?.messages ?? []), initialChat],
      model: project.blueprint.agent.model || null, providerThreadId: resume?.providerThreadId ?? null,
      now: this.clock, buildStatus: () => this.buildStatusFor(project),
    };
  }

  private onSessionEvent(conversationId: string, event: AgentEvent): void {
    if (event.kind === 'turn_completed' || event.kind === 'turn_failed') {
      this.store.update(conversationId, (draft) => {
        draft.attentionRevision = `${event.kind}:${event.turnId}:${randomUUID()}`;
        draft.background_reviewed_at = null;
      });
      this.syncAttention();
    }
    this.attention?.observe(conversationId, event);
  }

  async sendMessage(sessionId: string, body: MessageCreate): Promise<SessionMessageResponse> {
    const session = this.requireSession(sessionId);
    const content = typeof body?.content === 'string' ? body.content : '';
    if (!content.trim()) throw new HttpError(422, 'content must not be empty', 'validation_error');
    const attachments = resolveContextAttachments(body.context_attachments, this.attachmentContext(session.project.repository));
    const messageId = await this.acceptMessage(session, content, attachments);
    return { status: 'accepted', message_id: messageId, delivery_state: 'queued' };
  }

  private async acceptMessage(session: LocalSession, content: string, attachments: ChatContextAttachmentPayload[]): Promise<string> {
    if (session.isTerminal) throw new HttpError(400, `Session is not running (status: ${session.status})`, 'http_400');
    if (session.userStopRequested) throw new HttpError(409, 'Session is stopping.', 'http_409');
    if (session.messageAdmissionClosed) throw new HttpError(409, 'Session is finishing and cannot accept new messages.', 'http_409');
    if (!session.hasUserMessageCapacity) {
      throw new HttpError(429, `${MAX_PENDING_USER_MESSAGES} messages are already waiting for the agent. Wait for it to work through them before sending more.`, 'http_429');
    }
    const messageId = randomUUID();
    this.store.appendRow(session.conversationId, {
      id: messageId, role: 'user', content, created_at: nowIso(), delivered_at: null,
      delivery_state: 'queued', context_attachments: attachments as unknown as Array<Record<string, unknown>>,
      event_kind: null, tool_name: null, tool_use_id: null, parent_tool_use_id: null, is_subagent: false,
    }, null);
    const message: QueuedUserMessage = { messageId, content, contextAttachments: attachments };
    if (session.acceptsSteering) session.pendingSteers.push(message);
    else session.enqueue(message);
    session.announceAccepted(message);
    session.deliverPendingSteers();
    this.clearTimer(session.sessionId, 'idle');
    if (!session.currentTurn && !this.postTurnInProgress.has(session.sessionId) && session.status === 'running') {
      this.startFollowUpTurn(session);
    }
    return messageId;
  }

  async cancel(sessionId: string): Promise<SessionCancelResponse> {
    const session = this.requireSession(sessionId);
    if (!session.isTerminal && !session.userStopRequested) {
      session.userStopRequested = true;
      session.messageAdmissionClosed = true;
      this.clearTimer(sessionId, 'idle');
      if (session.currentTurn) {
        void this.threads.get(sessionId)?.interrupt();
        this.armForceStop(session);
      } else if (!this.postTurnInProgress.has(sessionId)) {
        void this.endSession(session, 'cancelled');
      }
    }
    await Promise.race([session.terminal, new Promise((resolveWait) => setTimeout(resolveWait, this.options.stopWaitMs))]);
    return { status: 'stop_requested', message_delivery_states: session.stopDeliveryStates() };
  }

  protected async endSession(session: LocalSession, status: 'completed' | 'failed' | 'cancelled'): Promise<void> {
    if (session.isTerminal) return;
    this.clearTimer(session.sessionId, 'idle');
    this.clearTimer(session.sessionId, 'activity');
    this.clearTimer(session.sessionId, 'force');
    session.messageAdmissionClosed = true;
    session.finalizeUndeliveredMessages();
    session.flushLiveChildAgents();
    session.markEnded(status);
    this.initialTurns.delete(session.sessionId);
    const thread = this.threads.get(session.sessionId);
    this.threads.delete(session.sessionId);
    if (this.liveByConversation.get(session.conversationId) === session) this.liveByConversation.delete(session.conversationId);
    const doc = this.store.update(session.conversationId, (draft) => {
      if (status === 'failed' && !draft.attentionRevision?.startsWith('turn_failed:')) {
        draft.attentionRevision = `error:${randomUUID()}`;
      }
      draft.row.status = status;
      draft.row.completed_at = nowIso();
      draft.row.input_tokens = session.inputTokens;
      draft.row.output_tokens = session.outputTokens;
      draft.row.total_cost_usd = session.totalCostUsd;
      draft.row.provider_thread_id = session.providerThreadId ?? thread?.providerThreadId ?? draft.row.provider_thread_id;
      draft.row.updated_at = nowIso();
    });
    const summary = historySummary(doc, null);
    this.syncAttention();
    this.store.update(session.conversationId, (draft) => {
      draft.row.tier = summary.tier;
      draft.row.background_updates = summary.background_updates.slice(0, MAX_DISPLAYED_PROGRESS_ENTRIES);
      draft.row.roadblocks = summary.roadblocks.slice(0, MAX_DISPLAYED_PROGRESS_ENTRIES);
    });
    await this.store.settled(session.conversationId);
    session.publish('session_end', { status });
    session.room.close();
    session.markClosed();
    if (thread) thread.close().catch(() => undefined);
    this.scheduleRetention(session);
  }

  private scheduleRetention(session: LocalSession): void {
    const timers = this.timersFor(session.sessionId);
    timers.retention = setTimeout(() => {
      this.sessions.delete(session.sessionId);
      this.rooms.delete(session.sessionId);
      this.timers.delete(session.sessionId);
    }, this.options.endedRetentionMs);
    timers.retention.unref?.();
  }

  async respondPermission(sessionId: string, requestId: string, decision: PermissionDecision): Promise<void> {
    const session = this.requireSession(sessionId);
    if (session.isTerminal) throw new HttpError(400, `Session is not running (status: ${session.status})`, 'http_400');
    const thread = this.threads.get(sessionId);
    if (!thread) throw new HttpError(409, 'No agent process is attached to this session.', 'http_409');
    const answered = await thread.respondPermission(requestId, decision);
    if (!answered) throw new HttpError(409, 'This permission request is no longer pending.', 'http_409');
  }
}
