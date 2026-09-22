export interface SessionAttention {
  id: string;
  owner: string;
  repository: string;
  blueprint: string | null;
  revision: string;
  unread: boolean;
  state: 'running' | 'needs_input' | 'error' | 'idle';
}
