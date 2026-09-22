import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useBlueprintChatRouting } from '@/features/blueprint/page/use-blueprint-chat-routing';

function chat(overrides: Record<string, unknown> = {}) {
  return {
    state: {
      conversationId: null,
      viewingConversationId: null,
      ...overrides,
    },
    prepareNewAgentSession: vi.fn(async () => undefined),
    loadHistory: vi.fn(async () => undefined),
  };
}

describe('useBlueprintChatRouting', () => {
  it('starts a writable chat and removes the selected history query', () => {
    const currentChat = chat();
    const setSearchParams = vi.fn();
    const { result } = renderHook(() => useBlueprintChatRouting({
      chat: currentChat as never,
      isReadonly: false,
      searchParams: new URLSearchParams('chat=old&tab=files'),
      setSearchParams,
    }));

    act(() => result.current.handleNewChat());

    expect(currentChat.prepareNewAgentSession).toHaveBeenCalledOnce();
    const next = setSearchParams.mock.calls[0][0] as URLSearchParams;
    expect(next.toString()).toBe('tab=files');
    expect(setSearchParams.mock.calls[0][1]).toEqual({ replace: true });
  });

  it('does not mutate chat state for a read-only workspace', () => {
    const currentChat = chat();
    const setSearchParams = vi.fn();
    const { result } = renderHook(() => useBlueprintChatRouting({
      chat: currentChat as never,
      isReadonly: true,
      searchParams: new URLSearchParams('chat=old'),
      setSearchParams,
    }));

    act(() => result.current.handleNewChat());
    expect(currentChat.prepareNewAgentSession).not.toHaveBeenCalled();
    expect(setSearchParams).not.toHaveBeenCalled();
  });

  it('loads the query-selected history and mirrors a live conversation id', () => {
    const currentChat = chat({ conversationId: 'live' });
    const setSearchParams = vi.fn();
    renderHook(() => useBlueprintChatRouting({
      chat: currentChat as never,
      isReadonly: false,
      searchParams: new URLSearchParams('chat=history'),
      setSearchParams,
    }));

    expect(currentChat.loadHistory).toHaveBeenCalledWith('history');
    const mirrored = setSearchParams.mock.calls[0][0] as URLSearchParams;
    expect(mirrored.get('chat')).toBe('live');
  });

  it('publishes a history selection only after its load completes', async () => {
    const currentChat = chat();
    const setSearchParams = vi.fn();
    const { result } = renderHook(() => useBlueprintChatRouting({
      chat: currentChat as never,
      isReadonly: false,
      searchParams: new URLSearchParams('tab=history'),
      setSearchParams,
    }));

    await act(async () => result.current.handleSelectHistorySession('session-2'));

    expect(currentChat.loadHistory).toHaveBeenCalledWith('session-2');
    const next = setSearchParams.mock.calls[0][0] as URLSearchParams;
    expect(next.toString()).toBe('tab=history&chat=session-2');
  });
});
