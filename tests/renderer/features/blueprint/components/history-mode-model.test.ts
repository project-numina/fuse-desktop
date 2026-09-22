import { describe, expect, it } from 'vitest';
import {
  historyRowPresentation,
  historySnippet,
  isTerminalSessionStatus,
  type SessionHistorySummary,
} from '@/features/blueprint/components/history-mode-model';

const session: SessionHistorySummary = {
  id: 's1', title: null, status: 'running', tier: 'active', blueprint_name: 'bp',
  created_at: '2026-01-01T00:00:00Z', completed_at: null,
  first_message: 'first', last_message: null, last_message_at: null,
};

describe('history mode model', () => {
  it('derives snippets with the expected fallbacks and limit', () => {
    expect(historySnippet(session)).toBe('first');
    expect(historySnippet({ ...session, first_message: null })).toBe('No transcript yet');
    expect(historySnippet({ ...session, last_message: 'x'.repeat(200) }).length).toBe(141);
  });

  it('merges live attention over persisted tier state', () => {
    expect(historyRowPresentation(session)).toEqual({ status: 'Running', unread: false });
    expect(historyRowPresentation(session, {
      id: 's1', owner: 'o', repository: 'r', blueprint: 'bp', revision: '1', state: 'needs_input', unread: true,
    })).toEqual({ status: 'Needs input', unread: true });
    expect(historyRowPresentation({ ...session, tier: 'waiting_for_review' })).toEqual({ status: null, unread: true });
  });

  it('recognizes every terminal session status', () => {
    expect(['completed', 'failed', 'cancelled'].every(isTerminalSessionStatus)).toBe(true);
    expect(isTerminalSessionStatus('running')).toBe(false);
    expect(isTerminalSessionStatus(null)).toBe(false);
  });
});
