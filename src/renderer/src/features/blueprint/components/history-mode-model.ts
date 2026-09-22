import type { SessionAttention } from '@shared/session-attention';
import { truncate } from '@/lib/display';

export const HISTORY_PAGE_SIZE = 20;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

/** One past agent session returned by `/sessions/history`. */
export interface SessionHistorySummary {
  provider?: 'claude' | 'codex';
  id: string;
  title: string | null;
  status: string;
  tier: 'active' | 'waiting_for_review' | 'completed';
  blueprint_name: string;
  created_at: string;
  completed_at: string | null;
  first_message: string | null;
  last_message: string | null;
  last_message_at: string | null;
}

export interface HistoryModeProps {
  owner: string;
  repo: string;
  blueprintId: string;
  onSelectSession?: (sessionId: string) => void | Promise<void>;
  onNewChat?: () => void;
  readOnly?: boolean;
  activeSessionId?: string | null;
  currentJobId?: string | null;
  sessionStatus?: string | null;
  className?: string;
}

export interface HistoryRowPresentation {
  status: 'Needs input' | 'Running' | 'Error' | null;
  unread: boolean;
}

export function historySnippet(session: SessionHistorySummary): string {
  return truncate(session.last_message || session.first_message || 'No transcript yet', 140);
}

/** Merge persisted history tier with the fresher live attention signal. */
export function historyRowPresentation(session: SessionHistorySummary, signal?: SessionAttention): HistoryRowPresentation {
  const status = signal?.state === 'needs_input' ? 'Needs input'
    : signal?.state === 'running' || (!signal && session.tier === 'active') ? 'Running'
      : signal?.state === 'error' ? 'Error' : null;
  return { status, unread: signal?.unread ?? session.tier === 'waiting_for_review' };
}

export function isTerminalSessionStatus(status: string | null | undefined): boolean {
  return !!status && TERMINAL_STATUSES.has(status);
}
