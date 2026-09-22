/**
 * Pure helpers for presenting blueprint commit history: turning raw commits
 * into display "views", grouping them by day, and formatting actors/avatars.
 */

import type { BlueprintCommit } from '@/lib/api';

export const NUMINA_BOT_AVATAR = '/numina_logo.svg';

export interface CommitView {
  raw: BlueprintCommit;
  subject: string;
  body: string;
  actor: string;
  avatarUrl: string | null;
  shortSha: string;
  timestamp: Date | null;
  isIncomplete: boolean;
}

export interface CommitDay {
  key: string;
  label: string;
  entries: CommitView[];
}

export function isBotAuthor(rawLogin: string | null, rawName: string | null): boolean {
  return (rawLogin || '').endsWith('[bot]') || (rawName || '').endsWith('[bot]');
}

/**
 * Drops the subject line and the trailer metadata lines (``User:``,
 * ``Blueprint:`` …) from a commit message, leaving the human body.
 */
export function buildBody(message: string): string {
  const lines = message.split('\n').slice(1);
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    return !/^(User|Blueprint|Repository|Agent job|Conversation):/.test(trimmed);
  });
  return filtered.join('\n').trim();
}

export function toCommitView(raw: BlueprintCommit): CommitView {
  const subject = (raw.message.split('\n', 1)[0] ?? '').trim() || '(no message)';
  const bot = isBotAuthor(raw.author_login, raw.author_name);
  return {
    raw,
    subject,
    body: buildBody(raw.message),
    actor: bot ? 'Numina Fuse' : (raw.author_name || raw.author_login || 'unknown'),
    avatarUrl: bot ? NUMINA_BOT_AVATAR : raw.author_avatar_url,
    shortSha: raw.sha.slice(0, 7),
    timestamp: raw.authored_at ? new Date(raw.authored_at) : null,
    isIncomplete: subject.startsWith('Agent (incomplete):'),
  };
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(date) === dayKey(today)) return 'Today';
  if (dayKey(date) === dayKey(yesterday)) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

export function groupCommitsByDay(views: CommitView[]): CommitDay[] {
  const buckets = new Map<string, CommitDay>();
  for (const view of views) {
    const timestamp = view.timestamp ?? new Date(0);
    const key = view.timestamp ? dayKey(timestamp) : 'unknown';
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        key,
        label: view.timestamp ? dayLabel(timestamp) : 'Unknown date',
        entries: [],
      };
      buckets.set(key, bucket);
    }
    bucket.entries.push(view);
  }
  return Array.from(buckets.values());
}

export function timeLabel(date: Date | null): string {
  if (!date) return '';
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function actorInitial(actor: string): string {
  const first = actor.trim().charAt(0);
  return first ? first.toUpperCase() : '?';
}
