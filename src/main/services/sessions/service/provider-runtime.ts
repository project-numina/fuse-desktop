import { randomUUID } from 'node:crypto';
import type { AgentEvent } from '@shared/agent-events';
import type { ProviderThread } from '../../../agents/types';
import type { ConversationRow } from '../../../store/rows';
import type { OpenProject } from '../../types';
import { buildThreadLaunch, inferLeanModule, promptPlacement } from '../launch';
import { isMissingProviderThreadError } from '../provider-state';
import {
  AUTONOMOUS_RECOVERY_PROMPT, buildAdditionalUserMessage, buildFollowUpPrompt, buildInitialPrompt,
} from '../prompts';
import type { InitialTurn } from './core';
import { SessionHistoryService } from './history';
import type { LocalSession, QueuedUserMessage, TurnEndEvent, TurnKind, TurnRecord } from '../session';

/** Provider-thread lifecycle, turn sequencing, and timeout recovery. */
export abstract class SessionProviderRuntime extends SessionHistoryService {
  protected resumableProviderThread(row: ConversationRow, project: OpenProject, hasRetainedMessages: boolean): string | null {
    const threadId = row.provider_thread_id;
    if (!threadId || row.provider !== project.blueprint.agent.provider || hasRetainedMessages) return null;
    if (!this.store.get(row.id)?.nativeRef && !this.providerStateExists(project.blueprint.agent.provider, threadId)) {
      console.warn(`[sessions] ${row.id}: provider thread ${threadId} is gone; replaying the transcript instead`);
      return null;
    }
    return threadId;
  }

  protected async startSession(session: LocalSession): Promise<void> {
    if (session.isTerminal) return;
    const initial = this.initialTurns.get(session.sessionId);
    if (!initial) return;
    try {
      session.publish('chat', initial.chat);
      session.markRunning();
      this.store.updateRow(session.conversationId, { status: 'running', tier: 'active' });
      this.launchInitialTurn(session, initial);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      session.publish('error', { message: `Failed to start the agent: ${message}` });
      session.turnActive = false;
      session.publish('turn_status', { turn_active: false });
      await this.endSession(session, 'failed');
    }
  }

  private launchInitialTurn(session: LocalSession, initial: InitialTurn): void {
    const thread = this.ensureThread(session);
    const prompt = buildInitialPrompt({
      placement: promptPlacement(this.launchInput(session)),
      environment: this.leanEnvironment(session.project),
      message: initial.chat.content,
      attachments: initial.attachments,
      resumeMessages: initial.resume?.messages ?? [],
      providerResumes: thread.providerThreadId !== null,
      attachmentContext: this.attachmentContext(session.project.repository),
    });
    this.beginTurn(session, 'initial', initial.chat.content, prompt, []);
  }

  private interceptResumeFailure(session: LocalSession, event: AgentEvent): boolean {
    if (event.kind !== 'turn_failed' || !isMissingProviderThreadError(event.message)) return false;
    const initial = this.initialTurns.get(session.sessionId);
    if (!initial || !initial.resumeRetryAvailable || session.currentTurn?.kind !== 'initial' || session.isTerminal) return false;
    initial.resumeRetryAvailable = false;
    this.log(session, `provider thread ${session.providerThreadId ?? '?'} is gone; restarting with the transcript replayed`);
    const stale = this.threads.get(session.sessionId);
    this.threads.delete(session.sessionId);
    stale?.close().catch(() => undefined);
    session.providerThreadId = null;
    this.store.updateRow(session.conversationId, { provider_thread_id: null });
    try {
      this.launchInitialTurn(session, initial);
    } catch (error) {
      session.consume({
        kind: 'turn_failed', turnId: event.turnId,
        message: error instanceof Error ? error.message : String(error), at: this.clock(),
      });
    }
    return true;
  }

  private launchInput(session: LocalSession) {
    const { provider } = session.project.blueprint.agent;
    const settings = this.ctx.settings.get();
    const nativeRef = this.store.get(session.conversationId)?.nativeRef;
    return {
      conversationId: session.conversationId, project: session.project,
      paths: this.ctx.paths, resourcesDir: this.ctx.resourcesDir, server: this.ctx.server,
      executable: provider === 'codex' ? settings.codexPath : settings.claudePath,
      providerThreadId: session.providerThreadId,
      workingDirectory: nativeRef?.provider === provider ? nativeRef.directory : undefined,
      mcpServerPath: this.mcpServerPath,
      leanModule: inferLeanModule(session.project.projectRoot),
    };
  }

  private ensureThread(session: LocalSession): ProviderThread {
    const existing = this.threads.get(session.sessionId);
    if (existing) return existing;
    const launch = buildThreadLaunch(this.launchInput(session));
    const thread = this.createThread(launch, (event) => {
      if (this.threads.get(session.sessionId) !== thread) return;
      if (this.interceptResumeFailure(session, event)) return;
      session.consume(event);
    });
    this.threads.set(session.sessionId, thread);
    return thread;
  }

