import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/display', () => ({
  timeAgo: (value: string) => `ago:${value}`,
  truncate: (value: string, length: number) => `${value}:${length}`,
}));

import {
  conversationActivity,
  conversationPath,
  conversationStatus,
  conversationSummary,
} from '@/pages/chats/chat-helpers';
import type { RecentConversation } from '@/pages/chats/chat-types';

const conversation: RecentConversation = {
  id: 'chat / one',
  title: null,
  blueprint_name: 'Blueprint / one',
  repository_owner: 'Ada Lovelace',
  repository_name: 'proofs & programs',
  created_at: 'created',
  last_message: null,
  first_message: 'First message',
  last_message_at: 'updated',
  tier: 'active',
};

describe('chat helpers', () => {
  it('derives display values from conversation fallbacks', () => {
    expect(conversationSummary(conversation)).toBe('First message:140');
    expect(conversationActivity(conversation)).toBe('ago:updated');
    expect(conversationStatus('active')).toBe('Running');
    expect(conversationStatus('waiting_for_review')).toBe('Unread');
    expect(conversationStatus('completed')).toBeNull();
  });

  it('encodes every dynamic route segment and query value', () => {
    expect(conversationPath(conversation)).toBe(
      '/repo/Ada%20Lovelace/proofs%20%26%20programs/blueprint/'
      + 'Blueprint%20%2F%20one/lean?chat=chat%20%2F%20one',
    );
  });
});
