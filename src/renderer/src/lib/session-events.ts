export const SESSION_HISTORY_CHANGED_EVENT = 'session-history-changed';

export function notifySessionHistoryChanged(sessionId: string): void {
  window.dispatchEvent(new CustomEvent(SESSION_HISTORY_CHANGED_EVENT, {
    detail: { sessionId },
  }));
}
