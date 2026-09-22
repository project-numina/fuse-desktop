import { describe, expect, it, vi } from 'vitest';

import type { BlueprintCommit } from '@/lib/api';

import {
  actorInitial,
  buildBody,
  groupCommitsByDay,
  isBotAuthor,
  NUMINA_BOT_AVATAR,
  timeLabel,
  toCommitView,
} from '@/features/blueprint/lib/commit-history';

function makeCommit(overrides: Partial<BlueprintCommit> = {}): BlueprintCommit {
  return {
    sha: '0123456789abcdef',
    message: 'Do the thing',
    author_name: 'Ada Lovelace',
    author_login: 'ada',
    author_avatar_url: 'https://example.test/ada.png',
    authored_at: '2026-04-08T12:00:00Z',
    html_url: 'https://example.test/commit',
    ...overrides,
  };
}

describe('commit history helpers', () => {
  it('detects bot logins and display names', () => {
    expect(isBotAuthor('numina[bot]', null)).toBe(true);
    expect(isBotAuthor(null, 'Some Bot[bot]')).toBe(true);
    expect(isBotAuthor('ada', 'Ada')).toBe(false);
  });

  it('removes the subject, blank lines, and all metadata trailers from a body', () => {
    const message = [
      'Add health endpoint', '', 'First line.', 'Second line.',
      'User: ada', 'Blueprint: foo', 'Repository: bar',
      'Agent job: 123', 'Conversation: 456',
    ].join('\n');
    expect(buildBody(message)).toBe('First line.\nSecond line.');
  });

  it('turns a raw commit into its display model', () => {
    const view = toCommitView(makeCommit({ message: 'Fix bug\n\nDetails here' }));
    expect(view).toMatchObject({
      subject: 'Fix bug',
      body: 'Details here',
      actor: 'Ada Lovelace',
      avatarUrl: 'https://example.test/ada.png',
      shortSha: '0123456',
      isIncomplete: false,
    });
    expect(view.timestamp).toBeInstanceOf(Date);
    expect(view.raw.sha).toBe('0123456789abcdef');
  });

  it('uses branded bot identity and recognizes incomplete work', () => {
    const view = toCommitView(makeCommit({
      author_login: 'numina[bot]',
      message: 'Agent (incomplete): partial work',
    }));
    expect(view.actor).toBe('Numina Fuse');
    expect(view.avatarUrl).toBe(NUMINA_BOT_AVATAR);
    expect(view.isIncomplete).toBe(true);
  });

  it('falls back safely when commit identity and message are absent', () => {
    const view = toCommitView(makeCommit({
      message: '', author_name: null, author_login: null, authored_at: null,
    }));
    expect(view.subject).toBe('(no message)');
    expect(view.actor).toBe('unknown');
    expect(view.timestamp).toBeNull();
  });

  it('groups same-day commits and unknown dates in insertion order', () => {
    const views = [
      toCommitView(makeCommit({ sha: 'a', authored_at: '2026-04-08T09:00:00Z' })),
      toCommitView(makeCommit({ sha: 'b', authored_at: '2026-04-08T18:00:00Z' })),
      toCommitView(makeCommit({ sha: 'c', authored_at: null })),
    ];
    const days = groupCommitsByDay(views);
    expect(days).toHaveLength(2);
    expect(days[0].entries.map(entry => entry.raw.sha)).toEqual(['a', 'b']);
    expect(days[1]).toMatchObject({ key: 'unknown', label: 'Unknown date' });
  });

  it('labels today and yesterday relative to the local clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 8, 12));
    const views = [
      toCommitView(makeCommit({ authored_at: new Date(2026, 3, 8, 9).toISOString() })),
      toCommitView(makeCommit({ authored_at: new Date(2026, 3, 7, 9).toISOString() })),
    ];
    expect(groupCommitsByDay(views).map(day => day.label)).toEqual(['Today', 'Yesterday']);
    vi.useRealTimers();
  });

  it('formats times and actor initials', () => {
    expect(timeLabel(null)).toBe('');
    expect(timeLabel(new Date('2026-04-08T12:00:00Z'))).not.toBe('');
    expect(actorInitial(' ada')).toBe('A');
    expect(actorInitial('   ')).toBe('?');
  });
});
