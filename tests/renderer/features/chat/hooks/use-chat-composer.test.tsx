import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FOCUS_COMPOSER_EVENT } from '@/desktop/events';
import { useChatComposer } from '@/features/chat/hooks/use-chat-composer';
import type { ChatState } from '@/features/chat/state/types';

function chatState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    messages: [],
    suggestion: null,
    activities: [],
    subagents: [],
    buildHistory: [],
    autonomousRunActive: false,
    sending: false,
    conversationId: null,
    currentJobId: null,
    sessionId: null,
    status: null,
    connected: false,
    viewingConversationId: null,
    historySession: null,
    historyTools: [],
    permissions: [],
    focusRequestToken: 0,
    liveSession: {
      isActiveSession: false,
      canSend: true,
      canCancel: false,
      buildStatus: 'not_started',
      displayStatus: null,
      turnActive: false,
      activeProverBatchId: null,
      activeProverBatchTotal: 0,
      activeProverBatchCompleted: 0,
      activeWorkGroupCount: 0,
    },
    ...overrides,
  };
}

function options(state = chatState()) {
  return {
    state,
    send: vi.fn(async () => true),
    stop: vi.fn(async () => {}),
    readonly: false,
    routeKey: '/blueprint',
    draftAttachments: [],
    releaseTurnScroll: vi.fn(),
    createTurnScrollCallback: vi.fn(() => vi.fn()),
  };
}

describe('useChatComposer', () => {
  it('derives the fresh-chat suggestion and accepts shell focus requests', () => {
    const { result } = renderHook(() => useChatComposer(options()));
    const focus = vi.fn();
    result.current.composerRef.current = { focus };

    act(() => window.dispatchEvent(new CustomEvent(FOCUS_COMPOSER_EVENT)));

    expect(result.current.suggestedMessage).toBe('Tell me what can you do?');
    expect(result.current.canSendMessage).toBe(true);
    expect(focus).toHaveBeenCalledOnce();
  });

  it('uses steering copy while active work is running', () => {
    const state = chatState({
      messages: [{ role: 'user', text: 'Start' }],
      liveSession: {
        ...chatState().liveSession,
        turnActive: true,
      },
    });
    const { result } = renderHook(() => useChatComposer(options(state)));

    expect(result.current.sessionBusy).toBe(true);
    expect(result.current.composerPlaceholder)
      .toBe('Steer the agent by sending a message...');
  });
});
