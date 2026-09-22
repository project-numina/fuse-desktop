export interface RecentConversation {
  id: string;
  title: string | null;
  blueprint_name: string;
  repository_owner: string;
  repository_name: string;
  created_at: string;
  last_message: string | null;
  first_message: string | null;
  last_message_at: string | null;
  tier: 'active' | 'waiting_for_review' | 'completed';
}
