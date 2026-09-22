import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { deleteSessionHistory, fetchRecentConversations } from '@/lib/api';
import { conversationPath } from '@/pages/chats/chat-helpers';
import type { RecentConversation } from '@/pages/chats/chat-types';

const PAGE_SIZE = 20;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function fetchPage(offset: number): Promise<RecentConversation[]> {
  return fetchRecentConversations(PAGE_SIZE, offset) as Promise<RecentConversation[]>;
}

function useInitialConversations(
  setConversations: React.Dispatch<React.SetStateAction<RecentConversation[]>>,
  setError: React.Dispatch<React.SetStateAction<string | null>>,
  setHasMore: React.Dispatch<React.SetStateAction<boolean>>,
  setLoading: React.Dispatch<React.SetStateAction<boolean>>,
) {
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const results = await fetchPage(0);
        if (cancelled) return;
        setConversations(results);
        setHasMore(results.length >= PAGE_SIZE);
      } catch (error) {
        if (!cancelled) setError(errorMessage(error, 'Failed to load chats.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [setConversations, setError, setHasMore, setLoading]);
}

interface LoadMoreOptions {
  conversationCount: number;
  hasMore: boolean;
  loadingMore: boolean;
  setConversations: React.Dispatch<React.SetStateAction<RecentConversation[]>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setHasMore: React.Dispatch<React.SetStateAction<boolean>>;
  setLoadingMore: React.Dispatch<React.SetStateAction<boolean>>;
}

function useLoadMore(options: LoadMoreOptions) {
  return useCallback(async () => {
    if (options.loadingMore || !options.hasMore) return;
    options.setLoadingMore(true);
    try {
      const results = await fetchPage(options.conversationCount);
      options.setConversations((current) => [...current, ...results]);
      options.setHasMore(results.length >= PAGE_SIZE);
    } catch (error) {
      options.setError(errorMessage(error, 'Failed to load more chats.'));
    } finally {
      options.setLoadingMore(false);
    }
  }, [options]);
}

interface DeleteOptions {
  deleting: boolean;
  setConversations: React.Dispatch<React.SetStateAction<RecentConversation[]>>;
  setDeleteError: React.Dispatch<React.SetStateAction<string | null>>;
  setDeleting: React.Dispatch<React.SetStateAction<boolean>>;
}

function useDeleteConversation(options: DeleteOptions) {
  return useCallback(async (conversationId: string) => {
    if (options.deleting) return;
    options.setDeleting(true);
    options.setDeleteError(null);
    try {
      await deleteSessionHistory(conversationId);
      options.setConversations((current) => current.filter(
        (conversation) => conversation.id !== conversationId,
      ));
    } catch {
      options.setDeleteError('Could not delete chat. Please try again.');
    } finally {
      options.setDeleting(false);
    }
  }, [options]);
}

/** Owns loading and actions for the all-chats list view. */
export function useChatsPage() {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<RecentConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  useInitialConversations(setConversations, setError, setHasMore, setLoading);

  const loadMore = useLoadMore({
    conversationCount: conversations.length, hasMore, loadingMore,
    setConversations, setError, setHasMore, setLoadingMore,
  });
  const deleteConversation = useDeleteConversation({
    deleting, setConversations, setDeleteError, setDeleting,
  });
  const openConversation = useCallback((conversation: RecentConversation) => {
    navigate(conversationPath(conversation));
  }, [navigate]);

  return {
    conversations, deleteConversation, deleteError, error, hasMore,
    loadMore, loading, loadingMore, openConversation,
  };
}

export type ChatsPageModel = ReturnType<typeof useChatsPage>;