  private beginTurn(session: LocalSession, kind: TurnKind, userMessage: string, prompt: string, delivered: QueuedUserMessage[]): void {
    if (session.isTerminal) return;
    const thread = this.ensureThread(session);
    const turnId = randomUUID();
    const startedAt = this.clock();
    session.beginTurn({ turnId, kind, userMessage, startedAt, wroteLeanFiles: false, hadError: false, lastActivityAt: startedAt });
    session.steerTarget = typeof thread.steer === 'function' ? { steer: (text) => thread.steer!(text) } : null;
    for (const message of delivered) session.recordDeliveryState(message, 'delivered');
    this.clearTimer(session.sessionId, 'idle');
    this.armActivityTimer(session);
    void thread.send(turnId, prompt).catch((error: unknown) => {
      session.consume({
        kind: 'turn_failed', turnId,
        message: error instanceof Error ? error.message : String(error), at: this.clock(),
      });
    });
  }

  protected startFollowUpTurn(session: LocalSession): void {
    const messages = session.drainQueue();
    if (messages.length === 0) return;
    const context = this.attachmentContext(session.project.repository);
    const [first, ...rest] = messages;
    const parts = [buildFollowUpPrompt(this.leanEnvironment(session.project), first.content, first.contextAttachments, context)];
    for (const extra of rest) parts.push(buildAdditionalUserMessage(extra.content, extra.contextAttachments, context));
    this.beginTurn(session, 'follow_up', first.content, parts.join('\n\n'), messages);
  }

  private armActivityTimer(session: LocalSession): void {
    this.clearTimer(session.sessionId, 'activity');
    const timers = this.timersFor(session.sessionId);
    const check = (): void => {
      timers.activity = null;
      if (session.isTerminal || !session.currentTurn) return;
      if (session.pendingPermissionIds.size > 0) {
        session.lastActivityAt = this.clock();
        timers.activity = setTimeout(check, this.options.activityTimeoutMs);
        return;
      }
      const silentFor = this.clock() - session.lastActivityAt;
      if (silentFor < this.options.activityTimeoutMs) {
        timers.activity = setTimeout(check, this.options.activityTimeoutMs - silentFor);
        return;
      }
      this.activityTimedOut.add(session.sessionId);
      this.log(session, 'no provider output for the activity timeout; interrupting the turn');
      void this.threads.get(session.sessionId)?.interrupt();
      this.armForceStop(session);
    };
    timers.activity = setTimeout(check, this.options.activityTimeoutMs);
  }

  protected armForceStop(session: LocalSession): void {
    this.clearTimer(session.sessionId, 'force');
    const timers = this.timersFor(session.sessionId);
    timers.force = setTimeout(() => {
      timers.force = null;
      if (session.isTerminal || !session.currentTurn) return;
      this.log(session, 'the turn did not end after the interrupt; closing the provider thread');
      void this.threads.get(session.sessionId)?.close();
      setTimeout(() => {
        if (!session.isTerminal && session.currentTurn) {
          session.consume({ kind: 'turn_interrupted', turnId: session.currentTurn.turnId, at: this.clock() });
        }
      }, 1000);
    }, this.options.interruptGraceMs);
  }

  protected onTurnEnded(session: LocalSession, event: TurnEndEvent, turn: TurnRecord): void {
    this.clearTimer(session.sessionId, 'activity');
    this.clearTimer(session.sessionId, 'force');
    this.postTurnInProgress.add(session.sessionId);
    void this.completeTurn(session, event, turn).finally(() => {
      this.postTurnInProgress.delete(session.sessionId);
    });
  }

  private async completeTurn(session: LocalSession, event: TurnEndEvent, turn: TurnRecord): Promise<void> {
    const timedOut = this.activityTimedOut.delete(session.sessionId);
    if (turn.kind === 'initial') this.initialTurns.delete(session.sessionId);
    this.store.updateRow(session.conversationId, {
      input_tokens: session.inputTokens, output_tokens: session.outputTokens,
      total_cost_usd: session.totalCostUsd,
      provider_thread_id: session.providerThreadId ?? this.threads.get(session.sessionId)?.providerThreadId ?? null,
    });
    if (session.isTerminal) return;
    if (session.userStopRequested) return this.endSession(session, 'cancelled');
    if (this.shuttingDown) return this.endSession(session, 'completed');
    if (event.kind === 'turn_failed') return this.endSession(session, 'failed');
    if (event.kind === 'turn_interrupted' && timedOut) {
      if (!session.recoveryAttempted) {
        session.recoveryAttempted = true;
        session.publish('agent_status', { status: 'recovering', reason: 'autonomous_activity_timeout' });
        this.beginTurn(session, 'control', '', AUTONOMOUS_RECOVERY_PROMPT, []);
        return;
      }
      session.publish('error', { message: 'The agent produced no output for the activity timeout twice in a row; the session was stopped.' });
      await this.endSession(session, 'failed');
      return;
    }
    if (session.queue.length > 0) {
      this.startFollowUpTurn(session);
      return;
    }
    this.armIdleTimer(session);
    void this.checkpointNative(session.conversationId);
  }

  private armIdleTimer(session: LocalSession): void {
    this.clearTimer(session.sessionId, 'idle');
    const timers = this.timersFor(session.sessionId);
    timers.idle = setTimeout(() => {
      timers.idle = null;
      if (session.isTerminal || session.currentTurn || session.queue.length > 0) return;
      void this.endSession(session, 'completed');
    }, this.options.idleTimeoutMs);
  }
}
