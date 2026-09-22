import { timeAgo, truncate } from '@/lib/display';
import type { RecentConversation } from '@/pages/chats/chat-types';

export function conversationSummary(conversation: RecentConversation): string {
  if (conversation.title) return conversation.title;
  const fallback = conversation.last_message || conversation.first_message;
  return truncate(fallback || 'Untitled conversation', 140);
}

export function conversationActivity(conversation: RecentConversation): string {
  return timeAgo(conversation.last_message_at || conversation.created_at);
}

export function conversationStatus(
  tier: RecentConversation['tier'],
): string | null {
  if (tier === 'active') return 'Running';
  if (tier === 'waiting_for_review') return 'Unread';
  return null;
}

export function conversationPath(conversation: RecentConversation): string {
  const owner = encodeURIComponent(conversation.repository_owner);
  const repository = encodeURIComponent(conversation.repository_name);
  const blueprint = encodeURIComponent(conversation.blueprint_name);
  const chat = encodeURIComponent(conversation.id);
  return `/repo/${owner}/${repository}/blueprint/${blueprint}/lean?chat=${chat}`;
}
