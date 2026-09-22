/** Public facade for durable conversations and live provider sessions. */

import { nowIso } from '../../store/registry';
import { SessionOperations } from './service/operations';
import type { LocalSession } from './session';
import { historySummary } from './transcript';

export { SESSION_WAIT_DEFAULT_SECONDS, SESSION_WAIT_MAX_SECONDS } from './service/core';
export type { SessionServiceOptions } from './service/core';
export { MAX_PENDING_USER_MESSAGES } from './session';
export type { LocalSession } from './session';

export const AGENT_COMMIT_IDENTITY = {
  name: 'fuse-desktop[bot]',
  email: 'fuse-desktop[bot]@users.noreply.github.com',
};

export class SessionService extends SessionOperations {
  /** Persist terminal state before waiting for provider teardown during app quit. */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const live = [...this.liveByConversation.values()].filter((session) => !session.isTerminal);
    for (const session of live) this.persistForShutdown(session);
    this.store.flushSync();
    this.ctx.registry.flushSync();
    await Promise.all(live.map(async (session) => {
      session.messageAdmissionClosed = true;
      if (session.currentTurn) {
        void this.threads.get(session.sessionId)?.interrupt();
        await Promise.race([
          session.terminal,
          new Promise((resolveWait) => setTimeout(resolveWait, this.options.stopWaitMs)),
        ]);
      }
      if (!session.isTerminal) await this.endSession(session, 'completed');
    }));
    for (const timers of this.timers.values()) {
      for (const key of ['idle', 'activity', 'force', 'retention'] as const) {
        if (timers[key]) clearTimeout(timers[key] as NodeJS.Timeout);
      }
    }
    this.timers.clear();
    this.store.flushSync();
  }

  private persistForShutdown(session: LocalSession): void {
    try {
      const at = nowIso();
      const doc = this.store.update(session.conversationId, (draft) => {
        if (session.currentTurn && draft.messages.some((message) => message.role === 'agent')) {
          draft.attentionRevision = `partial:${at}`;
        }
        draft.row.status = 'completed';
        draft.row.completed_at = at;
        draft.row.updated_at = at;
        for (const message of draft.messages) {
          if (message.role === 'user' && message.delivery_state === 'queued') {
            message.delivery_state = 'superseded';
            message.delivered_at = null;
          }
        }
      });
      this.store.updateRow(session.conversationId, { tier: historySummary(doc, null).tier });
    } catch (error) {
      this.log(session, `could not close the conversation row for shutdown: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
