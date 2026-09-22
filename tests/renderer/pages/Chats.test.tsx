import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), remove: vi.fn(), navigate: vi.fn() }));
vi.mock('@/lib/api', () => ({ fetchRecentConversations: mocks.fetch, deleteSessionHistory: mocks.remove }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/components/layout/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/layout/AppFooter', () => ({ default: () => null }));
vi.mock('@/lib/display', () => ({ timeAgo: () => '1 day ago', truncate: (value: string) => value }));
import Chats from '@/pages/Chats';

const conversation = {
  id: 'chat-1', title: 'Check the theorem', blueprint_name: 'workspace',
  repository_owner: 'ada', repository_name: 'project', created_at: '2026-09-17',
  last_message_at: null, last_message: null, first_message: null, tier: 'waiting_for_review',
};

describe('Chats', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.fetch.mockResolvedValue([conversation]); mocks.remove.mockResolvedValue(undefined); });

  it('uses the same hover and divider styling as workspace History', async () => {
    render(<Chats />);
    const row = await screen.findByRole('button', { name: /Check the theorem/ });
    expect(row).toHaveClass('history-session-row', 'rounded-[var(--radius-md)]');
    expect(row).not.toHaveClass('border-b');
    expect(row.parentElement).toHaveClass('history-session-list');
    expect(row.parentElement).not.toHaveClass('divide-y');
    expect(screen.getByText('project / workspace').parentElement).toHaveClass('text-muted-foreground');
    expect(screen.getByText(/1 day ago/)).not.toHaveClass('font-mono');
    expect(screen.getByText('Unread')).toBeInTheDocument();
    fireEvent.click(row);
    expect(mocks.navigate).toHaveBeenCalledWith('/repo/ada/project/blueprint/workspace/lean?chat=chat-1');
  });

  it('removes a chat without opening it', async () => {
    render(<Chats />);
    fireEvent.click(await screen.findByTitle('Delete chat'));
    expect(mocks.remove).toHaveBeenCalledWith('chat-1');
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(await screen.findByText('No chats yet. New ones will appear here.')).toBeInTheDocument();
  });

  it('loads subsequent pages from the current conversation count', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => ({
      ...conversation, id: `chat-${index}`, title: `Chat ${index}`,
    }));
    const nextConversation = { ...conversation, id: 'chat-20', title: 'Chat 20' };
    mocks.fetch
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([nextConversation]);

    render(<Chats />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));

    await screen.findByRole('button', { name: /Chat 20/ });
    expect(mocks.fetch).toHaveBeenNthCalledWith(1, 20, 0);
    expect(mocks.fetch).toHaveBeenNthCalledWith(2, 20, 20);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    });
  });

  it('shows operation errors without discarding loaded conversations', async () => {
    mocks.remove.mockRejectedValueOnce(new Error('delete failed'));
    render(<Chats />);

    fireEvent.click(await screen.findByTitle('Delete chat'));

    expect(await screen.findByText('Could not delete chat. Please try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Check the theorem/ })).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
