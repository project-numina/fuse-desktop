import { useCallback, useEffect, useRef } from 'react';

import type { useChat } from '@/state/chat';

interface SearchParamsSetter {
  (next: URLSearchParams, options?: { replace?: boolean }): void;
}

export function useBlueprintChatRouting({
  chat,
  isReadonly,
  searchParams,
  setSearchParams,
}: {
  chat: ReturnType<typeof useChat>;
  isReadonly: boolean;
  searchParams: URLSearchParams;
  setSearchParams: SearchParamsSetter;
}) {
  const selectionVersionRef = useRef(0);

  const handleNewChat = useCallback(() => {
    if (isReadonly) return;
    selectionVersionRef.current += 1;
    void chat.prepareNewAgentSession();
    if (!searchParams.get('chat')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('chat');
    setSearchParams(next, { replace: true });
  }, [isReadonly, chat, searchParams, setSearchParams]);

  const handleSelectHistorySession = useCallback(async (sessionId: string) => {
    const selectionVersion = selectionVersionRef.current + 1;
    selectionVersionRef.current = selectionVersion;
    await chat.loadHistory(sessionId);
    if (selectionVersionRef.current !== selectionVersion) return;
    const next = new URLSearchParams(searchParams);
    next.set('chat', sessionId);
    setSearchParams(next, { replace: true });
  }, [chat, searchParams, setSearchParams]);

  const conversationId = chat.state.conversationId;
  useEffect(() => {
    if (!conversationId || searchParams.get('chat') === conversationId) return;
    const next = new URLSearchParams(searchParams);
    next.set('chat', conversationId);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  const chatParam = searchParams.get('chat');
  useEffect(() => {
    if (
      chatParam
      && chat.state.viewingConversationId !== chatParam
      && chat.state.conversationId !== chatParam
    ) {
      void chat.loadHistory(chatParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatParam]);

  return { handleNewChat, handleSelectHistorySession };
}
